# AWS Sentinel — Intelligent Weather Anomaly Detection

**Hackathon:** Smart India Hackathon (SIH)  
**Problem:** Ministry of Earth Sciences (MoES) — AI/ML-Based Intelligent Anomaly Detection for Automatic Weather Stations (AWS)  
**Problem ID:** SIH26073

This project wraps the supplied Isolation Forest model in a Python/Flask backend and a responsive dark monitoring dashboard. A MERN stack is not necessary here because the trained model is Python/scikit-learn based; keeping the API in Python avoids a second model-serving layer.

## What is included

- `backend/app.py` — Flask API + model inference + file processing
- `backend/models/` — supplied trained model, scaler, feature list and optimized threshold
- `backend/requirements.txt` — Python dependencies
- `frontend/` — dashboard UI, charts and interaction logic
- `sample_data/aws_weather_data.csv` — supplied AWS dataset
- `docs/Model1.ipynb` — original model notebook
- `README.md` — setup and demo instructions

## Main features

### Manual detection
Enter:
- temperature
- relative humidity
- precipitation
- surface pressure
- wind speed
- wind direction

Optional change-from-previous values are available under the advanced section. The API returns:
- NORMAL / ANOMALY
- LOW / MEDIUM / HIGH severity
- anomaly score
- model threshold

### Batch detection
Upload:
- `.csv`
- `.xlsx`
- `.xls`

The backend validates the required columns, recreates the six change-based features used during training, scales the data with the supplied scaler, and runs the supplied Isolation Forest.

### Dashboard analytics
The UI displays:
- total readings
- anomaly count and rate
- normal readings
- model threshold
- anomaly activity over time
- normal vs anomaly donut
- severity distribution
- anomaly counts by city
- anomaly-score histogram
- sensor observed ranges
- detected event table
- full result CSV download

## Required input columns

Your uploaded file should contain:

```text
time
temperature_2m
relative_humidity_2m
precipitation
surface_pressure
wind_speed_10m
wind_direction_10m
city
```

The backend also creates:

```text
temperature_2m_change
relative_humidity_2m_change
precipitation_change
surface_pressure_change
wind_speed_10m_change
wind_direction_10m_change
```

For the first observation of a city, the change is set to `0` because there is no previous observation.

## Run locally on Windows

### 1. Open the project

Open this folder in VS Code:

```text
AWS_Anomaly_Intelligence
```

### 2. Create a virtual environment

Open the VS Code terminal:

```bash
python -m venv .venv
```

Activate it:

```bash
.venv\Scripts\activate
```

### 3. Install dependencies

```bash
pip install -r backend\requirements.txt
```

### 4. Start the application

```bash
python backend\app.py
```

Open:

```text
http://127.0.0.1:5000
```

## First demo

The dashboard automatically loads a small representative slice of the supplied AWS data.

You can also:
1. Click **Load Demo**
2. Enter a manual reading and click **Detect anomaly**
3. Upload your own CSV/Excel file
4. Click **Detect anomalies in file**
5. Explore the charts
6. Download the full analyzed CSV

## Model note

The supplied notebook trains an `IsolationForest` on six weather variables plus their city-wise first differences. The saved threshold is used to classify a reading as anomalous when its anomaly score falls below the optimized threshold.

The model artifacts were supplied with the original project and are used without retraining by the dashboard.

## Important data-quality note

An anomaly is a **model-detected statistical deviation**, not proof that a physical sensor is broken. In a production MoES deployment, anomaly alerts could be combined with station metadata, neighboring-station comparison, maintenance logs, missing-value checks, range rules and human verification.

## Suggested hackathon architecture

```text
AWS / CSV / Excel
       |
       v
  Flask REST API
       |
       +---- Data validation
       |
       +---- City-wise change features
       |
       +---- StandardScaler
       |
       +---- Isolation Forest
       |
       v
 Anomaly + Severity + Score
       |
       v
Interactive Dashboard
       |
       +---- KPI cards
       +---- Trend chart
       +---- City comparison
       +---- Severity chart
       +---- Score distribution
       +---- Event table
       +---- CSV export
```

## Troubleshooting

### `ModuleNotFoundError`
Activate the virtual environment and run:

```bash
pip install -r backend\requirements.txt
```

### Excel upload fails
Make sure `openpyxl` and `xlrd` are installed from the requirements file.

### Model loading warning
The model was serialized with scikit-learn 1.6.1 during the original notebook workflow. The requirements allow a compatible newer scikit-learn release as well, which is useful on newer Python versions such as Python 3.14. A compatibility warning can appear when loading the older serialized artifact; the supplied model is still used for inference.

### Port 5000 is busy

Change the final line in `backend/app.py`:

```python
app.run(host="0.0.0.0", port=5000, debug=True)
```

to another port such as `5001`, then open that port in the browser.

## Presentation tip

For the hackathon demo, show this flow:

**Problem → Upload/Manual Input → AI Detection → Severity → City/Time Visualizations → Downloadable Alert Data**

The strongest demo moment is to enter an intentionally extreme reading (for example, unusually high temperature + very high wind + low humidity) and show the anomaly result, then load the normal demo data and compare the dashboard distributions.
