"""Synthetic TU (bin) and product populations.

Populations scale with the requested volume. For each configuration the TU
population is sized so that drawing ``N`` clusters with lognormal popularity
weights (sigma 0.8) is expected to touch ``N x unique_bins_ratio`` distinct
TUs; the product subset is sized the same way for ``unique_products_ratio``.

Within an environment the TU numbering space is shared, but each
configuration owns a disjoint, randomly interleaved subset of TUs, so every
per-configuration workbook carries a self-consistent quantity chain. Products
come from one environment pool; each configuration uses an overlapping random
subset of it. Ambient and Cooler populations never mix.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from statistics import NormalDist

import numpy as np

from .config import Config
from .identifiers import product_id, tu_id
from .rng import StreamFactory

_GRID = np.array([NormalDist().inv_cdf((i + 0.5) / 4000) for i in range(4000)])


def expected_unique(pop_size: float, draws: int, sigma: float) -> float:
    """Expected distinct items when ``draws`` items are drawn with replacement
    from ``pop_size`` items carrying lognormal(0, sigma) popularity weights."""
    if pop_size <= 0 or draws <= 0:
        return 0.0
    w = np.exp(sigma * _GRID)
    p = w / (w.mean() * pop_size)
    p = np.minimum(p, 1.0 - 1e-12)
    return float(pop_size * np.mean(1.0 - np.exp(draws * np.log1p(-p))))


def solve_population(target_unique: float, draws: int, sigma: float, minimum: int) -> int:
    """Smallest population whose expected distinct count reaches the target."""
    target_unique = min(target_unique, float(draws))
    if draws <= 0:
        return max(minimum, 1)
    lo, hi = max(1.0, target_unique), max(2.0, target_unique * 2)
    while expected_unique(hi, draws, sigma) < target_unique and hi < 1e8:
        hi *= 2
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        if expected_unique(mid, draws, sigma) < target_unique:
            lo = mid
        else:
            hi = mid
        if hi - lo < 0.5:
            break
    return max(minimum, int(math.ceil(hi)))


@dataclass
class TUPopulation:
    """TUs owned by one configuration.

    Only identity and popularity are fixed up front. A TU's persistent
    attributes (bin type, initial on-hand, product, lot state) are drawn the
    first time it is used, by the state pass, so the bin-type mix of the TUs
    that actually appear in the data tracks the configured shares exactly.
    """

    config: str
    env_code: str
    ids: list[str]
    popularity_cum: np.ndarray
    target_unique: float

    @property
    def size(self) -> int:
        return len(self.ids)

    def draw(self, rng: np.random.Generator) -> int:
        return int(min(np.searchsorted(self.popularity_cum, rng.random(), side="right"), self.size - 1))


@dataclass
class ProductPool:
    env_code: str
    ids: list[str]
    subsets: dict[str, np.ndarray]  # config -> product indices
    subset_cum: dict[str, np.ndarray]  # config -> cumulative popularity over the subset
    target_unique: dict[str, float]

    def draw(self, config_name: str, rng: np.random.Generator) -> int:
        cum = self.subset_cum[config_name]
        k = int(min(np.searchsorted(cum, rng.random(), side="right"), len(cum) - 1))
        return int(self.subsets[config_name][k])


def _cum(weights: np.ndarray) -> np.ndarray:
    c = np.cumsum(weights)
    return c / c[-1]


def build_populations(config: Config, env_name: str, clusters: dict[str, int],
                      streams: StreamFactory) -> tuple[dict[str, TUPopulation], ProductPool]:
    """Build the TU subsets and the product pool for the requested configurations."""
    env = config.environments[env_name]
    bins = config.raw["bins"]
    sigma = float(bins["popularity_sigma"])
    minimum = int(bins["minimum_population"])
    headroom = float(bins["product_pool_headroom"])
    names = list(clusters)
    tu_sizes: dict[str, int] = {}
    prod_sizes: dict[str, int] = {}
    tu_targets: dict[str, float] = {}
    prod_targets: dict[str, float] = {}
    for c in names:
        spec = config.configurations[c]
        n = clusters[c]
        tu_targets[c] = spec.unique_bins_ratio * n
        prod_targets[c] = spec.unique_products_ratio * n
        tu_sizes[c] = solve_population(tu_targets[c], n, sigma, minimum)
        used_bins = max(1, int(round(tu_targets[c])))
        prod_sizes[c] = solve_population(prod_targets[c], used_bins, sigma, max(2, minimum // 2))
    # Product pool for the environment, with overlapping subsets per configuration.
    p_env = int(math.ceil(max(prod_sizes.values()) * headroom))
    prng = streams.stream("populations", env_name, "products")
    subsets: dict[str, np.ndarray] = {}
    subset_cum: dict[str, np.ndarray] = {}
    for c in names:
        size = min(prod_sizes[c], p_env)
        idx = np.sort(prng.choice(p_env, size=size, replace=False))
        subsets[c] = idx
        subset_cum[c] = _cum(prng.lognormal(0.0, sigma, size=size))
    pool = ProductPool(env_code=env.code, ids=[product_id(env.code, i + 1) for i in range(p_env)],
                       subsets=subsets, subset_cum=subset_cum, target_unique=prod_targets)
    # TU numbering shared by the environment; disjoint random subsets per configuration.
    total_tus = sum(tu_sizes.values())
    trng = streams.stream("populations", env_name, "tu_numbering")
    numbers = trng.permutation(total_tus) + 1
    offset = 0
    tus: dict[str, TUPopulation] = {}
    for c in names:
        m = tu_sizes[c]
        own = np.sort(numbers[offset: offset + m])
        offset += m
        rng = streams.stream("populations", c, "tus")
        cum = _cum(rng.lognormal(0.0, sigma, size=m))
        tus[c] = TUPopulation(config=c, env_code=env.code, ids=[tu_id(env.code, int(x)) for x in own],
                              popularity_cum=cum, target_unique=tu_targets[c])
    return tus, pool
