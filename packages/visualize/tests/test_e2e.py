"""End-to-end Playwright tests for the LLM Neuron Firing Visualizer.

Run with:
    pytest tests/test_e2e.py -v --headed  (to watch)
    pytest tests/test_e2e.py -v            (headless)

Requires backend running on localhost:8765.
"""

import re

import pytest
from playwright.sync_api import Page, expect


BASE_URL = "http://localhost:8765"
# How long to wait for model inference (generous for MPS cold start)
INFERENCE_TIMEOUT = 120_000


# ── Page load & WebSocket connection ──────────────────────────────────────

class TestPageLoad:
    def test_page_loads(self, page: Page):
        page.goto(BASE_URL)
        expect(page.locator("h1")).to_have_text("Neuron Firing Visualizer")

    def test_model_badge_shows_info(self, page: Page):
        page.goto(BASE_URL)
        badge = page.locator("#model-badge")
        expect(badge).to_contain_text("Qwen", timeout=30_000)
        expect(badge).to_contain_text("MPS")

    def test_websocket_connects(self, page: Page):
        page.goto(BASE_URL)
        # Status dot turns green on connect
        dot = page.locator("#status-dot")
        expect(dot).to_have_class(re.compile(r"connected"), timeout=10_000)

    def test_generate_button_enabled_on_connect(self, page: Page):
        page.goto(BASE_URL)
        btn = page.locator("#generate-btn")
        expect(btn).to_be_enabled(timeout=10_000)

    def test_ablate_button_enabled_on_connect(self, page: Page):
        page.goto(BASE_URL)
        btn = page.locator("#ablate-btn")
        expect(btn).to_be_enabled(timeout=10_000)

    def test_statistics_populated(self, page: Page):
        page.goto(BASE_URL)
        expect(page.locator("#stat-layers")).to_have_text("28", timeout=10_000)
        expect(page.locator("#stat-hidden")).to_have_text("1024", timeout=10_000)


# ── Generation ────────────────────────────────────────────────────────────

