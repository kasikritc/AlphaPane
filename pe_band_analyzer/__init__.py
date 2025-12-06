"""
VI-Scanner: P/E Band Analysis Module.

Part of the VI-Scanner (Value Investing Scanner) suite of tools.
This module provides P/E (Price-to-Earnings) ratio band analysis
to help identify when stocks are undervalued or overvalued relative to their
historical valuation multiples.

Features:
    - Fetch historical price and earnings data
    - Calculate trailing 12-month (TTM) EPS
    - Compute P/E ratio valuation bands
    - Generate visual P/E band charts
    - Support for percentile and standard deviation band modes

Quick Start:
    >>> from pe_band_analyzer import analyze_stock_pe_band
    >>> result = analyze_stock_pe_band("AAPL")

For extended historical data (5+ years), set the FMP_API_KEY environment variable.
Get a free API key at: https://site.financialmodelingprep.com/developer/docs

Example with custom settings:
    >>> result = analyze_stock_pe_band("MSFT", years=5, mode="stddev")
"""

__version__ = "0.0.1"
__author__ = "VI-Scanner"

# Main analysis function (primary export)
from pe_band_analyzer.analyzer import analyze_stock_pe_band, get_valuation_assessment

# Data models
from pe_band_analyzer.models import (
    PEStats,
    PEBandResult,
    AnalysisResult,
    ValuationAssessment,
    BandMode,
)

# API clients
from pe_band_analyzer.api import YahooFinanceAPI, FinancialModelingPrepAPI

# Core functions
from pe_band_analyzer.core import (
    extract_quarterly_eps,
    extract_annual_eps,
    calculate_ttm_eps_series,
    compute_pe_ratio,
    compute_pe_bands,
)

# Visualization
from pe_band_analyzer.visualization import plot_pe_band_chart

# Exceptions
from pe_band_analyzer.exceptions import (
    PEBandAnalyzerError,
    DataFetchError,
    NoDataError,
    InvalidSymbolError,
    InsufficientDataError,
    APIConfigurationError,
)

__all__ = [
    # Version
    "__version__",
    # Main function
    "analyze_stock_pe_band",
    "get_valuation_assessment",
    # Models
    "PEStats",
    "PEBandResult",
    "AnalysisResult",
    "ValuationAssessment",
    "BandMode",
    # API clients
    "YahooFinanceAPI",
    "FinancialModelingPrepAPI",
    # Core functions
    "extract_quarterly_eps",
    "extract_annual_eps",
    "calculate_ttm_eps_series",
    "compute_pe_ratio",
    "compute_pe_bands",
    # Visualization
    "plot_pe_band_chart",
    # Exceptions
    "PEBandAnalyzerError",
    "DataFetchError",
    "NoDataError",
    "InvalidSymbolError",
    "InsufficientDataError",
    "APIConfigurationError",
]
