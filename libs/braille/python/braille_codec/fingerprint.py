"""
Braille Fingerprints — SHA-256 bytes to fixed-width Braille hashes.

Maps arbitrary data to compact, fixed-width Braille strings using SHA-256.
These fingerprints serve as:

  1. Dedup keys     — identical inputs produce identical fingerprints
  2. LSH approx     — similar inputs often share prefix bits
  3. Gossip payloads — 4-char fingerprint = 32 bits, cheap to propagate
  4. Convergence     — Hamming distance estimates divergence between agents
"""

from __future__ import annotations

import hashlib

from .codec import encode, BRAILLE_BASE


def fingerprint_bytes(data: bytes, width: int = 4) -> str:
    """Arbitrary bytes -> fixed-width Braille fingerprint.

    Process:
      1. SHA-256 hash the data
      2. Take first `width` bytes of hash
      3. Encode as Braille

    Args:
        data: Arbitrary byte sequence to fingerprint.
        width: Number of Braille characters (= bytes of hash). Default 4 (32 bits).

    Returns:
        String of `width` Braille characters.
    """
    h = hashlib.sha256(data).digest()
    return encode(h[:width])


def fingerprint_str(text: str, width: int = 4) -> str:
    """UTF-8 string -> fixed-width Braille fingerprint."""
    return fingerprint_bytes(text.encode("utf-8"), width=width)


def similarity(fp1: str, fp2: str) -> float:
    """Hamming-distance-based similarity between two Braille fingerprints.

    Compares bit-by-bit. Returns 0.0 (completely different) to 1.0 (identical).

    Args:
        fp1: First Braille fingerprint.
        fp2: Second Braille fingerprint.

    Returns:
        Float in [0.0, 1.0].

    Raises:
        ValueError: If fingerprints have different lengths.
    """
    if len(fp1) != len(fp2):
        raise ValueError(
            f"Fingerprints must have same length: {len(fp1)} vs {len(fp2)}"
        )
    if not fp1:
        return 1.0

    total_bits = len(fp1) * 8
    matching_bits = 0

    for c1, c2 in zip(fp1, fp2):
        b1 = ord(c1) - BRAILLE_BASE
        b2 = ord(c2) - BRAILLE_BASE
        xor = b1 ^ b2
        differing = bin(xor).count("1")
        matching_bits += 8 - differing

    return matching_bits / total_bits


def hamming_distance(fp1: str, fp2: str) -> int:
    """Raw Hamming distance in bits between two Braille fingerprints.

    Args:
        fp1: First Braille fingerprint.
        fp2: Second Braille fingerprint.

    Returns:
        Number of differing bits.

    Raises:
        ValueError: If fingerprints have different lengths.
    """
    if len(fp1) != len(fp2):
        raise ValueError(
            f"Fingerprints must have same length: {len(fp1)} vs {len(fp2)}"
        )
    distance = 0
    for c1, c2 in zip(fp1, fp2):
        b1 = ord(c1) - BRAILLE_BASE
        b2 = ord(c2) - BRAILLE_BASE
        distance += bin(b1 ^ b2).count("1")
    return distance
