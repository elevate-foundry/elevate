"""FastAPI server — WebSocket handler, REST API, and application startup.

This is the thin orchestrator that connects the model backend, ablation engine,
experiment store, and frontend via WebSocket and REST endpoints.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from src.experiments.store import ExperimentStore
from src.experiments.schemas import Experiment, ExperimentResult, ConceptDirection

# Heavy ML imports are lazy — not needed in Modal-only mode
def _import_local_deps():
    from src.models.loader import LocalModelBackend
    from src.ablation.prompts import make_concept_prompts, make_baseline_prompts
    from src.ablation.metrics import concept_recall
    return LocalModelBackend, make_concept_prompts, make_baseline_prompts, concept_recall

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── Global state ──────────────────────────────────────────────────────────

backend: ModelBackend | None = None
store: ExperimentStore | None = None

MODEL_NAME = os.environ.get("MODEL_NAME", "Qwen/Qwen3-0.6B")
DEVICE = os.environ.get("DEVICE", "auto")
DB_PATH = os.environ.get("DB_PATH", "data/experiments.db")
LOCAL_FILES_ONLY = os.environ.get("LOCAL_FILES_ONLY", "true").lower() == "true"
# Set BACKEND_MODE=modal to skip local model loading (Railway + Modal deployment)
BACKEND_MODE = os.environ.get("BACKEND_MODE", "local")
MODAL_GPU = os.environ.get("MODAL_GPU", "L40S")


# ── Lifespan ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global backend, store
    store = ExperimentStore(DB_PATH)
    if BACKEND_MODE == "modal":
        logger.info("Starting in Modal-only mode (no local model)")
        try:
            from src.modal_remote.client import ModalModelBackend
            backend = ModalModelBackend(model_name=MODEL_NAME, gpu=MODAL_GPU)
            logger.info(f"Modal backend configured: {MODEL_NAME} on {MODAL_GPU}")
        except Exception as e:
            logger.warning(f"Modal backend init failed: {e}. Server running without model.")
            backend = None
    else:
        LocalModelBackend, _, _, _ = _import_local_deps()
        backend = LocalModelBackend(
            model_name=MODEL_NAME,
            device=DEVICE,
            local_files_only=LOCAL_FILES_ONLY,
        )
    yield
    store.close()


app = FastAPI(title="LLM Neuron Visualizer", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Static files ──────────────────────────────────────────────────────────

@app.get("/")
async def root():
    # Serve React build if it exists, otherwise fall back to legacy static/index.html
    react_path = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist", "index.html")
    legacy_path = os.path.join(os.path.dirname(__file__), "..", "static", "index.html")
    if os.path.exists(react_path):
        return FileResponse(react_path)
    return FileResponse(legacy_path)

# Mount static dirs — React build takes priority if it exists
_frontend_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
_legacy_static = os.path.join(os.path.dirname(__file__), "..", "static")
if os.path.isdir(_frontend_dist):
    app.mount("/assets", StaticFiles(directory=os.path.join(_frontend_dist, "assets")), name="assets")
if os.path.isdir(_legacy_static):
    app.mount("/static", StaticFiles(directory=_legacy_static), name="static")


# ── REST API: Experiments ─────────────────────────────────────────────────

@app.get("/api/experiments")
async def list_experiments(type: str | None = None, concept: str | None = None, limit: int = 50, offset: int = 0):
    experiments = store.list_experiments(type_filter=type, concept_filter=concept, limit=limit, offset=offset)
    return [e.model_dump() for e in experiments]


@app.get("/api/experiments/{exp_id}")
async def get_experiment(exp_id: int):
    exp = store.get_experiment(exp_id)
    if exp is None:
        return JSONResponse({"error": "not found"}, status_code=404)
    results = store.get_results(exp_id)
    directions = store.get_concept_directions(exp_id)
    return {
        "experiment": exp.model_dump(),
        "results": [r.model_dump() for r in results],
        "concept_directions": [d.model_dump() for d in directions],
    }


@app.get("/api/experiments/{exp_id}/export")
async def export_experiment(exp_id: int):
    data = store.export_experiment(exp_id)
    if not data:
        return JSONResponse({"error": "not found"}, status_code=404)
    return data


@app.delete("/api/experiments/{exp_id}")
async def delete_experiment(exp_id: int):
    deleted = store.delete_experiment(exp_id)
    if not deleted:
        return JSONResponse({"error": "not found"}, status_code=404)
    return {"deleted": True}


@app.get("/api/models")
async def list_models():
    """Return info about the currently loaded model and available profiles."""
    from src.models.profiles import KNOWN_PROFILES
    info = backend.get_model_info() if backend else {}
    profiles = {k: {"name": v.name, "has_gated_mlp": v.has_gated_mlp} for k, v in KNOWN_PROFILES.items()}
    return {"current": info, "profiles": profiles}


@app.post("/api/models/switch")
async def switch_model(body: dict):
    """Switch to a different model. Supports local and Modal backends.

    Body: {model_name: str, backend: 'local' | 'modal', gpu?: str}
    """
    global backend
    model_name = body.get("model_name", MODEL_NAME)
    backend_type = body.get("backend", "local")

    if backend_type == "modal":
        try:
            from src.modal_remote.client import ModalModelBackend
            gpu = body.get("gpu", "L40S")
            backend = ModalModelBackend(model_name=model_name, gpu=gpu)
            info = backend.get_model_info()
            return {"status": "ok", "model_info": info}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)
    else:
        try:
            backend = LocalModelBackend(
                model_name=model_name,
                device=DEVICE,
                local_files_only=False,  # allow downloading new models
            )
            info = backend.get_model_info()
            return {"status": "ok", "model_info": info}
        except Exception as e:
            return JSONResponse({"error": str(e)}, status_code=500)


# ── Health check ──────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "backend_mode": BACKEND_MODE,
        "has_model": backend is not None,
        "model": backend.get_model_info()["name"] if backend else None,
    }


# ── REST API: Batch & Interference ────────────────────────────────────────

@app.post("/api/batch")
async def run_batch_endpoint(body: dict):
    """Run batch ablation experiments."""
    from src.experiments.batch import BatchConfig, run_batch
    config = BatchConfig(
        concepts=body.get("concepts", ["dog"]),
        prompts=body.get("prompts", ["A dog is a wonderful pet because"]),
        alphas=body.get("alphas", [1.0]),
        max_tokens=body.get("max_tokens", 32),
    )
    results = []
    for result in run_batch(backend, store, config):
        results.append({
            "concept": result.concept,
            "prompt": result.prompt,
            "alpha": result.alpha,
            "normal_text": result.normal_text,
            "ablated_text": result.ablated_text,
            "concept_recall_normal": result.concept_recall_normal,
            "concept_recall_ablated": result.concept_recall_ablated,
            "erasure_score": result.erasure_score,
            "layers_affected": result.layers_affected,
            "mean_cosine_sim": round(result.mean_cosine_sim, 4),
            "mean_diff_norm": round(result.mean_diff_norm, 4),
            "experiment_id": result.experiment_id,
        })
    return {"results": results, "total": len(results)}


@app.post("/api/interference")
async def interference_endpoint(body: dict):
    """Compute concept interference matrix."""
    from src.ablation.interference import compute_interference
    concepts = body.get("concepts", ["dog", "cat", "math"])
    result = compute_interference(backend, concepts)
    return {
        "concepts": result.concepts,
        "matrix": result.matrix,
        "per_layer_matrices": {str(k): v for k, v in result.per_layer_matrices.items()},
        "direction_norms": result.direction_norms,
    }


# ── WebSocket handler ─────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket connected")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg["type"] == "model_info":
                if backend:
                    info = backend.get_model_info()
                    await ws.send_text(json.dumps({"type": "model_info", "data": info}))
                else:
                    await ws.send_text(json.dumps({
                        "type": "model_info",
                        "data": {"name": "No model loaded", "num_layers": 0, "hidden_size": 0,
                                 "num_attention_heads": 0, "num_kv_heads": 0, "intermediate_size": 0,
                                 "vocab_size": 0, "total_params": "0", "device": "none"},
                    }))

            elif not backend:
                await ws.send_text(json.dumps({
                    "type": "error",
                    "message": "No model loaded. Switch to a model via the Model Selector.",
                }))

            elif msg["type"] == "generate":
                await _handle_generate(ws, msg)

            elif msg["type"] == "ablate":
                await _handle_ablate(ws, msg)

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        backend.remove_ablation()
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


async def _handle_generate(ws: WebSocket, msg: dict) -> None:
    """Handle a 'generate' message — run inference and stream results."""
    prompt = msg["prompt"]
    max_tokens = msg.get("max_tokens", 32)
    logger.info(f"Generating: {prompt!r} (max_tokens={max_tokens})")

    # Create experiment record
    exp = Experiment(
        model_name=backend.get_model_info()["name"],
        model_backend=f"local_{backend.get_model_info()['device']}",
        type="generation",
        prompt=prompt,
        max_tokens=max_tokens,
    )
    exp_id = store.create_experiment(exp)

    all_tokens = []
    for event, data_dict, tokens in backend.generate(prompt, max_tokens):
        all_tokens = tokens
        if event == "prefill":
            await ws.send_text(json.dumps({"type": "prefill", "data": data_dict}))
        elif event == "token":
            await ws.send_text(json.dumps({"type": "token", "data": data_dict}))
            await asyncio.sleep(0.05)
        elif event == "eos":
            await ws.send_text(json.dumps({"type": "done", "all_tokens": tokens}))
        elif event == "complete":
            await ws.send_text(json.dumps({
                "type": "complete",
                "all_tokens": tokens,
                "text": "".join(tokens),
            }))

    # Save result
    store.add_result(ExperimentResult(
        experiment_id=exp_id,
        variant="normal",
        output_text="".join(all_tokens),
        tokens=all_tokens,
    ))


async def _handle_ablate(ws: WebSocket, msg: dict) -> None:
    """Handle an 'ablate' message — compute directions, generate normal + ablated."""
    concept = msg["concept"]
    prompt = msg["prompt"]
    max_tokens = msg.get("max_tokens", 32)
    alpha = msg.get("alpha", 1.0)
    logger.info(f"Directional ablation: concept={concept!r}, prompt={prompt!r}, alpha={alpha}")

    # Create experiment record
    model_info = backend.get_model_info()
    exp = Experiment(
        model_name=model_info["name"],
        model_backend=f"local_{model_info['device']}",
        type="ablation",
        prompt=prompt,
        concept=concept,
        alpha=alpha,
        max_tokens=max_tokens,
    )
    exp_id = store.create_experiment(exp)

    _, make_concept_prompts, make_baseline_prompts, _ = _import_local_deps()
    concept_prompts = make_concept_prompts(concept)
    baseline_prompts = make_baseline_prompts()

    # Step 1: Compute concept directions
    await ws.send_text(json.dumps({
        "type": "ablation_status",
        "status": "probing",
        "message": f"Computing '{concept}' direction in residual space...",
    }))

    result = backend.compute_concept_directions(concept_prompts, baseline_prompts)
    directions = result["directions"]

    # Build per-layer stats
    num_layers = model_info["num_layers"]
    layer_stats = {}
    layer_stats_list = []
    for layer_idx in range(num_layers):
        stat = {
            "layer_idx": layer_idx,
            "has_direction": layer_idx in directions,
            "cosine_sim": round(result["cosine_sims"][layer_idx], 4),
            "diff_norm": round(result["norms"][layer_idx], 4),
            "concept_norm": round(result["concept_mean_norms"][layer_idx], 4),
            "baseline_norm": round(result["baseline_mean_norms"][layer_idx], 4),
        }
        layer_stats[str(layer_idx)] = stat
        layer_stats_list.append(stat)

    await ws.send_text(json.dumps({
        "type": "ablation_status",
        "status": "found",
        "message": f"Found '{concept}' direction across {len(directions)} layers "
                   f"(mean cos_sim={np.mean(result['cosine_sims']):.3f})",
        "layer_stats": layer_stats,
        "method": "directional",
        "total_layers": len(directions),
    }))

    # Save concept directions
    store.add_concept_direction(ConceptDirection(
        experiment_id=exp_id,
        model_name=model_info["name"],
        concept=concept,
        layer_stats=layer_stats_list,
    ))

    # Step 2: Normal generation
    await ws.send_text(json.dumps({
        "type": "ablation_status",
        "status": "generating_normal",
        "message": "Running normal generation...",
    }))

    normal_tokens = []
    normal_prefill = None
    for event, data_dict, all_tokens in backend.generate(prompt, max_tokens):
        if event == "prefill":
            normal_prefill = data_dict
        normal_tokens = all_tokens

    await ws.send_text(json.dumps({
        "type": "ablation_normal",
        "text": "".join(normal_tokens),
        "tokens": normal_tokens,
        "prefill": normal_prefill,
    }))

    store.add_result(ExperimentResult(
        experiment_id=exp_id,
        variant="normal",
        output_text="".join(normal_tokens),
        tokens=normal_tokens,
    ))

    # Step 3: Ablated generation
    await ws.send_text(json.dumps({
        "type": "ablation_status",
        "status": "generating_ablated",
        "message": f"Running directional ablation (alpha={alpha}, {len(directions)} layers)...",
    }))

    backend.install_ablation(directions, alpha=alpha)

    ablated_tokens = []
    ablated_prefill = None
    for event, data_dict, all_tokens in backend.generate(prompt, max_tokens):
        if event == "prefill":
            ablated_prefill = data_dict
        ablated_tokens = all_tokens

    backend.remove_ablation()

    # Compute quality metrics
    _, _, _, concept_recall_fn = _import_local_deps()
    normal_text = "".join(normal_tokens)
    ablated_text = "".join(ablated_tokens)
    recall_normal = concept_recall_fn(normal_text, concept)
    recall_ablated = concept_recall_fn(ablated_text, concept)
    erasure_score = 1.0 - recall_ablated

    await ws.send_text(json.dumps({
        "type": "ablation_ablated",
        "text": ablated_text,
        "tokens": ablated_tokens,
        "prefill": ablated_prefill,
    }))

    store.add_result(ExperimentResult(
        experiment_id=exp_id,
        variant="ablated",
        output_text=ablated_text,
        tokens=ablated_tokens,
        metrics={
            "concept_recall": round(recall_ablated, 4),
            "erasure_score": round(erasure_score, 4),
            "alpha": alpha,
            "layers_affected": len(directions),
            "mean_cosine_sim": round(float(np.mean(result["cosine_sims"])), 4),
            "mean_diff_norm": round(float(np.mean(result["norms"])), 4),
        },
    ))

    await ws.send_text(json.dumps({
        "type": "ablation_complete",
        "concept": concept,
        "experiment_id": exp_id,
        "normal_text": normal_text,
        "ablated_text": ablated_text,
        "method": "directional",
        "alpha": alpha,
        "layers_affected": len(directions),
        "mean_cosine_sim": round(float(np.mean(result["cosine_sims"])), 4),
        "mean_diff_norm": round(float(np.mean(result["norms"])), 4),
        "concept_recall_normal": round(recall_normal, 4),
        "concept_recall_ablated": round(recall_ablated, 4),
        "erasure_score": round(erasure_score, 4),
    }))


# ── Entrypoint ────────────────────────────────────────────────────────────

def main():
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)


if __name__ == "__main__":
    main()
