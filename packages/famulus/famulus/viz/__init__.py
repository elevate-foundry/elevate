"""Optional visualization layer for famulus.

A small, offline Flask dashboard for exploring how similar the local models are:
behavioral fingerprints, answer-agreement, error-correlation, and the
behavioral clusters used for diversity-aware swarming.

This is a dev/inspection tool -- it is NOT part of the core engine and lives
behind the optional ``viz`` dependency extra (Flask). It imports engine modules
lazily so the rest of famulus never depends on it.
"""
