"""Model router / horserace scheduler.

Treats every locally available model as a candidate. Picks the best one
for each request based on hardware-aware scoring: model size vs available
RAM, past performance (latency, success rate), and capability fit.

Capabilities (text, vision, tools, thinking, etc.) are discovered at
runtime from Ollama's ``/api/show`` endpoint -- NOTHING is hardcoded.
Each request carries a modality tag so the router matches models to tasks.

The horserace works by:
  1. Discovering all local models + their capabilities from Ollama.
  2. Filtering to models that support the requested modality.
  3. Scoring survivors against hardware + performance history.
  4. On error, falling back through the ranked list until one succeeds.

All discovery is runtime -- nothing is hardcoded.
"""

from __future__ import annotations

import enum
import time
from dataclasses import dataclass, field
from typing import Any

from .model import Message, chat, list_local_models, show_model


class Modality(enum.Enum):
    """What kind of task is being routed."""
    TEXT = "text"        # plain text chat (any model with "completion")
    TOOLS = "tools"      # tool-calling required
    VISION = "vision"    # image understanding
    CODE = "code"        # code generation (prefers code-family models)
    THINKING = "thinking"  # chain-of-thought / reasoning


@dataclass
class ModelScore:
    """Tracks a model's discovered capabilities and performance history."""
    name: str
    param_size_b: float = 0.0
    capabilities: list[str] = field(default_factory=list)
    family: str = ""
    families: list[str] = field(default_factory=list)
    quantization: str = ""
    total_calls: int = 0
    total_errors: int = 0
    total_latency_s: float = 0.0
    last_latency_s: float = 0.0

    @property
    def avg_latency_s(self) -> float:
        return self.total_latency_s / max(self.total_calls, 1)

    @property
    def success_rate(self) -> float:
        if self.total_calls == 0:
            return 1.0
        return 1.0 - (self.total_errors / self.total_calls)

    def has_capability(self, cap: str) -> bool:
        return cap in self.capabilities

    def supports_modality(self, modality: Modality) -> bool:
        if modality == Modality.TEXT:
            return True  # every model can do text
        if modality == Modality.TOOLS:
            return self.has_capability("tools")
        if modality == Modality.VISION:
            return self.has_capability("vision")
        if modality == Modality.THINKING:
            return self.has_capability("thinking")
        if modality == Modality.CODE:
            # prefer code-family models, but any model with completion works
            return True
        return True

    def record_call(self, latency: float, success: bool) -> None:
        self.total_calls += 1
        self.total_latency_s += latency
        self.last_latency_s = latency
        if not success:
            self.total_errors += 1


def _parse_size_b(details: dict[str, Any]) -> float:
    """Best-effort extraction of param size in billions from Ollama model info."""
    param_size = details.get("parameter_size", "")
    if isinstance(param_size, str):
        param_size = param_size.upper().strip()
        if param_size.endswith("B"):
            try:
                return float(param_size[:-1])
            except ValueError:
                pass
    size_bytes = details.get("size", 0)
    if isinstance(size_bytes, (int, float)) and size_bytes > 0:
        return round(size_bytes / 1e9, 1)
    return 0.0


