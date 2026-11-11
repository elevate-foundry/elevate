"""
BBID (Braille Binary Identity) — portable identity based on 8-dot braille.

Each user gets a unique 8-cell braille identity (8 bytes = 64 bits) derived
from SHA-256. The identity is HMAC-signed, supports haptic rendering, and
works across all Elevate services.

This implementation uses the shared braille codec from libs/braille rather
than reimplementing the byte-to-braille mapping.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


# Import from shared braille codec (when installed as elevate-braille)
# Falls back to inline implementation for standalone use
try:
    from braille_codec import encode, decode, BRAILLE_BASE
    from braille_codec.codec import to_dots
except ImportError:
    BRAILLE_BASE = 0x2800

    def encode(data: bytes) -> str:
        return "".join(chr(BRAILLE_BASE + b) for b in data)

    def decode(braille: str) -> bytes:
        return bytes(ord(c) - BRAILLE_BASE for c in braille)

    def to_dots(char: str) -> list[bool]:
        cp = ord(char) - BRAILLE_BASE
        return [bool(cp & (1 << i)) for i in range(8)]


# Default prefix: braille for "SAL" + underscore
DEFAULT_PREFIX = "\u2820\u280e\u2801\u2807_"  # ⠠⠎⠁⠇_
DEFAULT_HMAC_KEY_ENV = "ELEVATE_BBID_HMAC_KEY"


@dataclass
class BBID:
    """BrailleBuddy / Braille Binary Identity."""

    braille: str  # 8-cell braille representation
    user_id: str  # UUID or other user identifier
    created_at: datetime
    signature: str  # HMAC signature (also braille-encoded)
    prefix: str = DEFAULT_PREFIX
    modalities: list[str] = field(default_factory=lambda: ["voice", "text", "braille", "haptic"])

    @property
    def display(self) -> str:
        """Human-readable display with prefix."""
        return f"{self.prefix}{self.braille}"

    @property
    def haptic_pattern(self) -> list[dict[str, Any]]:
        """Generate haptic pattern: each cell maps to vibration intensity/duration."""
        patterns: list[dict[str, Any]] = []
        for char in self.braille:
            dots = to_dots(char)
            dot_count = sum(dots)
            patterns.append({
                "duration": 50 + (dot_count * 20),
                "intensity": round(0.3 + (dot_count * 0.1), 2),
            })
            patterns.append({"type": "pause", "duration": 100})
        return patterns

    def to_dict(self) -> dict[str, Any]:
        return {
            "bbid": self.display,
            "braille": self.braille,
            "user_id": self.user_id,
            "created_at": self.created_at.isoformat(),
            "signature": self.signature,
            "modalities": self.modalities,
        }


class BBIDGenerator:
    """Generates and verifies BBIDs."""

    def __init__(
        self,
        hmac_key: str | bytes | None = None,
        prefix: str = DEFAULT_PREFIX,
    ):
        if hmac_key is None:
            hmac_key = os.environ.get(DEFAULT_HMAC_KEY_ENV, secrets.token_hex(32))
        if isinstance(hmac_key, str):
            hmac_key = hmac_key.encode("utf-8")
        self._key = hmac_key
        self._prefix = prefix

    def generate(self, user_id: str, username: str) -> BBID:
        """Generate a new BBID for a user.

        Uses SHA-256(user_id:username:random) -> first 8 bytes -> 8 braille cells.
        """
        seed = f"{user_id}:{username}:{secrets.token_hex(8)}"
        hash_bytes = hashlib.sha256(seed.encode("utf-8")).digest()
        braille = encode(hash_bytes[:8])
        signature = self._sign(braille, user_id)

        return BBID(
            braille=braille,
            user_id=user_id,
            created_at=datetime.now(timezone.utc),
            signature=signature,
            prefix=self._prefix,
        )

    def verify(self, bbid: BBID) -> bool:
        """Verify BBID signature."""
        expected_sig = self._sign(bbid.braille, bbid.user_id)
        return hmac.compare_digest(bbid.signature, expected_sig)

    def _sign(self, braille: str, user_id: str) -> str:
        """Create HMAC signature, encoded as 8 braille characters."""
        message = f"{braille}:{user_id}".encode("utf-8")
        sig_hex = hmac.new(self._key, message, hashlib.sha256).hexdigest()
        sig_bytes = bytes.fromhex(sig_hex[:16])  # 8 bytes
        return encode(sig_bytes)


class BBIDTokenEncoder:
    """Encodes BBID information into JWT-compatible claims."""

    def __init__(self, generator: BBIDGenerator | None = None):
        self.generator = generator or BBIDGenerator()

    def create_token_claims(self, bbid: BBID) -> dict[str, Any]:
        """Create BBID-enhanced token claims."""
        return {
            "bbid": bbid.display,
            "bbid_raw": bbid.braille,
            "bbid_sig": bbid.signature,
            "bbid_created": bbid.created_at.isoformat(),
            "modalities": bbid.modalities,
        }

    def verify_token_bbid(self, claims: dict[str, Any], expected_user_id: str) -> bool:
        """Verify BBID claims in a token."""
        try:
            bbid = BBID(
                braille=claims.get("bbid_raw", ""),
                user_id=expected_user_id,
                created_at=datetime.fromisoformat(claims.get("bbid_created", "")),
                signature=claims.get("bbid_sig", ""),
            )
            return self.generator.verify(bbid)
        except Exception:
            return False


class BBIDRegistry:
    """Persistent BBID visit tracking (from Sal and cerebellar)."""

    def __init__(self, path: str | os.PathLike[str] = "data/bbid-visits.json"):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._data: dict[str, Any] = self._load()

    def _load(self) -> dict[str, Any]:
        if self._path.exists():
            return json.loads(self._path.read_text("utf-8"))
        return {}

    def _save(self) -> None:
        self._path.write_text(json.dumps(self._data, indent=2, default=str), "utf-8")

    def identify(self, display: str) -> dict[str, Any]:
        """Track a BBID visit. Returns visit info including first-visit detection."""
        now = datetime.now(timezone.utc).isoformat()
        entry = self._data.get(display)

        if entry is None:
            entry = {
                "bbid": display,
                "first_seen_at": now,
                "last_seen_at": now,
                "visit_count": 1,
                "is_first_visit": True,
            }
        else:
            entry["last_seen_at"] = now
            entry["visit_count"] += 1
            entry["is_first_visit"] = False

        self._data[display] = entry
        self._save()
        return entry
