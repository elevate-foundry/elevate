"""famulus: an offline-by-default, consent-bound local agent engine.

The package is import-safe with only the Python standard library so that the
cold-start bootstrap (Phase -1) can run before any third-party dependency exists.
Richer dependencies are imported lazily by later phases only.
"""

__version__ = "0.0.1"
