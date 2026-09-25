
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import pandas as pd
import numpy as np
import joblib
from pathlib import Path
from io import BytesIO
import uuid
import traceback

BASE_DIR = Path(__file__).resolve().parent
MODEL_DIR = BASE_DIR / "models"
FRONTEND_DIR = BASE_DIR.parent / "frontend"
SAMPLE_FILE = BASE_DIR.parent / "sample_data" / "aws_weather_data.csv"

MODEL = joblib.load(MODEL_DIR / "weather_anomaly_model.pkl")
SCALER = joblib.load(MODEL_DIR / "weather_anomaly_scaler.pkl")
FEATURES = joblib.load(MODEL_DIR / "weather_anomaly_features.pkl")
THRESHOLD = float(joblib.load(MODEL_DIR / "weather_anomaly_threshold.pkl"))

BASE_FEATURES = [
    "temperature_2m", "relative_humidity_2m", "precipitation",
    "surface_pressure", "wind_speed_10m", "wind_direction_10m"
]

REQUIRED_COLUMNS = ["time"] + BASE_FEATURES + ["city"]
RESULT_STORE = {}

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)

def add_change_features(df):
    out = df.copy()
    if "time" in out.columns:
        out["time"] = pd.to_datetime(out["time"], errors="coerce")
    for c in BASE_FEATURES:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    if "city" not in out.columns:
        out["city"] = "Manual Station"
    out["city"] = out["city"].fillna("Unknown").astype(str)
    out = out.dropna(subset=BASE_FEATURES).copy()

    if "time" in out.columns:
        out = out.sort_values(["city", "time"]).reset_index(drop=True)
    else:
        out = out.reset_index(drop=True)

    for feature in BASE_FEATURES:
        out[f"{feature}_change"] = out.groupby("city")[feature].diff()

    # A first observation has no previous observation. The model's feature
    # definition requires a numeric value, so the UI treats it as no change.
    change_cols = [f"{f}_change" for f in BASE_FEATURES]
    out[change_cols] = out[change_cols].fillna(0)
    return out

def classify_scores(scores):
    scores = np.asarray(scores, dtype=float)
    status = np.where(scores < THRESHOLD, "ANOMALY", "NORMAL")
    severity = np.where(
        status == "NORMAL", "NORMAL",
        np.where(THRESHOLD - scores < 0.05, "LOW",
                 np.where(THRESHOLD - scores < 0.15, "MEDIUM", "HIGH"))
    )
    return status, severity

def run_detection(df):
    prepared = add_change_features(df)
    if prepared.empty:
        raise ValueError("No valid weather rows were found after cleaning.")

    X = prepared[FEATURES]
    scaled = SCALER.transform(X)
    scores = MODEL.decision_function(scaled)
    status, severity = classify_scores(scores)

    result = prepared.copy()
    result["anomaly_score"] = scores
    result["status"] = status
    result["severity"] = severity

    if "time" in result.columns:
        result["time"] = pd.to_datetime(result["time"], errors="coerce")

    return result

def serialize_records(df, limit=1200):
    sample = df.copy()
    if "time" in sample.columns:
        sample["time"] = sample["time"].dt.strftime("%Y-%m-%d %H:%M:%S")
    # Most useful records first: anomalies, then normal observations.
    sample = pd.concat([
        sample[sample["status"] == "ANOMALY"],
        sample[sample["status"] == "NORMAL"]
    ]).head(limit)
    return sample.replace({np.nan: None}).to_dict(orient="records")

