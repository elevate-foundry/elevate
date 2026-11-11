"""Pytest fixtures for E2E tests.

The tests assume the backend server is already running on localhost:8765.
Start it with: python backend.py
"""

import pytest

BASE_URL = "http://localhost:8765"


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL
