"""Pydantic schemas for experiment data."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class Experiment(BaseModel):
    id: int | None = None
    model_name: str
    model_backend: str = "local"  # 'local_mps', 'local_cpu', 'local_cuda', 'modal_gpu'
    type: str = "generation"  # 'generation', 'ablation', 'batch_ablation'
    prompt: str
    concept: str | None = None
    alpha: float | None = None
    max_tokens: int = 32
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class ExperimentResult(BaseModel):
    id: int | None = None
    experiment_id: int
    variant: str = "normal"  # 'normal', 'ablated'
    output_text: str = ""
    tokens: list[str] = Field(default_factory=list)
    activations_path: str | None = None  # path to .npz file
    metrics: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime | None = None


class ConceptDirection(BaseModel):
    id: int | None = None
    experiment_id: int
    model_name: str
    concept: str
    layer_stats: list[dict[str, Any]] = Field(default_factory=list)
    directions_path: str | None = None  # path to .pt file
    created_at: datetime | None = None