def build_summary(df):
    total = len(df)
    anomaly_count = int((df["status"] == "ANOMALY").sum())
    normal_count = total - anomaly_count
    anomaly_rate = round((anomaly_count / total) * 100, 2) if total else 0

    city = (
        df.groupby(["city", "status"]).size()
        .unstack(fill_value=0)
        .reset_index()
    )
    for col in ["NORMAL", "ANOMALY"]:
        if col not in city.columns:
            city[col] = 0
    city["total"] = city["NORMAL"] + city["ANOMALY"]
    city["anomaly_rate"] = (city["ANOMALY"] / city["total"] * 100).round(2)

    severity = df["severity"].value_counts().reindex(
        ["NORMAL", "LOW", "MEDIUM", "HIGH"], fill_value=0
    )

    sensor_cols = BASE_FEATURES
    sensor_stats = []
    for c in sensor_cols:
        sensor_stats.append({
            "sensor": c,
            "min": round(float(df[c].min()), 3),
            "max": round(float(df[c].max()), 3),
            "mean": round(float(df[c].mean()), 3),
        })

    score_min = float(df["anomaly_score"].min())
    score_max = float(df["anomaly_score"].max())
    hist_counts, hist_edges = np.histogram(df["anomaly_score"], bins=24)
    score_hist = [
        {
            "bin": round(float((hist_edges[i] + hist_edges[i+1]) / 2), 4),
            "count": int(hist_counts[i])
        }
        for i in range(len(hist_counts))
    ]

    timeline_df = df.copy()
    if "time" in timeline_df.columns:
        timeline_df["date"] = timeline_df["time"].dt.strftime("%Y-%m-%d")
        daily = timeline_df.groupby("date").agg(
            readings=("status", "size"),
            anomalies=("status", lambda s: int((s == "ANOMALY").sum()))
        ).reset_index()
        daily["rate"] = (daily["anomalies"] / daily["readings"] * 100).round(2)
        # Keep charts responsive while preserving the overall trend.
        if len(daily) > 180:
            daily = daily.iloc[::max(1, len(daily)//180)].copy()
        timeline = daily.to_dict(orient="records")
    else:
        timeline = []

    return {
        "total_readings": total,
        "anomalies": anomaly_count,
        "normal": normal_count,
        "anomaly_rate": anomaly_rate,
        "threshold": THRESHOLD,
        "cities": sorted(df["city"].dropna().unique().tolist()),
        "city_breakdown": city.to_dict(orient="records"),
        "severity": [{"name": k, "count": int(v)} for k, v in severity.items()],
        "sensor_stats": sensor_stats,
        "score_histogram": score_hist,
        "timeline": timeline,
        "records": serialize_records(df),
        "rows_returned": min(1200, len(df))
    }

def make_run(df):
    result = run_detection(df)
    run_id = uuid.uuid4().hex[:12]
    RESULT_STORE[run_id] = result
    # Prevent unbounded memory use during a hackathon demo.
    while len(RESULT_STORE) > 8:
        RESULT_STORE.pop(next(iter(RESULT_STORE)))
    return run_id, result

@app.get("/api/health")
def health():
    return jsonify({
        "ok": True,
        "model": "IsolationForest",
        "features": FEATURES,
        "threshold": THRESHOLD
    })

@app.post("/api/detect/manual")
def detect_manual():
    try:
        data = request.get_json(force=True)
        row = {
            "time": data.get("time") or pd.Timestamp.now().isoformat(),
            "temperature_2m": data["temperature_2m"],
            "relative_humidity_2m": data["relative_humidity_2m"],
            "precipitation": data["precipitation"],
            "surface_pressure": data["surface_pressure"],
            "wind_speed_10m": data["wind_speed_10m"],
            "wind_direction_10m": data["wind_direction_10m"],
            "city": data.get("city", "Manual Station")
        }
        for feature in BASE_FEATURES:
            row[feature] = float(row[feature])
        for feature in BASE_FEATURES:
            row[f"{feature}_change"] = float(data.get(
                feature + "_change",
                0
            ))
        input_df = pd.DataFrame([row])
        X = input_df[FEATURES]
        scaled = SCALER.transform(X)
        score = float(MODEL.decision_function(scaled)[0])
        status, severity = classify_scores([score])
        return jsonify({
            "status": status[0],
            "severity": severity[0],
            "anomaly_score": round(score, 6),
            "threshold": THRESHOLD,
            "reading": row
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 400

@app.post("/api/detect/file")
def detect_file():
    try:
        if "file" not in request.files:
            return jsonify({"error": "Please upload a CSV or Excel file."}), 400
        file = request.files["file"]
        name = (file.filename or "").lower()
        if name.endswith(".csv"):
            df = pd.read_csv(file)
        elif name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(file)
        else:
            return jsonify({"error": "Only .csv, .xlsx and .xls files are supported."}), 400

        missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
        if missing:
            return jsonify({
                "error": "Missing required columns: " + ", ".join(missing),
                "required_columns": REQUIRED_COLUMNS
            }), 400

        run_id, result = make_run(df)
        response = build_summary(result)
        response["run_id"] = run_id
        response["filename"] = file.filename
        response["input_rows"] = len(df)
        response["valid_rows"] = len(result)
        return jsonify(response)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400

@app.get("/api/demo")
def demo():
    try:
        df = pd.read_csv(SAMPLE_FILE)
        # Use a representative recent slice, preserving city time order.
        df["time"] = pd.to_datetime(df["time"], errors="coerce")
        df = df.sort_values(["city", "time"])
        parts = []
        for city, city_df in df.groupby("city"):
            parts.append(city_df.tail(720))
        sample = pd.concat(parts).reset_index(drop=True)
        run_id, result = make_run(sample)
        response = build_summary(result)
        response["run_id"] = run_id
        response["filename"] = "Built-in AWS demonstration data"
        response["input_rows"] = len(sample)
        response["valid_rows"] = len(result)
        return jsonify(response)
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

@app.get("/api/results/<run_id>/download")
def download_results(run_id):
    result = RESULT_STORE.get(run_id)
    if result is None:
        return jsonify({"error": "Run not found. Please detect the file again."}), 404
    out = result.copy()
    if "time" in out.columns:
        out["time"] = out["time"].dt.strftime("%Y-%m-%d %H:%M:%S")
    csv_bytes = out.to_csv(index=False).encode("utf-8")
    return send_file(
        BytesIO(csv_bytes),
        mimetype="text/csv",
        as_attachment=True,
        download_name=f"aws_anomaly_results_{run_id}.csv"
    )

@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")

@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "API route not found"}), 404
    return send_from_directory(FRONTEND_DIR, "index.html")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
