"""
elevate-braille — Canonical braille byte codec for the Elevate Foundry ecosystem.

The 256 Unicode Braille characters (U+2800 to U+28FF) map 1:1 to byte values
0x00-0xFF. Each character's Unicode codepoint offset from U+2800 IS the byte
value. This gives us a natural, lossless, bijective encoding.

Properties:
  - Bijective:      every byte sequence has exactly one Braille representation
  - Lossless:       decode(encode(x)) == x for all x
  - Fixed density:  1 byte = 1 Braille character = 3 UTF-8 bytes

This is the single canonical implementation used across all Elevate packages:
  - packages/cortex (routing fingerprints, manifests, tokenizer)
  - packages/cerebellar (multi-model consensus)
  - packages/braille-bench (compression benchmarks)
  - packages/sal (BBID identity)
  - packages/meta (commit fingerprints)
"""

from .codec import (
    BRAILLE_BASE,
    encode,
    decode,
    encode_hex,
    encode_int,
    decode_int,
    encode_text,
    decode_text,
    is_braille,
    extract_braille,
    braille_len,
    to_hex,
    to_dots,
    from_dots,
)
from .fingerprint import (
    fingerprint_bytes,
    fingerprint_str,
    similarity,
    hamming_distance,
)

__all__ = [
    "BRAILLE_BASE",
    "encode",
    "decode",
    "encode_hex",
    "encode_int",
    "decode_int",
    "encode_text",
    "decode_text",
    "is_braille",
    "extract_braille",
    "braille_len",
    "to_hex",
    "to_dots",
    "from_dots",
    "fingerprint_bytes",
    "fingerprint_str",
    "similarity",
    "hamming_distance",
]
