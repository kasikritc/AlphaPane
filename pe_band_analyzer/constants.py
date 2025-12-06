"""
Constants and configuration values for the P/E Band Analyzer.

This module centralizes all magic numbers, default values, colors,
and configuration settings used throughout the package.
"""

from typing import Final

# =============================================================================
# Default Analysis Parameters
# =============================================================================

DEFAULT_YEARS: Final[int] = 10
"""Default number of years of historical data to analyze."""

DEFAULT_MODE: Final[str] = "percentile"
"""Default band calculation mode ('percentile' or 'stddev')."""

DEFAULT_PERCENTILES: Final[list[int]] = [10, 25, 50, 75, 90]
"""Default percentiles for P/E band calculations."""

# =============================================================================
# P/E Ratio Bounds
# =============================================================================

PE_RATIO_MIN: Final[float] = 0.0
"""Minimum valid P/E ratio (exclude negative P/E)."""

PE_RATIO_MAX: Final[float] = 200.0
"""Maximum valid P/E ratio (filter outliers)."""

# =============================================================================
# API Configuration
# =============================================================================

USER_AGENT: Final[str] = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
)
"""User agent string for HTTP requests."""

YAHOO_FINANCE_BASE_URL: Final[str] = "https://query1.finance.yahoo.com"
"""Base URL for Yahoo Finance API."""

FMP_BASE_URL: Final[str] = "https://financialmodelingprep.com/stable"
"""Base URL for Financial Modeling Prep API."""

FMP_MAX_FREE_YEARS: Final[int] = 5
"""Maximum years of data available on FMP free tier."""

API_TIMEOUT_SECONDS: Final[int] = 30
"""Default timeout for API requests in seconds."""

# =============================================================================
# Chart Colors
# =============================================================================

BAND_COLORS_PERCENTILE: Final[dict[str, str]] = {
    "Low (P10)": "#22c55e",        # Green (very cheap)
    "Below Avg (P25)": "#84cc16",  # Lime (cheap)
    "Average (P50)": "#3b82f6",    # Blue (fair value)
    "Above Avg (P75)": "#f97316",  # Orange (expensive)
    "High (P90)": "#ef4444",       # Red (very expensive)
}
"""Colors for P/E bands in percentile mode."""

BAND_COLORS_STDDEV: Final[dict[str, str]] = {
    "Avg -2σ": "#22c55e",   # Green (very cheap)
    "Avg -1σ": "#84cc16",   # Lime (cheap)
    "Average": "#3b82f6",   # Blue (fair value)
    "Avg +1σ": "#f97316",   # Orange (expensive)
    "Avg +2σ": "#ef4444",   # Red (very expensive)
}
"""Colors for P/E bands in standard deviation mode."""

PRICE_LINE_COLOR: Final[str] = "black"
"""Color for the actual stock price line on charts."""

PE_RATIO_LINE_COLOR: Final[str] = "purple"
"""Color for the P/E ratio line on charts."""

# =============================================================================
# Chart Configuration
# =============================================================================

CHART_FIGURE_SIZE: Final[tuple[int, int]] = (14, 10)
"""Default figure size for P/E band charts (width, height)."""

CHART_DPI: Final[int] = 150
"""DPI for saved chart images."""

CHART_HEIGHT_RATIOS: Final[list[int]] = [3, 1]
"""Height ratios for main price chart vs P/E ratio subplot."""

# =============================================================================
# Band Names
# =============================================================================

PERCENTILE_BAND_NAMES: Final[list[str]] = [
    "Low (P10)",
    "Below Avg (P25)",
    "Average (P50)",
    "Above Avg (P75)",
    "High (P90)",
]
"""Band names for percentile mode."""

STDDEV_BAND_NAMES: Final[list[str]] = [
    "Avg -2σ",
    "Avg -1σ",
    "Average",
    "Avg +1σ",
    "Avg +2σ",
]
"""Band names for standard deviation mode."""

# =============================================================================
# Valuation Assessment Thresholds
# =============================================================================

VALUATION_VERY_CHEAP: Final[str] = "VERY CHEAP"
VALUATION_CHEAP: Final[str] = "CHEAP"
VALUATION_BELOW_AVERAGE: Final[str] = "BELOW AVERAGE"
VALUATION_ABOVE_AVERAGE: Final[str] = "ABOVE AVERAGE"
VALUATION_EXPENSIVE: Final[str] = "EXPENSIVE"
VALUATION_VERY_EXPENSIVE: Final[str] = "VERY EXPENSIVE"
