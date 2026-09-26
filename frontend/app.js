// AWS Sentinel backend URL.
// Leave blank when frontend and backend share the same origin.
// For GitHub Pages, set this to your Vercel backend URL, for example:
// window.AWS_SENTINEL_API = "https://your-backend.vercel.app";
const API_BASE=(window.AWS_SENTINEL_API||"").replace(/\\/$/,"");
const api=path=>`${API_BASE}${path}`;

const $=id=>document.getElementById(id);
let charts={}, currentRunId=null, selectedFile=null, manualHistory=[], batchSource=null;

function showToast(msg){const t=$("toast");t.textContent=msg;t.classList.add("show");setTimeout(()=>t.classList.remove("show"),3200)}
function fmt(n){return Number(n||0).toLocaleString("en-IN")}
function destroy(name){if(charts[name]) charts[name].destroy()}
const chartOpts={responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:"#77849a",font:{size:9},boxWidth:8}}},scales:{x:{grid:{color:"rgba(255,255,255,.035)"},ticks:{color:"#657289",font:{size:8},maxTicksLimit:8}},y:{grid:{color:"rgba(255,255,255,.035)"},ticks:{color:"#657289",font:{size:8}}}}};

function destroyBatchCharts(){
  ["timeline","status","severity","city","score"].forEach(destroy);
}

function destroyManualCharts(){
  ["manualScore","manualHistory","manualDelta"].forEach(destroy);
}

function resetKpis(){
  $("totalReadings").textContent="—";
  $("anomalies").textContent="—";
  $("normalReadings").textContent="—";
  $("anomalyRate").textContent="— anomaly rate";
  $("threshold").textContent="—";
  $("dataSource").textContent="Awaiting data";
  $("donutPct").textContent="—";
  $("recordSubtitle").textContent="Run a detection to populate the event stream.";
  $("recordsBody").innerHTML=`<tr><td colspan="9" class="empty">No analysis yet. Load the demo or upload a dataset.</td></tr>`;
  $("sensorStats").innerHTML="";
  $("downloadBtn").disabled=true;
  currentRunId=null;
}

function hideManualView(clearHistory=true){
  $("manualAnalytics").classList.add("hidden");
  $("clearManualResultBtn").classList.add("hidden");
  destroyManualCharts();
  if(clearHistory) manualHistory=[];
}

function hideBatchView(){
  $("analytics").classList.add("hidden");
  $("records").classList.add("hidden");
  destroyBatchCharts();
}

function showBatchView(source){
  batchSource=source;
  hideManualView(true);
  $("analytics").classList.remove("hidden");
  $("records").classList.remove("hidden");
  $("batchSourceTag").textContent=source==="demo"?"BUILT-IN DEMO ANALYSIS":"CSV / EXCEL ANALYSIS";
  $("recordSourceTag").textContent=source==="demo"?"03 / DEMO EVENT LOG":"03 / UPLOADED EVENT LOG";
  $("clearBatchBtn").classList.remove("hidden");
}

function clearBatchView(){
  hideBatchView();
  resetKpis();
  batchSource=null;
  $("clearBatchBtn").classList.add("hidden");
  $("fileInput").value="";
  selectedFile=null;
  $("fileMeta").className="file-meta hidden";
  $("fileMeta").textContent="";
  $("detectFileBtn").disabled=true;
}

function setManualDefaults(){
  const defaults={
    city:"Mumbai",
    temperature_2m:29,
    relative_humidity_2m:72,
    precipitation:0,
    surface_pressure:1012,
    wind_speed_10m:14,
    wind_direction_10m:180,
    temperature_2m_change:0.2,
    relative_humidity_2m_change:-1,
    precipitation_change:0,
    surface_pressure_change:-0.3,
    wind_speed_10m_change:1,
    wind_direction_10m_change:2
  };
  Object.entries(defaults).forEach(([id,value])=>$(id).value=value);
  $("time").value=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);
}

function clearManualView(){
  manualHistory=[];
  $("manualResult").className="manual-result hidden";
  $("manualResult").innerHTML="";
  hideManualView(false);
  setManualDefaults();
}