class ModelRouter:
    """Hardware-aware, capability-aware model selector."""

    def __init__(self, ram_total_gb: float | None = None):
        self._ram_gb = ram_total_gb or 0.0
        self._scores: dict[str, ModelScore] = {}
        self._preferred: str | None = None

    def discover(self) -> list[str]:
        """Refresh the list of locally available models and probe each for capabilities."""
        models = list_local_models()
        names = []
        for m in models:
            name = m.get("name", "")
            if not name:
                continue
            names.append(name)
            if name not in self._scores:
                details = m.get("details", {})
                # Probe Ollama for full metadata (capabilities, family, etc.)
                meta = show_model(name)
                caps = meta.get("capabilities", [])
                meta_details = meta.get("details", details)
                self._scores[name] = ModelScore(
                    name=name,
                    param_size_b=_parse_size_b(meta_details or details),
                    capabilities=caps if isinstance(caps, list) else [],
                    family=(meta_details or details).get("family", ""),
                    families=(meta_details or details).get("families", []),
                    quantization=(meta_details or details).get("quantization_level", ""),
                )
        return names

    def score(self, name: str, modality: Modality = Modality.TOOLS) -> float:
        """Compute a selection score (higher = better candidate).

        Factors: modality match, fits in RAM, success rate, inverse latency.
        Code-family models get a bonus for CODE modality.
        """
        ms = self._scores.get(name)
        if not ms:
            return 0.0
        if not ms.supports_modality(modality):
            return 0.0
        s = 1.0
        # RAM gate
        if self._ram_gb > 0 and ms.param_size_b > 0:
            if ms.param_size_b > self._ram_gb * 0.8:
                return 0.0  # won't fit
        # Code-family bonus
        if modality == Modality.CODE:
            lower = ms.name.lower()
            if any(t in lower for t in ("code", "coder", "codellama", "starcoder", "deepseek-coder")):
                s *= 1.5
        s *= ms.success_rate
        if ms.avg_latency_s > 0:
            s *= 1.0 / (1.0 + ms.avg_latency_s)
        return s

    def pick(self, modality: Modality = Modality.TOOLS, candidates: list[str] | None = None) -> str | None:
        """Pick the best model for the given modality."""
        if self._preferred:
            return self._preferred
        pool = candidates or list(self._scores.keys())
        if not pool:
            pool = self.discover()
        if not pool:
            return None
        scored = [(name, self.score(name, modality)) for name in pool]
        scored.sort(key=lambda x: x[1], reverse=True)
        best = scored[0]
        if best[1] <= 0:
            # No model explicitly supports this modality; fall back to first available
            return pool[0]
        return best[0]

    def ranked(self, modality: Modality = Modality.TOOLS, candidates: list[str] | None = None) -> list[str]:
        """Return ALL models ranked by score for the given modality.

        The agent uses this for fallback: try the top model, on failure try
        the next, and so on through every model that fits in RAM.
        """
        pool = candidates or list(self._scores.keys())
        if not pool:
            pool = self.discover()
        scored = [(name, self.score(name, modality)) for name in pool]
        scored.sort(key=lambda x: x[1], reverse=True)
        return [name for name, _ in scored]

    def set_preferred(self, name: str | None) -> None:
        self._preferred = name

    def record_result(self, model: str, latency: float, success: bool) -> None:
        if model not in self._scores:
            self._scores[model] = ModelScore(name=model)
        self._scores[model].record_call(latency, success)

    def race(self, candidates: list[str], probe_prompt: str = "Say hello in one sentence.") -> str | None:
        """Race candidates on a simple prompt; return the fastest coherent one."""
        results: list[tuple[str, float]] = []
        for name in candidates[:4]:
            t0 = time.monotonic()
            try:
                resp = chat(name, [Message(role="user", content=probe_prompt)], timeout=30.0)
                latency = time.monotonic() - t0
                if resp.content.strip():
                    results.append((name, latency))
                    self.record_result(name, latency, True)
                else:
                    self.record_result(name, latency, False)
            except Exception:
                self.record_result(name, time.monotonic() - t0, False)
        if not results:
            return candidates[0] if candidates else None
        results.sort(key=lambda x: x[1])
        return results[0][0]

    def status(self) -> dict[str, Any]:
        return {
            "ram_total_gb": self._ram_gb,
            "preferred": self._preferred,
            "models": {
                name: {
                    "param_size_b": ms.param_size_b,
                    "capabilities": ms.capabilities,
                    "family": ms.family,
                    "calls": ms.total_calls,
                    "success_rate": round(ms.success_rate, 3),
                    "avg_latency_s": round(ms.avg_latency_s, 3),
                }
                for name, ms in self._scores.items()
            },
        }
