"""Root conftest: guarantee the repo root is importable so `pytest` works even
without an editable install or `python -m pytest`."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