function render(data){
  showBatchView(batchSource||"file");
  $("totalReadings").textContent=fmt(data.total_readings);
  $("anomalies").textContent=fmt(data.anomalies);
  $("normalReadings").textContent=fmt(data.normal);
  $("anomalyRate").textContent=`${data.anomaly_rate}% of readings`;
  $("threshold").textContent=Number(data.threshold).toFixed(4);
  $("dataSource").textContent=batchSource==="demo"?"Built-in AWS demonstration data":(data.filename||"Uploaded dataset");
  $("donutPct").textContent=`${data.anomaly_rate}%`;
  currentRunId=data.run_id||currentRunId;
  $("downloadBtn").disabled=!currentRunId;
  $("recordSubtitle").textContent=`Showing ${fmt(data.rows_returned)} records from ${fmt(data.valid_rows||data.total_readings)} analyzed rows.`;

  const tl=data.timeline||[];
  destroy("timeline");
  charts.timeline=new Chart($("timelineChart"),{type:"line",data:{labels:tl.map(x=>x.date),datasets:[
    {label:"Readings",data:tl.map(x=>x.readings),borderColor:"#4d82ff",backgroundColor:"rgba(77,130,255,.08)",fill:true,tension:.35,pointRadius:0},
    {label:"Anomalies",data:tl.map(x=>x.anomalies),borderColor:"#ff6373",backgroundColor:"rgba(255,99,115,.08)",fill:true,tension:.35,pointRadius:0}
  ]},options:chartOpts});

  destroy("status");
  charts.status=new Chart($("statusChart"),{type:"doughnut",data:{labels:["Normal","Anomaly"],datasets:[{data:[data.normal,data.anomalies],backgroundColor:["#4d82ff","#ff6373"],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:"76%",plugins:{legend:{position:"bottom",labels:{color:"#77849a",font:{size:9},boxWidth:8,padding:12}}}}});

  const sev=data.severity||[];
  destroy("severity");
  charts.severity=new Chart($("severityChart"),{type:"bar",data:{labels:sev.map(x=>x.name),datasets:[{data:sev.map(x=>x.count),backgroundColor:["#4d82ff","#e7c45f","#ef9a58","#ff6373"],borderRadius:5,barThickness:26}]},options:{...chartOpts,plugins:{legend:{display:false}}}});

  const cities=data.city_breakdown||[];
  destroy("city");
  charts.city=new Chart($("cityChart"),{type:"bar",data:{labels:cities.map(x=>x.city),datasets:[{label:"Anomalies",data:cities.map(x=>x.ANOMALY),backgroundColor:"#ff6373",borderRadius:5},{label:"Normal",data:cities.map(x=>x.NORMAL),backgroundColor:"#315fe1",borderRadius:5}]},options:{...chartOpts,scales:{...chartOpts.scales,x:{...chartOpts.scales.x,stacked:true},y:{...chartOpts.scales.y,stacked:true}}}});

  const hist=data.score_histogram||[];
  destroy("score");
  charts.score=new Chart($("scoreChart"),{type:"bar",data:{labels:hist.map(x=>x.bin),datasets:[{data:hist.map(x=>x.count),backgroundColor:hist.map(x=>x.bin < data.threshold?"#ff6373":"#315fe1"),borderRadius:2,barPercentage:1.0,categoryPercentage:1.0}]},options:{...chartOpts,plugins:{legend:{display:false}},scales:{...chartOpts.scales,x:{...chartOpts.scales.x,ticks:{...chartOpts.scales.x.ticks,maxTicksLimit:7}},y:{...chartOpts.scales.y}}}});

  const stats=data.sensor_stats||[];
  const ranges={temperature_2m:"Temperature",relative_humidity_2m:"Humidity",precipitation:"Precipitation",surface_pressure:"Pressure",wind_speed_10m:"Wind speed",wind_direction_10m:"Wind direction"};
  const maxVals=stats.map(s=>Math.abs(s.max)).reduce((a,b)=>Math.max(a,b),1);
  $("sensorStats").innerHTML=stats.map(s=>`<div class="sensor-row"><span class="sensor-name">${ranges[s.sensor]||s.sensor}</span><div class="sensor-bar"><i style="width:${Math.max(4,Math.min(100,Math.abs(s.mean)/maxVals*100))}%"></i></div><span class="sensor-val">${s.min} — ${s.max}</span></div>`).join("");

  $("recordsBody").innerHTML=(data.records||[]).map(r=>`<tr>
    <td>${r.time||"—"}</td><td>${r.city||"—"}</td><td>${Number(r.temperature_2m).toFixed(2)}</td>
    <td>${Number(r.relative_humidity_2m).toFixed(1)}</td><td>${Number(r.surface_pressure).toFixed(1)}</td>
    <td>${Number(r.wind_speed_10m).toFixed(1)}</td><td>${Number(r.anomaly_score).toFixed(4)}</td>
    <td><span class="badge ${r.status.toLowerCase()}">${r.status}</span></td>
    <td><span class="badge ${r.severity.toLowerCase()}">${r.severity}</span></td></tr>`).join("") || `<tr><td colspan="9" class="empty">No rows.</td></tr>`;
  lucide.createIcons();
}

function showManualAnalytics(d){
  const section=$("manualAnalytics");
  section.classList.remove("hidden");
  const r=d.reading||{};
  const score=Number(d.anomaly_score);
  const threshold=Number(d.threshold);
  const deviation=threshold-score;
  $("manualSessionLabel").textContent=`${manualHistory.length} manual reading${manualHistory.length===1?"":"s"} in this session · ${r.city||"Manual Station"}`;
  $("liveStatusText").textContent=d.status==="ANOMALY"?`⚠ ${d.status}`:`✓ ${d.status}`;
  $("liveStatusMeta").textContent=`${d.severity} severity · lower scores indicate greater deviation from the learned weather pattern.`;
  $("liveScore").textContent=score.toFixed(4);
  $("liveThreshold").textContent=threshold.toFixed(4);
  $("liveDeviation").textContent=`${deviation>=0?"+":""}${deviation.toFixed(4)}`;
  $("liveSeverityBadge").textContent=d.severity;
  $("liveSeverityBadge").className=`mini-badge severity-${d.severity.toLowerCase()}`;
  $("liveStatusIcon").className=`live-status-icon ${d.status==="ANOMALY"?"anomaly":"normal"}`;
  $("liveStatusIcon").innerHTML=`<i data-lucide="${d.status==="ANOMALY"?"triangle-alert":"shield-check"}"></i>`;

  destroy("manualScore");
  charts.manualScore=new Chart($("manualScoreChart"),{type:"bar",data:{labels:["Reading","Threshold"],datasets:[{data:[score,threshold],backgroundColor:[d.status==="ANOMALY"?"#ff6373":"#4d82ff","#77849a"],borderRadius:6,barThickness:34}]},options:{...chartOpts,plugins:{legend:{display:false}},scales:{...chartOpts.scales,y:{...chartOpts.scales.y,beginAtZero:false}}}});

  const history=manualHistory;
  destroy("manualHistory");
  charts.manualHistory=new Chart($("manualHistoryChart"),{type:"line",data:{labels:history.map((_,i)=>`Reading ${i+1}`),datasets:[{label:"Anomaly score",data:history.map(x=>x.score),borderColor:"#4d82ff",backgroundColor:"rgba(77,130,255,.08)",fill:true,tension:.35,pointRadius:4,pointBackgroundColor:history.map(x=>x.status==="ANOMALY"?"#ff6373":"#4d82ff")},{label:"Threshold",data:history.map(()=>threshold),borderColor:"#77849a",borderDash:[5,5],pointRadius:0}]},options:{...chartOpts,plugins:{legend:{labels:{color:"#77849a",font:{size:9},boxWidth:8}}}}});

  const deltaKeys=[["temperature_2m_change","Temperature Δ"],["relative_humidity_2m_change","Humidity Δ"],["precipitation_change","Precipitation Δ"],["surface_pressure_change","Pressure Δ"],["wind_speed_10m_change","Wind speed Δ"],["wind_direction_10m_change","Wind direction Δ"]];
  const deltaValues=deltaKeys.map(([k])=>Number(r[k]||0));
  destroy("manualDelta");
  charts.manualDelta=new Chart($("manualDeltaChart"),{type:"bar",data:{labels:deltaKeys.map(x=>x[1]),datasets:[{label:"Change from previous",data:deltaValues,backgroundColor:deltaValues.map(v=>v<0?"#4d82ff":"#ff6373"),borderRadius:5}]},options:{...chartOpts,indexAxis:"y",plugins:{legend:{display:false}}}});
  lucide.createIcons();
  section.scrollIntoView({behavior:"smooth",block:"start"});
}

async function loadDemo(){
  $("demoBtn").disabled=true;
  $("demoBtn").innerHTML=`<i data-lucide="loader-circle"></i> Loading…`;lucide.createIcons();
  try{const r=await fetch(api("/api/demo"));const d=await r.json();if(!r.ok)throw new Error(d.error);batchSource="demo";render(d);showToast("Demo weather data analyzed successfully.");}
  catch(e){showToast(e.message)}
  $("demoBtn").disabled=false;$("demoBtn").innerHTML=`<i data-lucide="play"></i> Load Demo`;lucide.createIcons();
}

async function manualSubmit(e){
 e.preventDefault();
 hideBatchView();
 resetKpis();
 $("records").classList.add("hidden");
 const fields=["temperature_2m","relative_humidity_2m","precipitation","surface_pressure","wind_speed_10m","wind_direction_10m","temperature_2m_change","relative_humidity_2m_change","precipitation_change","surface_pressure_change","wind_speed_10m_change","wind_direction_10m_change"];
 const body={city:$("city").value,time:$("time").value};fields.forEach(k=>body[k]=Number($(k).value));
 try{const r=await fetch(api("/api/detect/manual"),{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error);
  const box=$("manualResult");box.className=`manual-result ${d.status==="ANOMALY"?"anomaly":"normal"}`;
  $("clearManualResultBtn").classList.remove("hidden");box.innerHTML=`<div class="result-line"><strong>${d.status==="ANOMALY"?"⚠ ANOMALY":"✓ NORMAL"} · ${d.severity}</strong><span class="badge ${d.status.toLowerCase()}">${d.anomaly_score.toFixed(4)}</span></div><div class="result-meta">Decision threshold: ${d.threshold.toFixed(4)} · Lower scores indicate greater deviation from the learned weather pattern.</div>`;
  manualHistory.push({score:Number(d.anomaly_score),status:d.status});
  if(manualHistory.length>12) manualHistory.shift();
  showManualAnalytics(d);
  showToast(`Manual reading classified as ${d.status}.`);
 }catch(err){showToast(err.message)}
}

async function fileDetect(){
 if(!selectedFile)return;
 const fd=new FormData();fd.append("file",selectedFile);
 $("detectFileBtn").disabled=true;$("detectFileBtn").innerHTML=`<i data-lucide="loader-circle"></i> Analyzing dataset…`;lucide.createIcons();
 try{const r=await fetch(api("/api/detect/file"),{method:"POST",body:fd});const d=await r.json();if(!r.ok)throw new Error(d.error);batchSource="file";render(d);showToast(`${fmt(d.valid_rows)} rows analyzed from ${d.filename}.`);document.querySelector("#analytics").scrollIntoView({behavior:"smooth"});}
 catch(err){showToast(err.message)}
 $("detectFileBtn").disabled=false;$("detectFileBtn").innerHTML=`<i data-lucide="radar"></i> Detect anomalies in file`;lucide.createIcons();
}

function updateSelectedFile(file){
  selectedFile=file||null;
  if(selectedFile){
    $("fileMeta").className="file-meta";
    $("fileMeta").textContent=`Selected: ${selectedFile.name} · ${(selectedFile.size/1024/1024).toFixed(2)} MB`;
    $("detectFileBtn").disabled=false;
  }else{
    $("fileMeta").className="file-meta hidden";
    $("fileMeta").textContent="";
    $("detectFileBtn").disabled=true;
  }
}

$("fileInput").addEventListener("change",e=>updateSelectedFile(e.target.files[0]));
$("manualForm").addEventListener("submit",manualSubmit);
$("demoBtn").addEventListener("click",loadDemo);
$("detectFileBtn").addEventListener("click",fileDetect);
$("clearManualFieldsBtn").addEventListener("click",()=>{setManualDefaults();showToast("Manual fields reset to the default reading.");});
$("clearManualResultBtn").addEventListener("click",()=>{manualHistory=[];$("manualResult").className="manual-result hidden";$("manualResult").innerHTML="";$("clearManualResultBtn").classList.add("hidden");hideManualView(false);showToast("Manual detection cleared.");});
$("clearFileBtn").addEventListener("click",()=>{updateSelectedFile(null);$("fileInput").value="";showToast("Selected file cleared.");});
$("clearBatchBtn").addEventListener("click",()=>{clearBatchView();showToast("Batch analysis cleared.");});
$("downloadBtn").addEventListener("click",()=>{if(currentRunId)window.location=api(`/api/results/${currentRunId}/download`)});
const dz=$("dropZone");
["dragenter","dragover"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.add("drag")}));
["dragleave","drop"].forEach(ev=>dz.addEventListener(ev,e=>{e.preventDefault();dz.classList.remove("drag")}));
dz.addEventListener("drop",e=>{const f=e.dataTransfer.files[0];if(f)updateSelectedFile(f)});
setManualDefaults();
hideBatchView();
hideManualView();
resetKpis();
async function health(){try{const r=await fetch(api("/api/health"));const d=await r.json();if(d.ok){$("apiStatus").className="status-chip online";$("apiStatus").innerHTML="<span></span> Model online"}}catch(e){$("apiStatus").innerHTML="<span></span> Backend offline"}}
lucide.createIcons();health();
