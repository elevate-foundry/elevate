"""
Backend server for LLM neuron firing visualization + directional ablation.
Loads Qwen3-0.6B, hooks into transformer layers to capture activations,
and streams firing data to the frontend via WebSocket.

Ablation uses Heretic-style directional ablation: computes a "concept direction"
in residual space as the mean difference between concept and baseline prompts,
then projects that direction out of the residual stream at each layer.
"""

import asyncio
import json
import logging
import os
import time
from typing import Optional

import numpy as np
import torch
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from transformers import AutoModelForCausalLM, AutoTokenizer

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="LLM Neuron Visualizer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Model config
MODEL_NAME = "Qwen/Qwen3-0.6B"
DEVICE = "mps" if torch.backends.mps.is_available() else "cpu"

# Global state
model = None
tokenizer = None
activation_hooks = []
captured_activations = {}

# Ablation state
ablation_hooks = []
concept_directions = {}  # {layer_idx: direction tensor [hidden_size]}


def load_model():
    """Load the model and tokenizer."""
    global model, tokenizer
    logger.info(f"Loading {MODEL_NAME} on {DEVICE}...")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME, trust_remote_code=True, local_files_only=True)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME,
        dtype=torch.float32,
        trust_remote_code=True,
        local_files_only=True,
    ).to(DEVICE)
    model.eval()
    logger.info(f"Model loaded: {sum(p.numel() for p in model.parameters())/1e6:.1f}M params")
    return model, tokenizer


def register_hooks():
    """Register forward hooks on all transformer layers to capture activations."""
    global activation_hooks, captured_activations
    for h in activation_hooks:
        h.remove()
    activation_hooks = []
    captured_activations = {}

    for layer_idx, layer in enumerate(model.model.layers):
        def make_attn_hook(idx):
            def hook(module, input, output):
                if isinstance(output, tuple):
                    hidden = output[0]
                else:
                    hidden = output
                captured_activations[f"attn_{idx}"] = hidden.detach().cpu().float()
            return hook

        def make_mlp_hook(idx):
            def hook(module, input, output):
                captured_activations[f"mlp_{idx}"] = output.detach().cpu().float()
            return hook

        def make_layer_hook(idx):
            def hook(module, input, output):
                if isinstance(output, tuple):
                    hidden = output[0]
                else:
                    hidden = output
                captured_activations[f"layer_{idx}"] = hidden.detach().cpu().float()
            return hook

        def make_gate_hook(idx):
            def hook(module, input, output):
                captured_activations[f"gate_{idx}"] = output.detach().cpu().float()
            return hook

        h1 = layer.self_attn.register_forward_hook(make_attn_hook(layer_idx))
        h2 = layer.mlp.register_forward_hook(make_mlp_hook(layer_idx))
        h3 = layer.register_forward_hook(make_layer_hook(layer_idx))
        activation_hooks.extend([h1, h2, h3])

        if hasattr(layer.mlp, 'gate_proj'):
            h4 = layer.mlp.gate_proj.register_forward_hook(make_gate_hook(layer_idx))
            activation_hooks.append(h4)

    logger.info(f"Registered {len(activation_hooks)} hooks across {len(model.model.layers)} layers")


# ── Directional ablation (Heretic-style) ──────────────────────────────────

def collect_residuals(prompts: list[str]) -> torch.Tensor:
    """Run prompts and collect per-layer residual vectors at the last token position.
    Returns tensor of shape [num_prompts, num_layers, hidden_size] in float32 on CPU.
    """
    num_layers = len(model.model.layers)
    all_residuals = []

    for prompt in prompts:
        inputs = tokenizer(prompt, return_tensors="pt", truncation=True, max_length=128)
        input_ids = inputs["input_ids"].to(DEVICE)

        captured_activations.clear()
        with torch.no_grad():
            model(input_ids)

        # Collect the last-token residual at each layer
        layer_residuals = []
        for layer_idx in range(num_layers):
            key = f"layer_{layer_idx}"
            if key in captured_activations:
                # Take last token position: [hidden_size]
                residual = captured_activations[key].squeeze(0)[-1].float()
                layer_residuals.append(residual)
            else:
                layer_residuals.append(torch.zeros(model.config.hidden_size))

        all_residuals.append(torch.stack(layer_residuals))  # [num_layers, hidden_size]

    return torch.stack(all_residuals)  # [num_prompts, num_layers, hidden_size]


