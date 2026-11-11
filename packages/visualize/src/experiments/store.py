"""SQLite experiment store for persisting experiment metadata and results."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from src.experiments.schemas import Experiment, ExperimentResult, ConceptDirection

logger = logging.getLogger(__name__)

SCHEMA = """
CREATE TABLE IF NOT EXISTS experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_name TEXT NOT NULL,
    model_backend TEXT NOT NULL DEFAULT 'local',
    type TEXT NOT NULL DEFAULT 'generation',
    prompt TEXT NOT NULL,
    concept TEXT,
    alpha REAL,
    max_tokens INTEGER DEFAULT 32,
    metadata TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    variant TEXT NOT NULL DEFAULT 'normal',
    output_text TEXT DEFAULT '',
    tokens TEXT DEFAULT '[]',
    activations_path TEXT,
    metrics TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS concept_directions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    experiment_id INTEGER NOT NULL REFERENCES experiments(id),
    model_name TEXT NOT NULL,
    concept TEXT NOT NULL,
    layer_stats TEXT DEFAULT '[]',
    directions_path TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
"""


class ExperimentStore:
    """SQLite-backed experiment store."""

    def __init__(self, db_path: str = "data/experiments.db"):
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path) or ".", exist_ok=True)
        self._conn = sqlite3.connect(db_path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()
        logger.info(f"Experiment store initialized at {db_path}")

    def create_experiment(self, exp: Experiment) -> int:
        """Insert a new experiment, return its ID."""
        cur = self._conn.execute(
            """INSERT INTO experiments (model_name, model_backend, type, prompt, concept, alpha, max_tokens, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                exp.model_name,
                exp.model_backend,
                exp.type,
                exp.prompt,
                exp.concept,
                exp.alpha,
                exp.max_tokens,
                json.dumps(exp.metadata),
            ),
        )
        self._conn.commit()
        return cur.lastrowid

    def add_result(self, result: ExperimentResult) -> int:
        """Insert a result for an experiment, return its ID."""
        cur = self._conn.execute(
            """INSERT INTO results (experiment_id, variant, output_text, tokens, activations_path, metrics)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (
                result.experiment_id,
                result.variant,
                result.output_text,
                json.dumps(result.tokens),
                result.activations_path,
                json.dumps(result.metrics),
            ),
        )
        self._conn.commit()
        return cur.lastrowid

    def add_concept_direction(self, cd: ConceptDirection) -> int:
        """Insert concept direction metadata, return its ID."""
        cur = self._conn.execute(
            """INSERT INTO concept_directions (experiment_id, model_name, concept, layer_stats, directions_path)
               VALUES (?, ?, ?, ?, ?)""",
            (
                cd.experiment_id,
                cd.model_name,
                cd.concept,
                json.dumps(cd.layer_stats),
                cd.directions_path,
            ),
        )
        self._conn.commit()
        return cur.lastrowid

    def get_experiment(self, exp_id: int) -> Experiment | None:
        """Fetch a single experiment by ID."""
        row = self._conn.execute(
            "SELECT * FROM experiments WHERE id = ?", (exp_id,)
        ).fetchone()
        if row is None:
            return None
        return self._row_to_experiment(row)

    def list_experiments(
        self,
        type_filter: str | None = None,
        concept_filter: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[Experiment]:
        """List experiments with optional filters."""
        query = "SELECT * FROM experiments WHERE 1=1"
        params: list[Any] = []
        if type_filter:
            query += " AND type = ?"
            params.append(type_filter)
        if concept_filter:
            query += " AND concept = ?"
            params.append(concept_filter)
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        rows = self._conn.execute(query, params).fetchall()
        return [self._row_to_experiment(r) for r in rows]

    def get_results(self, experiment_id: int) -> list[ExperimentResult]:
        """Fetch all results for an experiment."""
        rows = self._conn.execute(
            "SELECT * FROM results WHERE experiment_id = ? ORDER BY variant",
            (experiment_id,),
        ).fetchall()
        return [self._row_to_result(r) for r in rows]

    def get_concept_directions(self, experiment_id: int) -> list[ConceptDirection]:
        """Fetch concept directions for an experiment."""
        rows = self._conn.execute(
            "SELECT * FROM concept_directions WHERE experiment_id = ?",
            (experiment_id,),
        ).fetchall()
        return [self._row_to_concept_direction(r) for r in rows]

    def delete_experiment(self, exp_id: int) -> bool:
        """Delete an experiment and its results."""
        self._conn.execute("DELETE FROM results WHERE experiment_id = ?", (exp_id,))
        self._conn.execute("DELETE FROM concept_directions WHERE experiment_id = ?", (exp_id,))
        cur = self._conn.execute("DELETE FROM experiments WHERE id = ?", (exp_id,))
        self._conn.commit()
        return cur.rowcount > 0

    def export_experiment(self, exp_id: int) -> dict:
        """Export a full experiment with all results as a dict."""
        exp = self.get_experiment(exp_id)
        if exp is None:
            return {}
        results = self.get_results(exp_id)
        directions = self.get_concept_directions(exp_id)
        return {
            "experiment": exp.model_dump(),
            "results": [r.model_dump() for r in results],
            "concept_directions": [d.model_dump() for d in directions],
        }

    def close(self) -> None:
        self._conn.close()

    # ── Row conversion helpers ────────────────────────────────────────

    @staticmethod
    def _row_to_experiment(row: sqlite3.Row) -> Experiment:
        return Experiment(
            id=row["id"],
            model_name=row["model_name"],
            model_backend=row["model_backend"],
            type=row["type"],
            prompt=row["prompt"],
            concept=row["concept"],
            alpha=row["alpha"],
            max_tokens=row["max_tokens"],
            metadata=json.loads(row["metadata"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_result(row: sqlite3.Row) -> ExperimentResult:
        return ExperimentResult(
            id=row["id"],
            experiment_id=row["experiment_id"],
            variant=row["variant"],
            output_text=row["output_text"],
            tokens=json.loads(row["tokens"]),
            activations_path=row["activations_path"],
            metrics=json.loads(row["metrics"]),
            created_at=row["created_at"],
        )

    @staticmethod
    def _row_to_concept_direction(row: sqlite3.Row) -> ConceptDirection:
        return ConceptDirection(
            id=row["id"],
            experiment_id=row["experiment_id"],
            model_name=row["model_name"],
            concept=row["concept"],
            layer_stats=json.loads(row["layer_stats"]),
            directions_path=row["directions_path"],
            created_at=row["created_at"],
        )
