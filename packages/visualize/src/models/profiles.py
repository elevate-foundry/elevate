"""Model architecture profiles for hook registration.

Each profile describes how to navigate a specific transformer architecture
to find layers, MLP modules, attention modules, and gate projections.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class ModelProfile:
    """Describes how to find components in a specific architecture."""
    name: str
    layers_attr: str            # attribute path to layer list, e.g. 'model.layers'
    mlp_attr: str = "mlp"      # attribute on each layer for the MLP block
    attn_attr: str = "self_attn"  # attribute on each layer for the attention block
    gate_proj_attr: str | None = "gate_proj"  # attribute on MLP for gate projection (None if no gating)
    # Some architectures nest the transformer differently
    has_gated_mlp: bool = True


KNOWN_PROFILES: dict[str, ModelProfile] = {
    "qwen": ModelProfile(
        name="Qwen",
        layers_attr="model.layers",
        mlp_attr="mlp",
        attn_attr="self_attn",
        gate_proj_attr="gate_proj",
        has_gated_mlp=True,
    ),
    "llama": ModelProfile(
        name="Llama",
        layers_attr="model.layers",
        mlp_attr="mlp",
        attn_attr="self_attn",
        gate_proj_attr="gate_proj",
        has_gated_mlp=True,
    ),
    "mistral": ModelProfile(
        name="Mistral",
        layers_attr="model.layers",
        mlp_attr="mlp",
        attn_attr="self_attn",
        gate_proj_attr="gate_proj",
        has_gated_mlp=True,
    ),
    "gemma": ModelProfile(
        name="Gemma",
        layers_attr="model.layers",
        mlp_attr="mlp",
        attn_attr="self_attn",
        gate_proj_attr="gate_proj",
        has_gated_mlp=True,
    ),
    "phi": ModelProfile(
        name="Phi",
        layers_attr="model.layers",
        mlp_attr="mlp",
        attn_attr="self_attn",
        gate_proj_attr="gate_up_proj",
        has_gated_mlp=True,
    ),
    "gpt2": ModelProfile(
        name="GPT-2",
        layers_attr="transformer.h",
        mlp_attr="mlp",
        attn_attr="attn",
        gate_proj_attr=None,
        has_gated_mlp=False,
    ),
    "gpt_neo": ModelProfile(
        name="GPT-Neo",
        layers_attr="transformer.h",
        mlp_attr="mlp",
        attn_attr="attn",
        gate_proj_attr=None,
        has_gated_mlp=False,
    ),
}


def _resolve_attr(obj, attr_path: str):
    """Resolve a dotted attribute path like 'model.layers'."""
    for part in attr_path.split("."):
        obj = getattr(obj, part)
    return obj


def detect_profile(model) -> ModelProfile:
    """Auto-detect the architecture profile from a loaded model.

    Tries known profiles by checking if the layers_attr path resolves.
    Falls back to probing common patterns.
    """
    model_type = getattr(model.config, "model_type", "").lower()

    # Direct match on config.model_type
    if model_type in KNOWN_PROFILES:
        logger.info(f"Detected model type '{model_type}' from config")
        return KNOWN_PROFILES[model_type]

    # Substring match (e.g. 'qwen2' matches 'qwen')
    for key, profile in KNOWN_PROFILES.items():
        if key in model_type:
            logger.info(f"Detected model type '{model_type}' matching profile '{key}'")
            return profile

    # Probe common layer paths
    for profile in KNOWN_PROFILES.values():
        try:
            layers = _resolve_attr(model, profile.layers_attr)
            if hasattr(layers, "__len__") and len(layers) > 0:
                logger.info(f"Auto-detected profile '{profile.name}' via layer path '{profile.layers_attr}'")
                return profile
        except AttributeError:
            continue

    # Last resort: try the most common pattern
    logger.warning("Could not auto-detect model profile, falling back to Llama-style")
    return KNOWN_PROFILES["llama"]