def compute_concept_directions(
    concept_prompts: list[str],
    baseline_prompts: list[str],
    alpha: float = 1.0,
) -> dict:
    """Compute per-layer concept directions using directional ablation.

    The concept direction at each layer is the normalized difference between
    the mean residual for concept prompts and the mean residual for baseline
    prompts. This is the same approach used by Heretic/abliteration.

    Args:
        concept_prompts: prompts that activate the concept
        baseline_prompts: generic prompts that don't
        alpha: ablation strength (1.0 = full projection, <1.0 = partial)

    Returns dict with:
        - directions: {layer_idx: normalized direction tensor on DEVICE}
        - cosine_sims: per-layer cosine similarity between concept/baseline means
        - norms: per-layer norm of the raw (un-normalized) difference
        - concept_mean_norms: per-layer norm of concept mean residual
        - baseline_mean_norms: per-layer norm of baseline mean residual
    """
    logger.info(f"Computing concept directions from {len(concept_prompts)} concept + {len(baseline_prompts)} baseline prompts...")

    concept_residuals = collect_residuals(concept_prompts)    # [N, L, H]
    baseline_residuals = collect_residuals(baseline_prompts)  # [M, L, H]

    concept_mean = concept_residuals.mean(dim=0)    # [L, H]
    baseline_mean = baseline_residuals.mean(dim=0)  # [L, H]

    num_layers = concept_mean.shape[0]
    directions = {}
    cosine_sims = []
    norms = []
    concept_mean_norms = []
    baseline_mean_norms = []

    for layer_idx in range(num_layers):
        c = concept_mean[layer_idx]    # [H]
        b = baseline_mean[layer_idx]   # [H]
        diff = c - b

        raw_norm = diff.norm().item()
        norms.append(raw_norm)
        concept_mean_norms.append(c.norm().item())
        baseline_mean_norms.append(b.norm().item())

        # Cosine similarity between concept and baseline means
        cos_sim = torch.nn.functional.cosine_similarity(c.unsqueeze(0), b.unsqueeze(0)).item()
        cosine_sims.append(cos_sim)

        # Normalize to get the direction
        if raw_norm > 1e-8:
            direction = torch.nn.functional.normalize(diff.unsqueeze(0), p=2, dim=1).squeeze(0)
            directions[layer_idx] = direction.to(DEVICE)

    logger.info(f"Computed directions for {len(directions)} layers, "
                f"mean cosine_sim={np.mean(cosine_sims):.4f}, "
                f"mean diff_norm={np.mean(norms):.4f}")

    return {
        "directions": directions,
        "cosine_sims": cosine_sims,
        "norms": norms,
        "concept_mean_norms": concept_mean_norms,
        "baseline_mean_norms": baseline_mean_norms,
    }


def install_directional_ablation(directions: dict[int, torch.Tensor], alpha: float = 1.0):
    """Install hooks that project out the concept direction from the residual stream.

    At each layer, for hidden state h and concept direction d:
        h_ablated = h - alpha * (h . d) * d

    This removes the component of h along direction d, erasing that concept
    from the representation while preserving everything orthogonal to it.
    """
    global ablation_hooks
    remove_ablation_hooks()

    for layer_idx, direction in directions.items():
        if layer_idx >= len(model.model.layers):
            continue
        layer = model.model.layers[layer_idx]

        def make_projection_hook(d, a):
            def hook(module, input, output):
                if isinstance(output, tuple):
                    hidden = output[0]
                else:
                    hidden = output
                # Project out the concept direction:
                # projection = (hidden . d) * d, then subtract
                proj = torch.einsum('...h,h->...', hidden, d).unsqueeze(-1) * d
                hidden_ablated = hidden - a * proj
                if isinstance(output, tuple):
                    return (hidden_ablated,) + output[1:]
                return hidden_ablated
            return hook

        h = layer.register_forward_hook(make_projection_hook(direction, alpha))
        ablation_hooks.append(h)

    logger.info(f"Installed directional ablation on {len(ablation_hooks)} layers (alpha={alpha})")


def remove_ablation_hooks():
    """Remove all ablation hooks."""
    global ablation_hooks, concept_directions
    for h in ablation_hooks:
        h.remove()
    ablation_hooks = []


# ── Activation processing ────────────────────────────────────────────────

