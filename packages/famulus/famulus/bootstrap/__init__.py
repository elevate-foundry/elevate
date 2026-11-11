"""Phase -1: cold-start bootstrap.

Resolves the bootstrap paradox via a ladder where each rung needs only the rung
below it. This package is the L3 rung (Python stdlib only): it probes the host,
and -- only if Ollama / models are absent -- drives connectivity acquisition and
Ollama installation before handing control to the main engine (Step 0 onward).

STRICT RULE: nothing in this package may import a third-party library. It must run
on a fresh interpreter with no `pip install` having occurred.
"""
