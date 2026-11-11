"""Prompt generation for concept probing and ablation.

Generates sets of concept-related and baseline prompts used
to compute concept directions in residual space.
"""

from __future__ import annotations


def make_concept_prompts(concept: str) -> list[str]:
    """Generate prompts that activate a given concept."""
    return [
        f"The {concept} is",
        f"A {concept} can",
        f"I saw a {concept}",
        f"The {concept} was very",
        f"Tell me about {concept}s",
        f"{concept.capitalize()} are known for",
        f"My favorite {concept}",
        f"A baby {concept} is called",
    ]


def make_baseline_prompts() -> list[str]:
    """Generate generic baseline prompts unrelated to any specific concept."""
    return [
        "The weather today is",
        "Mathematics involves the study of",
        "The color of the sky is",
        "A computer program can",
        "The history of civilization",
        "Music is composed of",
        "The ocean covers most of",
        "A book contains many",
    ]
