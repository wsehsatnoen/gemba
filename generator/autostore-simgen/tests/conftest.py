"""Shared fixtures. Generation runs are cached per session to keep the suite fast."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from simgen.config import CONFIG_NAMES, load_config  # noqa: E402
from simgen.pipeline import RunOptions, build  # noqa: E402


@pytest.fixture(scope="session")
def config():
    return load_config()


@pytest.fixture(scope="session")
def medium():
    """All four configurations, 6,000 rows each (validated, not exported)."""
    return build(RunOptions(configs=list(CONFIG_NAMES), target=6000, seed=11, export=False))


@pytest.fixture(scope="session")
def small_cc():
    return build(RunOptions(configs=["AMBIENT_CYCLE_COUNT"], target=600, seed=5, export=False))
