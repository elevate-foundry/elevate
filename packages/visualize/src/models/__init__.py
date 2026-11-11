"""Model loading, architecture profiles, and activation hook management."""

from src.models.loader import load_model, ModelBackend, LocalModelBackend
from src.models.hooks import HookManager
from src.models.profiles import ModelProfile, detect_profile, KNOWN_PROFILES

__all__ = [
    "load_model",
    "ModelBackend",
    "LocalModelBackend",
    "HookManager",
    "ModelProfile",
    "detect_profile",
    "KNOWN_PROFILES",
]
