"""
Data models for the P/E Band Analyzer.

This module defines dataclasses that represent structured data
throughout the analysis pipeline.
"""

from dataclasses import dataclass, field
from typing import Literal

import pandas as pd


BandMode = Literal["percentile", "stddev"]
"""Type alias for band calculation modes."""


@dataclass
class PEStats:
    """
    P/E ratio statistics for a stock.

    Contains historical P/E ratio metrics including range, averages,
    percentiles, and the current P/E value.
    """

    min: float
    """Minimum historical P/E ratio."""

    max: float
    """Maximum historical P/E ratio."""

    mean: float
    """Mean (average) historical P/E ratio."""

    median: float
    """Median historical P/E ratio."""

    std: float
    """Standard deviation of historical P/E ratios."""

    current: float
    """Current (most recent) P/E ratio."""

    p10: float
    """10th percentile P/E ratio."""

    p25: float
    """25th percentile P/E ratio."""

    p50: float
    """50th percentile P/E ratio (same as median)."""

    p75: float
    """75th percentile P/E ratio."""

    p90: float
    """90th percentile P/E ratio."""

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary format."""
        return {
            "min": self.min,
            "max": self.max,
            "mean": self.mean,
            "median": self.median,
            "std": self.std,
            "current": self.current,
            "p10": self.p10,
            "p25": self.p25,
            "p50": self.p50,
            "p75": self.p75,
            "p90": self.p90,
        }

    @classmethod
    def from_dict(cls, data: dict[str, float]) -> "PEStats":
        """Create PEStats from dictionary."""
        return cls(
            min=data["min"],
            max=data["max"],
            mean=data["mean"],
            median=data["median"],
            std=data["std"],
            current=data["current"],
            p10=data["p10"],
            p25=data["p25"],
            p50=data["p50"],
            p75=data["p75"],
            p90=data["p90"],
        )


@dataclass
class PEBandResult:
    """
    Result of P/E band calculation.

    Contains the P/E statistics, implied prices at each band level,
    and the P/E levels used for each band.
    """

    pe_stats: PEStats
    """Statistical summary of P/E ratios."""

    band_prices: pd.DataFrame
    """DataFrame with implied prices at each band level over time."""

    band_pe_levels: dict[str, float]
    """Dictionary mapping band names to their P/E levels."""

    mode: BandMode
    """The band calculation mode used ('percentile' or 'stddev')."""


@dataclass
class EPSData:
    """
    EPS (Earnings Per Share) data for a stock.

    Contains quarterly and/or annual EPS data with source information.
    """

    date: pd.Timestamp
    """Date of the EPS report."""

    eps: float
    """EPS value (diluted)."""

    source: str
    """Data source (e.g., 'Yahoo', 'FMP', 'FMP-Annual')."""


@dataclass
class AnalysisResult:
    """
    Complete result of P/E band analysis for a stock.

    Contains all data generated during analysis including prices,
    EPS data, P/E ratios, statistics, and band calculations.
    """

    symbol: str
    """Stock ticker symbol."""

    prices: pd.DataFrame
    """Historical price data (OHLCV)."""

    ttm_eps: pd.Series
    """Trailing 12-month EPS for each date."""

    pe_ratio: pd.Series
    """P/E ratio for each date."""

    pe_stats: PEStats
    """P/E ratio statistics."""

    band_prices: pd.DataFrame
    """Implied prices at each band level."""

    band_pe_levels: dict[str, float]
    """P/E levels for each band."""

    mode: BandMode
    """Band calculation mode used."""

    current_price: float = field(init=False)
    """Current stock price."""

    current_ttm_eps: float = field(init=False)
    """Current TTM EPS."""

    current_pe: float = field(init=False)
    """Current P/E ratio."""

    def __post_init__(self) -> None:
        """Calculate derived fields after initialization."""
        self.current_price = float(self.prices["Close"].iloc[-1])
        self.current_ttm_eps = float(self.ttm_eps.iloc[-1])
        self.current_pe = self.pe_stats.current


@dataclass
class ValuationAssessment:
    """
    Valuation assessment based on P/E analysis.

    Provides a summary of whether a stock is under/overvalued
    relative to its historical P/E range.
    """

    label: str
    """Short valuation label (e.g., 'CHEAP', 'EXPENSIVE')."""

    description: str
    """Detailed description of the valuation assessment."""

    fair_value_price: float
    """Implied fair value price at average P/E."""

    cheap_price: float
    """Price at which stock would be considered cheap."""

    expensive_price: float
    """Price at which stock would be considered expensive."""
