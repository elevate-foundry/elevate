#!/usr/bin/env python3
"""braille_compression.py - empirically test grade-2 (contracted) Braille as a
compression scheme on the elevate-foundry corpus.

Metric is a CELL proxy, not BPE tokens (no ML deps): we estimate how many Braille
cells the text would take and compare to its character count. Lower ratio = the
text compresses; ratio > 1.0 = Braille *expands* it.

Cell model (grade 2, simplified but faithful on the parts that matter):
  + 1 cell per uppercase letter        (capital indicator, dot 6)
  + 1 cell per maximal digit run        (number sign, #)
  - contractions: ~189 grade-2 rules collapse letter groups / words to one cell;
    we apply a representative high-frequency subset (whole-word wordsigns +
    short-forms, then groupsigns anywhere).

Usage: python braille_compression.py --corpus ../out/corpus.jsonl
"""
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path

# Whole-word contractions (wordsign / short-form) -> 1 cell when standalone.
WORDSIGNS = [
    "about", "above", "according", "across", "after", "afternoon", "afterward",
    "again", "against", "almost", "already", "also", "although", "altogether",
    "always", "because", "before", "behind", "below", "beneath", "beside",
    "between", "beyond", "blind", "braille", "children", "conceive", "could",
    "deceive", "declare", "either", "first", "friend", "good", "great", "him",
    "herself", "himself", "immediate", "its", "itself", "letter", "little",
    "much", "must", "myself", "necessary", "neither", "oneself", "ourselves",
    "paid", "perhaps", "quick", "receive", "rejoice", "said", "should", "such",
    "themselves", "thyself", "today", "together", "tomorrow", "tonight",
    "would", "your", "yourself", "yourselves",
    # one-cell alphabetic wordsigns
    "but", "can", "do", "every", "from", "go", "have", "just", "knowledge",
    "like", "more", "not", "people", "quite", "rather", "so", "that", "us",
    "very", "will", "it", "you", "as", "child", "shall", "this", "which",
    "out", "enough", "his", "was", "were", "in", "and", "for", "of", "the",
    "with", "to", "into", "by",
]

# Groupsigns / final-letter signs -> 1 cell, may appear inside words.
GROUPSIGNS = [
    "ation", "ound", "ound", "ance", "ence", "ong", "ful", "tion", "ness",
    "ment", "ould", "ing", "ble", "and", "for", "the", "with", "ch", "gh",
    "sh", "th", "wh", "ed", "er", "ou", "ow", "st", "ar", "ea", "bb", "cc",
    "dd", "ff", "gg", "in", "en", "of",
]

# Build regexes once. Longest first so multi-char wins.
WORD_RE = re.compile(
    r"\b(" + "|".join(sorted(set(WORDSIGNS), key=len, reverse=True)) + r")\b"
)
GROUP_RE = re.compile(
    "(" + "|".join(sorted(set(GROUPSIGNS), key=len, reverse=True)) + ")"
)

SENTINEL = "\x01"  # stands for exactly one Braille cell


def braille_cells(text: str) -> int:
    """Estimate Braille cell count for a string under grade-2 contraction."""
    caps = sum(1 for c in text if c.isupper())          # capital indicators
    number_runs = len(re.findall(r"\d+", text))         # number signs
    t = text.lower()
    t = WORD_RE.sub(SENTINEL, t)                          # whole-word -> 1 cell
    t = GROUP_RE.sub(SENTINEL, t)                         # groupsign -> 1 cell
    # Every remaining char (letter, sentinel, symbol, space, digit) = 1 cell.
    return len(t) + caps + number_runs


# Group fine-grained langs into code vs prose for the headline numbers.
PROSE = {"Markdown", "reST", "Text"}


def bucket(lang: str) -> str:
    return "prose" if lang in PROSE else "code"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--corpus", default="../out/corpus.jsonl")
    args = ap.parse_args()

    corpus = Path(args.corpus)
    if not corpus.exists():
        raise SystemExit(f"corpus not found: {corpus}")

    by_lang = defaultdict(lambda: [0, 0])      # lang -> [chars, cells]
    by_bucket = defaultdict(lambda: [0, 0])
    total = [0, 0]

    with corpus.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            rec = json.loads(line)
            text = rec.get("text", "")
            lang = rec.get("lang", "other")
            chars = len(text)
            cells = braille_cells(text)
            for store in (by_lang[lang], by_bucket[bucket(lang)], total):
                store[0] += chars
                store[1] += cells

    def ratio(pair):
        return pair[1] / pair[0] if pair[0] else 0.0

    print("grade-2 Braille cell ratio (cells / chars); <1 compresses, >1 expands\n")
    print(f"{'language':<14}{'chars':>12}{'cells':>12}{'ratio':>9}")
    print("-" * 47)
    for lang, pair in sorted(by_lang.items(), key=lambda kv: -kv[1][0]):
        print(f"{lang:<14}{pair[0]:>12,}{pair[1]:>12,}{ratio(pair):>9.3f}")
    print("-" * 47)
    for b in ("code", "prose"):
        p = by_bucket[b]
        print(f"{b.upper():<14}{p[0]:>12,}{p[1]:>12,}{ratio(p):>9.3f}")
    print(f"{'TOTAL':<14}{total[0]:>12,}{total[1]:>12,}{ratio(total):>9.3f}")
    print(f"\noverall savings: {(1 - ratio(total)) * 100:.1f}%  "
          f"(positive = compression, negative = expansion)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
