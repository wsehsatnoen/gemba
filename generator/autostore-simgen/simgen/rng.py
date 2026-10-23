"""Reproducible random streams.

One seed feeds a :class:`numpy.random.SeedSequence`. Each component asks for
a named sub-stream (``populations``, ``scheduling``, ``templates``,
``timing``, ``quantities`` ...) optionally qualified by configuration or
date. Sub-streams are derived from a stable hash of their names, so drawing
more numbers in one component never shifts the numbers another component sees.
"""

from __future__ import annotations

import zlib

import numpy as np


def _stable_key(part: object) -> int:
    return zlib.crc32(str(part).encode("utf-8")) & 0xFFFFFFFF


class StreamFactory:
    """Derives independent, named numpy Generators from one seed."""

    def __init__(self, seed: int) -> None:
        if seed < 0:
            raise ValueError("seed must be non-negative")
        self.seed = int(seed)

    def stream(self, *names: object) -> np.random.Generator:
        key = tuple(_stable_key(n) for n in names)
        seq = np.random.SeedSequence(entropy=self.seed, spawn_key=key)
        return np.random.Generator(np.random.PCG64(seq))
