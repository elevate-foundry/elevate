"""Unit tests for the SQLite experiment store."""

import os
import pytest
import tempfile
from src.experiments.store import ExperimentStore
from src.experiments.schemas import Experiment, ExperimentResult, ConceptDirection


@pytest.fixture
def store():
    """Create an in-memory-like store using a temp file."""
    with tempfile.TemporaryDirectory() as tmpdir:
        db_path = os.path.join(tmpdir, "test.db")
        s = ExperimentStore(db_path)
        yield s
        s.close()


class TestExperimentCRUD:
    def test_create_experiment(self, store):
        exp = Experiment(
            model_name="Qwen/Qwen3-0.6B",
            model_backend="local_mps",
            type="generation",
            prompt="Hello world",
            max_tokens=20,
        )
        exp_id = store.create_experiment(exp)
        assert exp_id > 0

    def test_get_experiment(self, store):
        exp = Experiment(
            model_name="Qwen/Qwen3-0.6B",
            model_backend="local_mps",
            type="ablation",
            prompt="A dog is",
            concept="dog",
            alpha=1.0,
        )
        exp_id = store.create_experiment(exp)
        fetched = store.get_experiment(exp_id)

        assert fetched is not None
        assert fetched.model_name == "Qwen/Qwen3-0.6B"
        assert fetched.type == "ablation"
        assert fetched.concept == "dog"
        assert fetched.alpha == 1.0

    def test_get_nonexistent(self, store):
        assert store.get_experiment(99999) is None

    def test_list_experiments(self, store):
        for i in range(5):
            store.create_experiment(Experiment(
                model_name="test",
                model_backend="cpu",
                type="generation" if i % 2 == 0 else "ablation",
                prompt=f"prompt {i}",
            ))
        exps = store.list_experiments()
        assert len(exps) == 5

    def test_list_with_type_filter(self, store):
        store.create_experiment(Experiment(model_name="t", model_backend="c", type="generation", prompt="a"))
        store.create_experiment(Experiment(model_name="t", model_backend="c", type="ablation", prompt="b"))
        store.create_experiment(Experiment(model_name="t", model_backend="c", type="generation", prompt="c"))

        gen_exps = store.list_experiments(type_filter="generation")
        assert len(gen_exps) == 2

        abl_exps = store.list_experiments(type_filter="ablation")
        assert len(abl_exps) == 1

    def test_list_with_limit_offset(self, store):
        for i in range(10):
            store.create_experiment(Experiment(model_name="t", model_backend="c", type="g", prompt=str(i)))

        page1 = store.list_experiments(limit=3, offset=0)
        page2 = store.list_experiments(limit=3, offset=3)
        assert len(page1) == 3
        assert len(page2) == 3
        # Should be different experiments
        assert page1[0].id != page2[0].id

    def test_delete_experiment(self, store):
        exp_id = store.create_experiment(Experiment(model_name="t", model_backend="c", type="g", prompt="del"))
        store.add_result(ExperimentResult(experiment_id=exp_id, variant="normal", output_text="hi"))

        assert store.delete_experiment(exp_id)
        assert store.get_experiment(exp_id) is None
        assert len(store.get_results(exp_id)) == 0

    def test_delete_nonexistent(self, store):
        assert store.delete_experiment(99999) is False


class TestResults:
    def test_add_and_get_results(self, store):
        exp_id = store.create_experiment(Experiment(model_name="t", model_backend="c", type="ablation", prompt="p"))

        store.add_result(ExperimentResult(
            experiment_id=exp_id,
            variant="normal",
            output_text="normal output text",
            tokens=["normal", " output"],
        ))
        store.add_result(ExperimentResult(
            experiment_id=exp_id,
            variant="ablated",
            output_text="ablated output text",
            tokens=["ablated", " output"],
            metrics={"kl_div": 0.5},
        ))

        results = store.get_results(exp_id)
        assert len(results) == 2
        # Results are ordered by variant
        assert results[0].variant == "ablated"
        assert results[1].variant == "normal"
        assert results[0].metrics["kl_div"] == 0.5
        assert results[1].tokens == ["normal", " output"]


class TestConceptDirections:
    def test_add_and_get_concept_direction(self, store):
        exp_id = store.create_experiment(Experiment(model_name="t", model_backend="c", type="ablation", prompt="p"))

        store.add_concept_direction(ConceptDirection(
            experiment_id=exp_id,
            model_name="Qwen/Qwen3-0.6B",
            concept="dog",
            layer_stats=[
                {"layer_idx": 0, "diff_norm": 1.5, "cosine_sim": 0.8},
                {"layer_idx": 1, "diff_norm": 2.3, "cosine_sim": 0.7},
            ],
        ))

        dirs = store.get_concept_directions(exp_id)
        assert len(dirs) == 1
        assert dirs[0].concept == "dog"
        assert len(dirs[0].layer_stats) == 2


class TestExport:
    def test_export_full_experiment(self, store):
        exp_id = store.create_experiment(Experiment(
            model_name="Qwen/Qwen3-0.6B",
            model_backend="local_mps",
            type="ablation",
            prompt="A dog is",
            concept="dog",
            alpha=1.0,
        ))
        store.add_result(ExperimentResult(
            experiment_id=exp_id, variant="normal", output_text="normal"
        ))
        store.add_result(ExperimentResult(
            experiment_id=exp_id, variant="ablated", output_text="ablated"
        ))

        export = store.export_experiment(exp_id)
        assert "experiment" in export
        assert "results" in export
        assert export["experiment"]["concept"] == "dog"
        assert len(export["results"]) == 2

    def test_export_nonexistent(self, store):
        assert store.export_experiment(99999) == {}
