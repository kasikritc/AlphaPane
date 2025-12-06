"""
Core business logic for P/E band analysis.

This package contains the core calculation functions:
- EPS extraction and TTM (Trailing Twelve Months) calculation
- P/E ratio and band computations
"""

from pe_band_analyzer.core.eps import (
    extract_quarterly_eps_from_yahoo,
    extract_quarterly_eps,
    extract_annual_eps,
    calculate_ttm_eps_series,
)
from pe_band_analyzer.core.pe_bands import (
    compute_pe_ratio,
    compute_pe_bands,
)

__all__ = [
    "extract_quarterly_eps_from_yahoo",
    "extract_quarterly_eps",
    "extract_annual_eps",
    "calculate_ttm_eps_series",
    "compute_pe_ratio",
    "compute_pe_bands",
]
