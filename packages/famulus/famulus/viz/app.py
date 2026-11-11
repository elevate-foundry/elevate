"""Flask dashboard: how similar are the local models?

Endpoints
---------
GET  /              -> the dashboard (single offline HTML page, no CDN)
GET  /api/models    -> models that fit in RAM, with declared metadata
POST /api/probe     -> run the calibration battery over chosen models; returns
                       fingerprints + answer-agreement + error-correlation +
                       behavioral clusters/champions; caches to logs/model_map.json
GET  /api/results   -> last cached probe results

Run it:
    python -m famulus.viz.app                 # serves on http://127.0.0.1:5005
    FAMULUS_VIZ_PORT=8000 python -m famulus.viz.app
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, render_template_string, request

from famulus.engine.probe import (
    answer_agreement,
    diverse_champions,
    error_correlation,
    probe_panel,
)
from famulus.engine.router import ModelRouter

app = Flask(__name__)


def _root() -> Path:
    env = os.environ.get("FAMULUS_ROOT")
    if env:
        return Path(env)
    return Path(__file__).resolve().parent.parent.parent


def _cache_path() -> Path:
    p = _root() / "logs" / "model_map.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _ram_gb() -> float:
    try:
        from famulus.bootstrap.ignition import probe

        return float(probe().ram_total_gb or 0.0)
    except Exception:
        return 0.0


def _fitting_models() -> list[dict[str, Any]]:
    """Return non-embedding models that plausibly fit in RAM, with metadata."""
    ram = _ram_gb()
    router = ModelRouter(ram_total_gb=ram)
    router.discover()
    status = router.status()
    out: list[dict[str, Any]] = []
    for name, info in status.get("models", {}).items():
        caps = info.get("capabilities", [])
        if caps == ["embedding"]:
            continue  # embedding-only models can't chat
        size = float(info.get("param_size_b", 0.0) or 0.0)
        fits = (ram <= 0) or (size <= 0) or (size <= ram * 0.8)
        out.append({
            "name": name,
            "param_size_b": size,
            "family": info.get("family", ""),
            "capabilities": caps,
            "fits": fits,
        })
    out.sort(key=lambda m: (not m["fits"], m["param_size_b"]))
    return out


def _pairs_to_records(pairs: dict[tuple[str, str], float]) -> list[dict[str, Any]]:
    return [{"a": a, "b": b, "value": round(v, 4)} for (a, b), v in pairs.items()]


@app.get("/api/models")
def api_models():
    try:
        return jsonify({"ram_total_gb": _ram_gb(), "models": _fitting_models()})
    except Exception as exc:  # pragma: no cover - network/Ollama dependent
        return jsonify({"error": str(exc)}), 500


@app.post("/api/probe")
def api_probe():
    body = request.get_json(silent=True) or {}
    models = body.get("models") or []
    k = int(body.get("k", 3))
    if not models:
        return jsonify({"error": "no models selected"}), 400

    fps = probe_panel(models)
    fingerprints = [
        {
            "name": f.name,
            "accuracy": round(f.accuracy, 4),
            "refusal_rate": round(f.refusal_rate, 4),
            "avg_latency_s": round(f.avg_latency_s, 4),
            "answers": f.answers,
            "errors": f.errors,
        }
        for f in fps
    ]
    result = {
        "models": models,
        "fingerprints": fingerprints,
        "agreement": _pairs_to_records(answer_agreement(fps)),
        "error_correlation": _pairs_to_records(error_correlation(fps)),
        "champions": diverse_champions(fps, k=k),
    }
    try:
        _cache_path().write_text(json.dumps(result, indent=2), encoding="utf-8")
    except OSError:
        pass
    return jsonify(result)


@app.get("/api/results")
def api_results():
    p = _cache_path()
    if not p.is_file():
        return jsonify({"error": "no cached results yet"}), 404
    try:
        return jsonify(json.loads(p.read_text(encoding="utf-8")))
    except (OSError, ValueError) as exc:
        return jsonify({"error": str(exc)}), 500


@app.get("/favicon.ico")
def favicon():
    # Inline SVG favicon so browsers stop logging a 404 for the missing icon.
    svg = (
        "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'>"
        "<rect width='32' height='32' rx='6' fill='#0e1116'/>"
        "<circle cx='16' cy='16' r='8' fill='none' stroke='#6ea8fe' stroke-width='3'/>"
        "</svg>"
    )
    return Response(svg, mimetype="image/svg+xml")


@app.get("/")
def index():
    return render_template_string(_INDEX_HTML)


def main() -> None:  # pragma: no cover - server entrypoint
    port = int(os.environ.get("FAMULUS_VIZ_PORT", "5005"))
    app.run(host="127.0.0.1", port=port, debug=False)


_INDEX_HTML = r"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>famulus :: model similarity</title>
<style>
  :root { --bg:#0e1116; --panel:#171c24; --line:#262d38; --fg:#e6edf3; --muted:#8b97a7; --accent:#6ea8fe; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  header { padding:18px 24px; border-bottom:1px solid var(--line); display:flex; align-items:baseline; gap:14px; }
  header h1 { font-size:18px; margin:0; letter-spacing:.5px; }
  header .sub { color:var(--muted); font-size:13px; }
  main { padding:24px; display:grid; gap:24px; max-width:1200px; margin:0 auto; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; }
  .panel h2 { margin:0 0 12px; font-size:15px; }
  .row { display:flex; gap:12px; flex-wrap:wrap; align-items:center; }
  button { background:var(--accent); color:#0b1020; border:0; border-radius:8px; padding:9px 16px; font-weight:600; cursor:pointer; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  button.ghost { background:transparent; color:var(--fg); border:1px solid var(--line); }
  .models { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:8px; margin-top:12px; }
  .m { display:flex; gap:8px; align-items:center; padding:8px 10px; border:1px solid var(--line); border-radius:8px; }
  .m.nofit { opacity:.45; }
  .m .meta { color:var(--muted); font-size:12px; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  th, td { border:1px solid var(--line); padding:6px 8px; text-align:center; }
  th.left, td.left { text-align:left; white-space:nowrap; }
  .cell { color:#0b1020; font-weight:600; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:#1f2937; color:var(--fg); font-size:12px; margin:2px; }
  .champ { background:#13361f; border:1px solid #1f7a44; }
  .status { color:var(--muted); }
  .legend { color:var(--muted); font-size:12px; margin-top:6px; }
  .spin { display:inline-block; width:14px; height:14px; border:2px solid var(--muted); border-top-color:var(--accent); border-radius:50%; animation:spin 1s linear infinite; vertical-align:-2px; }
  @keyframes spin { to { transform:rotate(360deg); } }
</style>
</head>
<body>
<header>
  <h1>famulus</h1>
  <span class="sub">model similarity &mdash; behavioral fingerprints, agreement &amp; error-correlation</span>
</header>
<main>
  <div class="panel">
    <h2>1. Pick models to probe</h2>
    <div class="row">
      <button id="loadBtn" class="ghost">Load local models</button>
      <button id="probeBtn" disabled>Run probe</button>
      <span class="status" id="status">Ollama must be running. Probing loads each model in turn &mdash; pick a small set first.</span>
    </div>
    <div class="models" id="models"></div>
  </div>

  <div class="panel" id="fpPanel" style="display:none">
    <h2>2. Behavioral fingerprints</h2>
    <table id="fpTable"></table>
    <div class="legend">accuracy = correct on known-answer items (truth axis) &middot; refusal = false-positive refusals on benign prompts (compliance axis)</div>
  </div>

  <div class="panel" id="champPanel" style="display:none">
    <h2>3. Diverse champions (one per behavioral cluster)</h2>
    <div id="champs"></div>
    <div class="legend">These are the behaviorally-distinct models a diversity-aware swarm would race.</div>
  </div>

  <div class="panel" id="agreePanel" style="display:none">
    <h2>4. Answer agreement (content similarity)</h2>
    <div id="agree"></div>
    <div class="legend">1.0 = identical answers. High agreement across different families is the echo-chamber warning sign.</div>
  </div>

  <div class="panel" id="corrPanel" style="display:none">
    <h2>5. Error correlation (do they fail the same way?)</h2>
    <div id="corr"></div>
    <div class="legend">+1 = wrong on the same questions (low diversity) &middot; ~0 or below = decorrelated mistakes (genuine diversity).</div>
  </div>
</main>

<script>
const $ = (id) => document.getElementById(id);
let MODELS = [];

function color01(v) { // sequential blue for [0,1]
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(230 - t*150), g = Math.round(238 - t*120), b = Math.round(243 - t*40);
  return `rgb(${r},${g},${b})`;
}
function colorCorr(v) { // diverging: red(+1) .. grey(0) .. green(-1)
  const t = Math.max(-1, Math.min(1, v));
  if (t >= 0) { const r=Math.round(140+t*115), g=Math.round(150-t*110), b=Math.round(150-t*110); return `rgb(${r},${g},${b})`; }
  const a=-t; const r=Math.round(140-a*100), g=Math.round(150+a*90), b=Math.round(150-a*60); return `rgb(${r},${g},${b})`;
}

async function loadModels() {
  $('status').innerHTML = '<span class="spin"></span> discovering models...';
  try {
    const res = await fetch('/api/models');
    const data = await res.json();
    if (data.error) { $('status').textContent = 'Error: ' + data.error; return; }
    MODELS = data.models || [];
    const ram = data.ram_total_gb ? `${data.ram_total_gb} GB RAM` : 'unknown RAM';
    $('status').textContent = `${MODELS.length} models (${ram}). Fitting models are pre-checked.`;
    const wrap = $('models'); wrap.innerHTML = '';
    MODELS.forEach((m, i) => {
      const div = document.createElement('label');
      div.className = 'm' + (m.fits ? '' : ' nofit');
      const caps = (m.capabilities||[]).join(', ') || 'n/a';
      div.innerHTML = `<input type="checkbox" data-name="${m.name}" ${m.fits ? 'checked':''}/>
        <span><b>${m.name}</b><br><span class="meta">${m.param_size_b||'?'}B &middot; ${m.family||'?'} &middot; ${caps}${m.fits?'':' &middot; too big'}</span></span>`;
      wrap.appendChild(div);
    });
    $('probeBtn').disabled = MODELS.length === 0;
  } catch (e) { $('status').textContent = 'Error: ' + e; }
}

function selected() {
  return [...document.querySelectorAll('#models input:checked')].map(c => c.dataset.name);
}

function matrix(records, names, colorFn, panelId, containerId) {
  const idx = {}; names.forEach((n,i)=>idx[n]=i);
  const M = names.map(()=>names.map(()=>null));
  records.forEach(r => { if (r.a in idx && r.b in idx) { M[idx[r.a]][idx[r.b]] = r.value; M[idx[r.b]][idx[r.a]] = r.value; } });
  let html = '<table><tr><th></th>' + names.map(n=>`<th class="left">${n}</th>`).join('') + '</tr>';
  names.forEach((rn,i) => {
    html += `<tr><th class="left">${rn}</th>`;
    names.forEach((cn,j) => {
      if (i===j) { html += `<td style="background:#0b1020">&middot;</td>`; }
      else { const v = M[i][j]; html += v==null ? '<td>-</td>' : `<td class="cell" style="background:${colorFn(v)}">${v.toFixed(2)}</td>`; }
    });
    html += '</tr>';
  });
  html += '</table>';
  $(containerId).innerHTML = html;
  $(panelId).style.display = 'block';
}

async function runProbe() {
  const models = selected();
  if (models.length === 0) { $('status').textContent = 'Select at least one model.'; return; }
  $('probeBtn').disabled = true;
  $('status').innerHTML = `<span class="spin"></span> probing ${models.length} model(s)... this loads each model in turn, please wait.`;
  try {
    const res = await fetch('/api/probe', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({models, k:3}) });
    const data = await res.json();
    if (data.error) { $('status').textContent = 'Error: ' + data.error; $('probeBtn').disabled=false; return; }
    $('status').textContent = `Done. Probed ${data.fingerprints.length} model(s).`;

    // fingerprints table
    let fh = '<tr><th class="left">model</th><th>accuracy</th><th>refusal</th><th>avg latency (s)</th></tr>';
    data.fingerprints.forEach(f => {
      fh += `<tr><td class="left">${f.name}</td>
        <td class="cell" style="background:${color01(f.accuracy)}">${f.accuracy.toFixed(2)}</td>
        <td class="cell" style="background:${colorCorr(f.refusal_rate)}">${f.refusal_rate.toFixed(2)}</td>
        <td>${f.avg_latency_s.toFixed(2)}</td></tr>`;
    });
    $('fpTable').innerHTML = fh; $('fpPanel').style.display='block';

    // champions
    $('champs').innerHTML = (data.champions||[]).map(c=>`<span class="tag champ">${c}</span>`).join('') || '<span class="status">none</span>';
    $('champPanel').style.display='block';

    matrix(data.agreement, models, color01, 'agreePanel', 'agree');
    matrix(data.error_correlation, models, colorCorr, 'corrPanel', 'corr');
  } catch (e) { $('status').textContent = 'Error: ' + e; }
  $('probeBtn').disabled = false;
}

$('loadBtn').addEventListener('click', loadModels);
$('probeBtn').addEventListener('click', runProbe);
</script>
</body>
</html>
"""


if __name__ == "__main__":  # pragma: no cover
    main()
