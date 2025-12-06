"""
P/E ratio and band calculations.

This module provides functions to compute P/E ratios and
historical valuation bands (percentile or standard deviation based).
"""

import numpy as np
import pandas as pd

from pe_band_analyzer.constants import (
    PE_RATIO_MIN,
    PE_RATIO_MAX,
    DEFAULT_PERCENTILES,
)
from pe_band_analyzer.models import PEStats, PEBandResult, BandMode


def compute_pe_ratio(prices: pd.DataFrame, ttm_eps: pd.Series) -> pd.Series:
    """
    Calculate P/E ratio for each date.

    P/E ratio = Stock Price / Trailing 12-Month EPS

    Args:
        prices: DataFrame with 'Close' column containing stock prices.
        ttm_eps: Series with TTM EPS values, same index as prices.

    Returns:
        Series with P/E ratios. Infinite values (from zero EPS)
        are replaced with NaN.

    Example:
        >>> pe_ratio = compute_pe_ratio(prices_df, ttm_eps_series)
        >>> current_pe = pe_ratio.iloc[-1]
    """
    pe_ratio: pd.Series = prices["Close"] / ttm_eps

    # Remove infinite values (when EPS is 0 or negative)
    pe_ratio = pe_ratio.replace([np.inf, -np.inf], np.nan)

    return pe_ratio


def compute_pe_bands(
    pe_ratio: pd.Series,
    ttm_eps: pd.Series,
    mode: BandMode = "percentile",
    percentiles: list[int] | None = None,
) -> PEBandResult:
    """
    Compute P/E band statistics and implied prices.

    Creates valuation bands based on historical P/E distribution.
    Two modes are supported:
    - percentile: Bands at P10, P25, P50, P75, P90
    - stddev: Bands at avg-2σ, avg-1σ, avg, avg+1σ, avg+2σ

    Args:
        pe_ratio: Series of P/E ratios over time.
        ttm_eps: Series of TTM EPS values (same index as pe_ratio).
        mode: Band calculation mode - 'percentile' or 'stddev'.
        percentiles: List of percentiles to use (default: [10, 25, 50, 75, 90]).

    Returns:
        PEBandResult containing:
        - pe_stats: P/E statistics (min, max, mean, percentiles, etc.)
        - band_prices: DataFrame with implied prices at each band level
        - band_pe_levels: Dict mapping band names to P/E levels
        - mode: The band calculation mode used

    Example:
        >>> result = compute_pe_bands(pe_ratio, ttm_eps, mode="percentile")
        >>> fair_value = result.pe_stats.p50 * current_eps
    """
    if percentiles is None:
        percentiles = DEFAULT_PERCENTILES

    # Filter valid P/E values (positive and reasonable)
    valid_pe = pe_ratio[(pe_ratio > PE_RATIO_MIN) & (pe_ratio < PE_RATIO_MAX)]

    # Calculate P/E statistics
    pe_stats = _calculate_pe_stats(valid_pe, percentiles)

    # Calculate band P/E levels based on mode
    band_pe_levels = _calculate_band_levels(pe_stats, mode)

    # Calculate implied prices at each band level
    band_prices = _calculate_band_prices(ttm_eps, band_pe_levels)

    return PEBandResult(
        pe_stats=pe_stats,
        band_prices=band_prices,
        band_pe_levels=band_pe_levels,
        mode=mode,
    )


def _calculate_pe_stats(valid_pe: pd.Series, percentiles: list[int]) -> PEStats:
    """
    Calculate P/E ratio statistics.

    Args:
        valid_pe: Series of valid (filtered) P/E ratios.
        percentiles: List of percentiles to calculate.

    Returns:
        PEStats dataclass with all statistics.
    """
    # Calculate percentiles
    percentile_values: dict[str, float] = {}
    for p in percentiles:
        percentile_values[f"p{p}"] = float(np.nanpercentile(valid_pe, p))

    return PEStats(
        min=float(valid_pe.min()),
        max=float(valid_pe.max()),
        mean=float(valid_pe.mean()),
        median=float(valid_pe.median()),
        std=float(valid_pe.std()),
        current=float(valid_pe.iloc[-1]) if len(valid_pe) > 0 else np.nan,
        p10=percentile_values.get("p10", np.nan),
        p25=percentile_values.get("p25", np.nan),
        p50=percentile_values.get("p50", np.nan),
        p75=percentile_values.get("p75", np.nan),
        p90=percentile_values.get("p90", np.nan),
    )


def _calculate_band_levels(pe_stats: PEStats, mode: BandMode) -> dict[str, float]:
    """
    Calculate P/E levels for each band.

    Args:
        pe_stats: P/E statistics.
        mode: Band calculation mode.

    Returns:
        Dictionary mapping band names to P/E levels.
    """
    if mode == "stddev":
        # Standard deviation bands: avg-2σ, avg-1σ, avg, avg+1σ, avg+2σ
        mean_pe = pe_stats.mean
        std_pe = pe_stats.std

        return {
            "Avg -2σ": mean_pe - 2 * std_pe,
            "Avg -1σ": mean_pe - 1 * std_pe,
            "Average": mean_pe,
            "Avg +1σ": mean_pe + 1 * std_pe,
            "Avg +2σ": mean_pe + 2 * std_pe,
        }
    else:
        # Percentile bands (default): P10, P25, P50, P75, P90
        return {
            "Low (P10)": pe_stats.p10,
            "Below Avg (P25)": pe_stats.p25,
            "Average (P50)": pe_stats.p50,
            "Above Avg (P75)": pe_stats.p75,
            "High (P90)": pe_stats.p90,
        }


def _calculate_band_prices(
    ttm_eps: pd.Series, band_pe_levels: dict[str, float]
) -> pd.DataFrame:
    """
    Calculate implied prices at each band level.

    Implied price = TTM EPS × P/E multiple

    Args:
        ttm_eps: Series of TTM EPS values.
        band_pe_levels: Dictionary mapping band names to P/E levels.

    Returns:
        DataFrame with implied prices for each band.
    """
    band_prices: dict[str, pd.Series] = {}

    for band_name, pe_level in band_pe_levels.items():
        band_prices[band_name] = ttm_eps * pe_level

    return pd.DataFrame(band_prices, index=ttm_eps.index)
