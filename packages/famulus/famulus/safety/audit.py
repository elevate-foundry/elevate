"""Append-only, tamper-evident audit log (stdlib only).

NOTE: The canonical shared implementation lives at libs/audit/python/elevate_audit/.
This local copy is kept for Phase -1 bootstrap (zero third-party deps requirement).
When running in the full monorepo, prefer `from elevate_audit import AuditLog`.

Every consequential action -- especially anything that touches the network or
mutates system state during bootstrap -- is recorded here. Records are linked by
a per-record digest chain so edits, insertions, and mid-stream truncation are
detectable.

This module implements the technical audit-trail controls a SOC 2 examination
looks for (it does NOT, by itself, make anyone "SOC 2 compliant" -- that is an
organizational attestation, not a property of code):

  * who / what / when / where -- each record carries an actor (OS user + uid),
    the event + structured data, a UTC timestamp, host, and pid.
  * integrity -- records are chained by digest. With FAMULUS_AUDIT_HMAC_KEY set,
    the digest is HMAC-SHA256 keyed by a secret that need not live beside the
    log, so a local rewrite cannot silently forge a valid chain. Without a key
    it falls back to a plain SHA-256 chain (edit/insert-evident, but forgeable
    by anyone who can rewrite the file).
  * ordering / gaps -- a monotonic per-record sequence number.
  * confidentiality -- the log and its directory are created owner-only; secret
    *values* are never recorded (only whether one was provided).
  * verifiability -- verify() re-checks the whole chain.
"""

from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import os
import socket
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_GENESIS = "0" * 64
SCHEMA_VERSION = 1
_HMAC_KEY_ENV = "FAMULUS_AUDIT_HMAC_KEY"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _actor() -> dict[str, Any]:
    """Best-effort identity of the principal writing the record."""
    try:
        user = getpass.getuser()
    except Exception:
        user = os.environ.get("USER") or os.environ.get("USERNAME") or "unknown"
    uid = os.getuid() if hasattr(os, "getuid") else None
    return {"user": user, "uid": uid}


def _digest(record_without_hash: dict[str, Any], prev_hash: str, alg: str, key: bytes | None) -> str:
    """Compute a record's digest over its canonical form + the previous hash."""
    payload = (json.dumps(record_without_hash, sort_keys=True, default=str) + prev_hash).encode("utf-8")
    if alg == "hmac-sha256":
        if key is None:
            raise ValueError("hmac-sha256 record requires a key to (re)compute its digest")
        return hmac.new(key, payload, hashlib.sha256).hexdigest()
    return hashlib.sha256(payload).hexdigest()


class AuditLog:
    """JSONL audit log with a per-record digest chain.

    Each line is one JSON object:
        {v, seq, ts, host, actor, pid, event, data, prev_hash, alg, hash}
    `hash` is the digest over the canonical record (all fields except `hash`)
    concatenated with `prev_hash`. With a key configured the digest is keyed
    (HMAC-SHA256); otherwise it is plain SHA-256.
    """

    def __init__(self, path: str | os.PathLike[str], *, hmac_key: str | bytes | None = None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._restrict(self.path.parent, 0o700)
        self._lock = threading.Lock()
        self._host = socket.gethostname()
        self._actor = _actor()
        if hmac_key is None:
            env = os.environ.get(_HMAC_KEY_ENV)
            hmac_key = env if env else None
        if isinstance(hmac_key, str):
            hmac_key = hmac_key.encode("utf-8")
        self._key: bytes | None = hmac_key
        self._alg = "hmac-sha256" if self._key else "sha256"

    @staticmethod
    def _restrict(target: Path, mode: int) -> None:
        """Best-effort owner-only permissions; no-op where unsupported."""
        try:
            os.chmod(target, mode)
        except OSError:
            pass

    def _tail(self) -> tuple[str, int, int]:
        """Return (last_hash, last_seq, record_count) by scanning the log."""
        prev = _GENESIS
        last_seq = 0
        count = 0
        if not self.path.exists():
            return prev, last_seq, count
        with self.path.open("r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    # Corrupt/edited line -> chain will fail to verify; keep going.
                    count += 1
                    continue
                prev = rec.get("hash", prev)
                if isinstance(rec.get("seq"), int):
                    last_seq = rec["seq"]
                count += 1
        return prev, last_seq, count

    def record(self, event: str, **data: Any) -> dict[str, Any]:
        """Append an event and return the written record."""
        with self._lock:
            prev_hash, last_seq, count = self._tail()
            seq = max(last_seq, count) + 1
            rec: dict[str, Any] = {
                "v": SCHEMA_VERSION,
                "seq": seq,
                "ts": _utc_now(),
                "host": self._host,
                "actor": self._actor,
                "pid": os.getpid(),
                "event": event,
                "data": data,
                "prev_hash": prev_hash,
                "alg": self._alg,
            }
            rec["hash"] = _digest(rec, prev_hash, self._alg, self._key)
            newly = not self.path.exists()
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(rec, default=str) + "\n")
                fh.flush()
                try:
                    os.fsync(fh.fileno())
                except OSError:
                    # Durability is best-effort on filesystems that reject fsync.
                    pass
            if newly:
                self._restrict(self.path, 0o600)
            return rec

    def verify(self) -> bool:
        """Return True iff the digest chain (and seq ordering) is intact.

        A backward digest chain detects edits, insertions, and mid-stream
        truncation. It cannot, by itself, detect removal of a suffix of trailing
        records -- guard that with an external high-water mark (see verify_tip).
        """
        ok, _ = self.verify_detailed()
        return ok

    def verify_detailed(self) -> tuple[bool, str | None]:
        """Like verify() but also returns the first problem found (or None)."""
        prev = _GENESIS
        last_seq: int | None = None
        if not self.path.exists():
            return True, None
        with self.path.open("r", encoding="utf-8") as fh:
            for lineno, line in enumerate(fh, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    return False, f"line {lineno}: not valid JSON"
                stored = rec.pop("hash", None)
                if stored is None:
                    return False, f"line {lineno}: missing hash"
                alg = rec.get("alg", "sha256")
                if alg == "hmac-sha256" and self._key is None:
                    return False, f"line {lineno}: hmac record but no key configured to verify"
                try:
                    expected = _digest(rec, rec.get("prev_hash", ""), alg, self._key)
                except ValueError as exc:
                    return False, f"line {lineno}: {exc}"
                if stored != expected:
                    return False, f"line {lineno}: digest mismatch (record altered)"
                if rec.get("prev_hash") != prev:
                    return False, f"line {lineno}: broken link (prev_hash != previous hash)"
                seq = rec.get("seq")
                if isinstance(seq, int):
                    if last_seq is not None and seq != last_seq + 1:
                        return False, f"line {lineno}: seq gap (expected {last_seq + 1}, got {seq})"
                    last_seq = seq
                prev = stored
        return True, None

    def tip(self) -> str:
        """Current last-record hash -- the chain's high-water mark."""
        prev, _, _ = self._tail()
        return prev

    def verify_tip(self, expected_last_hash: str) -> bool:
        """Detect trailing-record truncation by comparing the current tip to a
        previously persisted high-water mark."""
        return self.verify() and self.tip() == expected_last_hash


def default_audit_log(root: str | os.PathLike[str]) -> AuditLog:
    return AuditLog(Path(root) / "logs" / "audit.jsonl")
