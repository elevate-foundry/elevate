"""
elevate-bbid — Braille Binary Identity for the Elevate ecosystem.

BBID is a braille-encoded identity system providing:
  - Unique 8-cell braille identity (64 bits of entropy)
  - HMAC-SHA256 cryptographic signatures (also braille-encoded)
  - Haptic patterns for accessibility
  - Multi-modal output (visual, haptic, audio, text)
  - Visit tracking and persistence

Unified from:
  - sal-auth/bbid.py (Python reference)
  - packages/sal/src/bbid.js (Node.js production)
  - packages/cerebellar (multi-model consensus BBID handshake)
  - BBID Formal Specification (SRP-LSH + fuzzy commitment)
"""

from .identity import BBID, BBIDGenerator, BBIDTokenEncoder

__all__ = ["BBID", "BBIDGenerator", "BBIDTokenEncoder"]
