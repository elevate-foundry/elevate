"""
Braille — compact encoding layer for Cortex.

Uses the 256 Unicode Braille characters (U+2800–U+28FF) as a bijective
byte-to-character encoding. Each byte maps to exactly one Braille character.

Modules:
  codec        — encode/decode bytes ↔ Braille Unicode
  fingerprint  — SCLRecord → fixed-width Braille hash (LSH)
  manifest     — tier/system manifests in Braille notation

The core codec is provided by the shared library (libs/braille/python).
This package re-exports it and adds Cortex-specific layers (fingerprint, manifest).
"""

# Try shared lib first, fall back to local codec for standalone use
try:
    from braille_codec import encode, decode, encode_hex, encode_int
except ImportError:
    from .codec import encode, decode, encode_hex, encode_int

__all__ = ["encode", "decode", "encode_hex", "encode_int"]