def process_activations(tokens: list[str]) -> dict:
    """Process captured activations into visualization-ready data."""
    num_layers = len(model.model.layers)
    result = {
        "tokens": tokens,
        "num_layers": num_layers,
        "hidden_size": model.config.hidden_size,
        "num_attention_heads": model.config.num_attention_heads,
        "intermediate_size": getattr(model.config, 'intermediate_size', 3072),
        "layers": [],
    }

    for layer_idx in range(num_layers):
        layer_data = {"layer_idx": layer_idx}

        key = f"layer_{layer_idx}"
        if key in captured_activations:
            act = captured_activations[key].squeeze(0)
            layer_data["residual"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "max": act.max(dim=-1).values.tolist(),
                "min": act.min(dim=-1).values.tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        key = f"mlp_{layer_idx}"
        if key in captured_activations:
            act = captured_activations[key].squeeze(0)
            layer_data["mlp"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "max": act.max(dim=-1).values.tolist(),
                "l2_norm": act.norm(dim=-1).tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        key = f"gate_{layer_idx}"
        if key in captured_activations:
            act = captured_activations[key].squeeze(0)
            gate_values = torch.nn.functional.silu(act)
            threshold = 0.1
            firing_mask = (gate_values.abs() > threshold).float()
            layer_data["gate"] = {
                "firing_rate": firing_mask.mean(dim=-1).tolist(),
                "mean_activation": gate_values.mean(dim=-1).tolist(),
                "max_activation": gate_values.max(dim=-1).values.tolist(),
                "heatmap": downsample_heatmap(gate_values, max_neurons=256).tolist(),
                "firing_heatmap": downsample_heatmap(firing_mask, max_neurons=256).tolist(),
            }

        key = f"attn_{layer_idx}"
        if key in captured_activations:
            act = captured_activations[key].squeeze(0)
            layer_data["attention"] = {
                "mean": act.mean(dim=-1).tolist(),
                "std": act.std(dim=-1).tolist(),
                "l2_norm": act.norm(dim=-1).tolist(),
                "heatmap": downsample_heatmap(act, max_neurons=128).tolist(),
            }

        result["layers"].append(layer_data)

    return result


def downsample_heatmap(tensor: torch.Tensor, max_neurons: int = 128) -> torch.Tensor:
    """Downsample a [seq_len, hidden_dim] tensor to [seq_len, max_neurons] for visualization."""
    if tensor.dim() == 1:
        tensor = tensor.unsqueeze(0)
    seq_len, hidden_dim = tensor.shape
    if hidden_dim <= max_neurons:
        return tensor
    chunk_size = hidden_dim // max_neurons
    trimmed = tensor[:, :chunk_size * max_neurons]
    return trimmed.reshape(seq_len, max_neurons, chunk_size).mean(dim=-1)


def generate_tokens(input_ids, max_tokens):
    """Generate tokens autoregressively, yielding (token_str, activations_dict) per step."""
    captured_activations.clear()
    with torch.no_grad():
        outputs = model(input_ids, use_cache=True)

    token_strings = [tokenizer.decode(t) for t in input_ids[0]]
    prefill_data = process_activations(token_strings)
    yield "prefill", prefill_data, token_strings

    past_key_values = outputs.past_key_values
    next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)
    all_token_strings = list(token_strings)

    for step in range(max_tokens):
        new_token_str = tokenizer.decode(next_token_id[0])
        all_token_strings.append(new_token_str)

        if next_token_id.item() == tokenizer.eos_token_id:
            yield "eos", None, all_token_strings
            break

        captured_activations.clear()
        with torch.no_grad():
            outputs = model(
                next_token_id,
                past_key_values=past_key_values,
                use_cache=True,
            )
        past_key_values = outputs.past_key_values

        step_data = process_activations([new_token_str])
        step_data["step"] = step
        step_data["all_tokens"] = all_token_strings
        yield "token", step_data, all_token_strings

        next_token_id = outputs.logits[:, -1, :].argmax(dim=-1, keepdim=True)

    yield "complete", None, all_token_strings


# ── WebSocket handler ─────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    load_model()
    register_hooks()


@app.get("/")
async def root():
    return FileResponse("static/index.html")


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    logger.info("WebSocket connected")
    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg["type"] == "generate":
                prompt = msg["prompt"]
                max_tokens = msg.get("max_tokens", 32)
                logger.info(f"Generating: {prompt!r} (max_tokens={max_tokens})")

                inputs = tokenizer(prompt, return_tensors="pt", padding=False, truncation=True, max_length=512)
                input_ids = inputs["input_ids"].to(DEVICE)

                for event, data_dict, all_tokens in generate_tokens(input_ids, max_tokens):
                    if event == "prefill":
                        await ws.send_text(json.dumps({"type": "prefill", "data": data_dict}))
                    elif event == "token":
                        await ws.send_text(json.dumps({"type": "token", "data": data_dict}))
                        await asyncio.sleep(0.05)
                    elif event == "eos":
                        await ws.send_text(json.dumps({"type": "done", "all_tokens": all_tokens}))
                    elif event == "complete":
                        await ws.send_text(json.dumps({
                            "type": "complete",
                            "all_tokens": all_tokens,
                            "text": "".join(all_tokens),
                        }))

            elif msg["type"] == "ablate":
                concept = msg["concept"]
                prompt = msg["prompt"]
                max_tokens = msg.get("max_tokens", 32)
                alpha = msg.get("alpha", 1.0)
                logger.info(f"Directional ablation: concept={concept!r}, prompt={prompt!r}, alpha={alpha}")

                # Generate concept and baseline prompts
                concept_prompts = [
                    f"The {concept} is",
                    f"A {concept} can",
                    f"I saw a {concept}",
                    f"The {concept} was very",
                    f"Tell me about {concept}s",
                    f"{concept.capitalize()} are known for",
                    f"My favorite {concept}",
                    f"A baby {concept} is called",
                ]
                baseline_prompts = [
                    "The weather today is",
                    "Mathematics involves the study of",
                    "The color of the sky is",
                    "A computer program can",
                    "The history of civilization",
                    "Music is composed of",
                    "The ocean covers most of",
                    "A book contains many",
                ]

                await ws.send_text(json.dumps({
                    "type": "ablation_status",
                    "status": "probing",
                    "message": f"Computing '{concept}' direction in residual space...",
                }))

                # Step 1: Compute concept direction per layer
                result = compute_concept_directions(concept_prompts, baseline_prompts, alpha=alpha)
                directions = result["directions"]

                # Build per-layer stats for frontend
                layer_stats = {}
                for layer_idx in range(len(model.model.layers)):
                    layer_stats[str(layer_idx)] = {
                        "has_direction": layer_idx in directions,
                        "cosine_sim": round(result["cosine_sims"][layer_idx], 4),
                        "diff_norm": round(result["norms"][layer_idx], 4),
                        "concept_norm": round(result["concept_mean_norms"][layer_idx], 4),
                        "baseline_norm": round(result["baseline_mean_norms"][layer_idx], 4),
                    }

                await ws.send_text(json.dumps({
                    "type": "ablation_status",
                    "status": "found",
                    "message": f"Found '{concept}' direction across {len(directions)} layers (mean cos_sim={np.mean(result['cosine_sims']):.3f})",
                    "layer_stats": layer_stats,
                    "method": "directional",
                    "total_layers": len(directions),
                }))

                # Step 2: Normal generation (no ablation)
                await ws.send_text(json.dumps({
                    "type": "ablation_status",
                    "status": "generating_normal",
                    "message": "Running normal generation...",
                }))

                inputs = tokenizer(prompt, return_tensors="pt", padding=False, truncation=True, max_length=512)
                input_ids = inputs["input_ids"].to(DEVICE)

                normal_tokens = []
                normal_prefill = None
                for event, data_dict, all_tokens in generate_tokens(input_ids, max_tokens):
                    if event == "prefill":
                        normal_prefill = data_dict
                    normal_tokens = all_tokens

                await ws.send_text(json.dumps({
                    "type": "ablation_normal",
                    "text": "".join(normal_tokens),
                    "tokens": normal_tokens,
                    "prefill": normal_prefill,
                }))

                # Step 3: Ablated generation (project out concept direction)
                await ws.send_text(json.dumps({
                    "type": "ablation_status",
                    "status": "generating_ablated",
                    "message": f"Running directional ablation (alpha={alpha}, {len(directions)} layers)...",
                }))

                install_directional_ablation(directions, alpha=alpha)

                ablated_tokens = []
                ablated_prefill = None
                for event, data_dict, all_tokens in generate_tokens(input_ids, max_tokens):
                    if event == "prefill":
                        ablated_prefill = data_dict
                    ablated_tokens = all_tokens

                remove_ablation_hooks()

                await ws.send_text(json.dumps({
                    "type": "ablation_ablated",
                    "text": "".join(ablated_tokens),
                    "tokens": ablated_tokens,
                    "prefill": ablated_prefill,
                }))

                await ws.send_text(json.dumps({
                    "type": "ablation_complete",
                    "concept": concept,
                    "normal_text": "".join(normal_tokens),
                    "ablated_text": "".join(ablated_tokens),
                    "method": "directional",
                    "alpha": alpha,
                    "layers_affected": len(directions),
                    "mean_cosine_sim": round(float(np.mean(result["cosine_sims"])), 4),
                    "mean_diff_norm": round(float(np.mean(result["norms"])), 4),
                }))

            elif msg["type"] == "model_info":
                config = model.config
                await ws.send_text(json.dumps({
                    "type": "model_info",
                    "data": {
                        "name": MODEL_NAME,
                        "num_layers": config.num_hidden_layers,
                        "hidden_size": config.hidden_size,
                        "num_attention_heads": config.num_attention_heads,
                        "num_kv_heads": getattr(config, 'num_key_value_heads', config.num_attention_heads),
                        "intermediate_size": getattr(config, 'intermediate_size', 3072),
                        "vocab_size": config.vocab_size,
                        "total_params": f"{sum(p.numel() for p in model.parameters())/1e6:.1f}M",
                        "device": str(DEVICE),
                    }
                }))

    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        remove_ablation_hooks()
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)