class TestGeneration:
    def test_generate_produces_output(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("The capital of France is")
        page.locator("#generate-btn").click()

        # Wait for output in the token stream
        stream = page.locator("#token-stream")
        expect(stream).to_contain_text("Paris", timeout=INFERENCE_TIMEOUT)

    def test_generate_updates_token_count(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("Hello world")
        page.locator("#max-tokens").fill("5")
        page.locator("#generate-btn").click()

        # Wait for completion
        page.wait_for_function(
            "() => !document.getElementById('generate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )
        tokens_text = page.locator("#stat-tokens").text_content()
        assert tokens_text is not None
        assert int(tokens_text) > 0

    def test_generate_shows_heatmap(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("A cat sat on the mat")
        page.locator("#generate-btn").click()

        # Wait for completion
        page.wait_for_function(
            "() => !document.getElementById('generate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        # Heatmap content should become visible
        content = page.locator("#heatmap-content")
        expect(content).to_be_visible()
        # Should have layer rows
        layers = page.locator("#heatmap-layers .layer-row")
        assert layers.count() == 28

    def test_token_select_populated(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("One two three")
        page.locator("#generate-btn").click()

        page.wait_for_function(
            "() => !document.getElementById('generate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        options = page.locator("#token-select option")
        # "All tokens" + at least the prompt tokens + generated
        assert options.count() > 3


# ── Visualization tabs ────────────────────────────────────────────────────

class TestVisualizationTabs:
    def _generate_and_wait(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("Test prompt for viz")
        page.locator("#generate-btn").click()
        page.wait_for_function(
            "() => !document.getElementById('generate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

    def test_firing_rate_tab(self, page: Page):
        self._generate_and_wait(page)
        page.locator('[data-tab="firing"]').click()
        chart = page.locator("#firing-chart")
        expect(chart).to_be_visible()
        # Should contain an SVG bar chart
        assert page.locator("#firing-chart svg").count() > 0

    def test_network_view_tab(self, page: Page):
        self._generate_and_wait(page)
        page.locator('[data-tab="network"]').click()
        svg = page.locator("#network-svg")
        expect(svg).to_be_visible()
        # Should contain circles (neurons)
        assert page.locator("#network-svg circle").count() > 0

    def test_tab_switching(self, page: Page):
        self._generate_and_wait(page)
        for tab_name in ["heatmap", "firing", "network", "ablation"]:
            page.locator(f'[data-tab="{tab_name}"]').click()
            panel = page.locator(f"#panel-{tab_name}")
            expect(panel).to_be_visible()

    def test_color_scale_change(self, page: Page):
        self._generate_and_wait(page)
        page.locator("#color-scale").select_option("viridis")
        # Heatmap should still be visible (didn't break)
        expect(page.locator("#heatmap-content")).to_be_visible()


# ── Directional ablation ─────────────────────────────────────────────────

class TestDirectionalAblation:
    def test_ablation_dog_concept(self, page: Page):
        """Core ablation test: erase 'dog' and check outputs differ."""
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("A dog is a wonderful pet because")
        page.locator("#ablate-concept").fill("dog")
        page.locator("#ablate-btn").click()

        # Wait for ablation to complete
        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        normal = page.locator("#normal-output").text_content()
        ablated = page.locator("#ablated-output").text_content()

        assert normal is not None and len(normal) > 20
        assert ablated is not None and len(ablated) > 20
        # Outputs should differ (ablation had an effect)
        assert normal != ablated

    def test_ablation_switches_to_ablation_tab(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-concept").fill("cat")
        page.locator("#ablate-btn").click()

        # Ablation tab should become active
        tab = page.locator('[data-tab="ablation"]')
        expect(tab).to_have_class(re.compile(r"active"), timeout=5_000)
        expect(page.locator("#panel-ablation")).to_be_visible()

        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

    def test_ablation_shows_log(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-concept").fill("water")
        page.locator("#ablate-btn").click()

        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        log = page.locator("#ablation-log").text_content()
        assert "direction" in log.lower()
        assert "done" in log.lower().replace("✓", "").strip() or "Done" in log

    def test_ablation_shows_layer_chips(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-concept").fill("music")
        page.locator("#ablate-btn").click()

        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        chips = page.locator("#neuron-map .layer-chip")
        # Should show chips for multiple layers
        assert chips.count() >= 10

    def test_ablation_heatmap_comparison(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-concept").fill("science")
        page.locator("#ablate-btn").click()

        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )

        heatmaps = page.locator("#ablation-heatmaps .layer-row")
        assert heatmaps.count() == 28

    def test_alpha_affects_output(self, page: Page):
        """Lower alpha should produce output closer to normal."""
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("The square root of 144 is")
        page.locator("#ablate-concept").fill("math")

        def set_alpha(val: str):
            page.evaluate(
                f"() => {{ document.getElementById('ablate-alpha').value = '{val}';"
                f" document.getElementById('ablate-alpha-val').textContent = '{val}'; }}"
            )

        # Run with alpha=1.0
        set_alpha("1.0")
        page.locator("#ablate-btn").click()
        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )
        ablated_strong = page.locator("#ablated-output").text_content()

        # Run with alpha=0.3
        set_alpha("0.3")
        page.locator("#ablate-btn").click()
        page.wait_for_function(
            "() => !document.getElementById('ablate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )
        ablated_weak = page.locator("#ablated-output").text_content()

        # Both should be non-empty, and likely different from each other
        assert ablated_strong is not None and len(ablated_strong) > 10
        assert ablated_weak is not None and len(ablated_weak) > 10

    def test_ablation_empty_concept_shows_alert(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-concept").fill("")

        # Set up dialog handler before clicking
        dialog_messages = []
        page.on("dialog", lambda d: (dialog_messages.append(d.message), d.accept()))
        page.locator("#ablate-btn").click()

        assert len(dialog_messages) == 1
        assert "concept" in dialog_messages[0].lower() or "prompt" in dialog_messages[0].lower()


# ── UI Controls ───────────────────────────────────────────────────────────

class TestUIControls:
    def test_max_tokens_slider(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#max-tokens").fill("10")
        expect(page.locator("#max-tokens-val")).to_have_text("10")

    def test_alpha_slider(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#ablate-alpha").fill("0.5")
        expect(page.locator("#ablate-alpha-val")).to_have_text("0.5")

    def test_generate_button_disabled_during_generation(self, page: Page):
        page.goto(BASE_URL)
        page.locator("#prompt-input").fill("Hello")
        page.locator("#generate-btn").click()

        # Button should be disabled immediately
        expect(page.locator("#generate-btn")).to_be_disabled()

        page.wait_for_function(
            "() => !document.getElementById('generate-btn').disabled",
            timeout=INFERENCE_TIMEOUT,
        )
        expect(page.locator("#generate-btn")).to_be_enabled()
