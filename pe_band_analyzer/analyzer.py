"""
Main P/E band analysis orchestration.

This module provides the high-level analysis function that coordinates
data fetching, EPS extraction, P/E calculation, and visualization.
"""

import os

from dotenv import load_dotenv

from pe_band_analyzer.api.yahoo import YahooFinanceAPI
from pe_band_analyzer.api.fmp import FinancialModelingPrepAPI
from pe_band_analyzer.core.eps import (
    extract_quarterly_eps,
    extract_annual_eps,
    calculate_ttm_eps_series,
)
from pe_band_analyzer.core.pe_bands import compute_pe_ratio, compute_pe_bands
from pe_band_analyzer.visualization import plot_pe_band_chart
from pe_band_analyzer.models import (
    AnalysisResult,
    PEStats,
    ValuationAssessment,
    BandMode,
)
from pe_band_analyzer.constants import (
    DEFAULT_YEARS,
    DEFAULT_MODE,
    VALUATION_VERY_CHEAP,
    VALUATION_CHEAP,
    VALUATION_BELOW_AVERAGE,
    VALUATION_ABOVE_AVERAGE,
    VALUATION_EXPENSIVE,
    VALUATION_VERY_EXPENSIVE,
)

# Load environment variables from .env file
load_dotenv()


def analyze_stock_pe_band(
    symbol: str,
    years: int = DEFAULT_YEARS,
    mode: BandMode = DEFAULT_MODE,
) -> AnalysisResult | None:
    """
    Complete P/E band analysis for a stock.

    Performs end-to-end analysis including:
    1. Fetching historical price and earnings data
    2. Calculating TTM (Trailing 12-Month) EPS
    3. Computing P/E ratios and valuation bands
    4. Generating a P/E band chart
    5. Printing valuation assessment

    Args:
        symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT', 'GOOGL').
        years: Number of years of historical data (default: 10).
        mode: Band calculation mode - 'percentile' or 'stddev' (default: 'percentile').
              - percentile: Bands at P10, P25, P50, P75, P90
              - stddev: Bands at avg-2σ, avg-1σ, avg, avg+1σ, avg+2σ

    Returns:
        AnalysisResult containing all analysis data, or None if analysis fails.

    Note:
        For extended historical data (5+ years), set the FMP_API_KEY
        environment variable. Get a free API key at:
        https://site.financialmodelingprep.com/developer/docs

    Example:
        >>> result = analyze_stock_pe_band("AAPL")
        >>> print(f"Current P/E: {result.current_pe:.1f}x")
        >>> print(f"Fair Value: ${result.pe_stats.p50 * result.current_ttm_eps:.2f}")

        >>> # With custom settings
        >>> result = analyze_stock_pe_band("MSFT", years=5, mode="stddev")
    """
    mode_label = "Standard Deviation" if mode == "stddev" else "Percentile"
    _print_header(symbol, mode_label)

    # Initialize APIs
    yahoo_api = YahooFinanceAPI()
    fmp_api = _initialize_fmp_api()

    # Step 1: Fetch data
    print("Step 1: Fetching price data from Yahoo Finance...")
    try:
        prices = yahoo_api.get_historical_prices(symbol, years=years)
        print(f"  ✓ {len(prices)} days of price history")
    except Exception as e:
        print(f"  ✗ Failed to fetch prices: {e}")
        return None

    try:
        earnings = yahoo_api.get_earnings_data(symbol)
        print("  ✓ Yahoo earnings data loaded")
    except Exception as e:
        print(f"  ✗ Failed to fetch earnings: {e}")
        return None

    # Step 2: Extract EPS
    print("\nStep 2: Extracting EPS data...")
    try:
        quarterly_eps = extract_quarterly_eps(earnings, fmp_api=fmp_api, symbol=symbol)
        annual_eps = extract_annual_eps(earnings)
        print(f"  → Total: {len(quarterly_eps)} quarters of EPS data")
    except Exception as e:
        print(f"  ✗ Failed to extract EPS: {e}")
        return None

    # Step 3: Calculate TTM EPS
    print("\nStep 3: Calculating TTM EPS...")
    ttm_eps = calculate_ttm_eps_series(quarterly_eps, annual_eps, prices.index)
    valid_eps_count = ttm_eps.notna().sum()
    print(f"  ✓ TTM EPS calculated for {valid_eps_count} dates")

    # Step 4: Compute P/E ratio and bands
    print(f"\nStep 4: Computing P/E bands ({mode} mode)...")
    pe_ratio = compute_pe_ratio(prices, ttm_eps)
    pe_data = compute_pe_bands(pe_ratio, ttm_eps, mode=mode)

    # Step 5: Display results
    _print_results(symbol, prices, ttm_eps, pe_data.pe_stats, mode)

    # Step 6: Generate chart
    print(f"\n{'=' * 60}")
    print("Generating P/E Band Chart...")
    plot_pe_band_chart(
        symbol=symbol,
        prices=prices,
        band_prices=pe_data.band_prices,
        pe_stats=pe_data.pe_stats,
        pe_ratio=pe_ratio,
        band_pe_levels=pe_data.band_pe_levels,
        mode=mode,
    )

    # Return analysis result
    return AnalysisResult(
        symbol=symbol,
        prices=prices,
        ttm_eps=ttm_eps,
        pe_ratio=pe_ratio,
        pe_stats=pe_data.pe_stats,
        band_prices=pe_data.band_prices,
        band_pe_levels=pe_data.band_pe_levels,
        mode=mode,
    )


def _print_header(symbol: str, mode_label: str) -> None:
    """Print analysis header."""
    print(f"{'=' * 60}")
    print(f"P/E BAND ANALYSIS: {symbol} ({mode_label} Mode)")
    print(f"{'=' * 60}\n")


def _initialize_fmp_api() -> FinancialModelingPrepAPI | None:
    """
    Initialize FMP API if API key is available.

    Returns:
        FinancialModelingPrepAPI instance or None if no API key.
    """
    fmp_api_key = os.getenv("FMP_API_KEY")

    if fmp_api_key and fmp_api_key != "your_api_key_here":
        print("✓ FMP API key detected - will fetch extended historical EPS\n")
        return FinancialModelingPrepAPI(fmp_api_key)
    else:
        print("⚠ No FMP API key found - chart history will be limited (~1 year)")
        print("  Set FMP_API_KEY env variable for 5-10 years of history")
        print("  Get free key at: https://site.financialmodelingprep.com/developer/docs\n")
        return None


def _print_results(
    symbol: str,
    prices,
    ttm_eps,
    pe_stats: PEStats,
    mode: BandMode,
) -> None:
    """Print analysis results to console."""
    print(f"\n{'=' * 60}")
    print(f"RESULTS FOR {symbol}")
    print(f"{'=' * 60}")

    current_price = float(prices["Close"].iloc[-1])
    current_ttm_eps = float(ttm_eps.iloc[-1])
    current_pe = pe_stats.current

    if mode == "stddev":
        _print_stddev_results(pe_stats, current_price, current_ttm_eps, current_pe)
    else:
        _print_percentile_results(pe_stats, current_price, current_ttm_eps, current_pe)


def _print_stddev_results(
    pe_stats: PEStats,
    current_price: float,
    current_ttm_eps: float,
    current_pe: float,
) -> None:
    """Print results for standard deviation mode."""
    mean_pe = pe_stats.mean
    std_pe = pe_stats.std

    print("\nP/E Ratio Statistics (Standard Deviation):")
    print(f"  Average -2σ: {mean_pe - 2 * std_pe:.1f}x (very cheap)")
    print(f"  Average -1σ: {mean_pe - std_pe:.1f}x (cheap)")
    print(f"  Average:     {mean_pe:.1f}x (fair value)")
    print(f"  Average +1σ: {mean_pe + std_pe:.1f}x (expensive)")
    print(f"  Average +2σ: {mean_pe + 2 * std_pe:.1f}x (very expensive)")
    print(f"\n  Current P/E: {current_pe:.1f}x")

    # Valuation assessment
    assessment = get_valuation_assessment(pe_stats, current_pe, "stddev")
    print(f"\n  Valuation: {assessment.label} - {assessment.description}")
    print(f"\n  Current Price: ${current_price:.2f}")
    print(f"  Fair Value (at avg P/E): ${current_ttm_eps * mean_pe:.2f}")
    print(f"  Cheap Price (at avg-2σ P/E): ${current_ttm_eps * (mean_pe - 2 * std_pe):.2f}")
    print(f"  Expensive Price (at avg+2σ P/E): ${current_ttm_eps * (mean_pe + 2 * std_pe):.2f}")


def _print_percentile_results(
    pe_stats: PEStats,
    current_price: float,
    current_ttm_eps: float,
    current_pe: float,
) -> None:
    """Print results for percentile mode."""
    print("\nP/E Ratio Statistics (Percentile):")
    print(f"  10th Percentile: {pe_stats.p10:.1f}x (cheap)")
    print(f"  25th Percentile: {pe_stats.p25:.1f}x")
    print(f"  50th Percentile: {pe_stats.p50:.1f}x (fair value)")
    print(f"  75th Percentile: {pe_stats.p75:.1f}x")
    print(f"  90th Percentile: {pe_stats.p90:.1f}x (expensive)")
    print(f"\n  Current P/E:     {current_pe:.1f}x")

    # Valuation assessment
    assessment = get_valuation_assessment(pe_stats, current_pe, "percentile")
    print(f"\n  Valuation: {assessment.label} - {assessment.description}")
    print(f"\n  Current Price: ${current_price:.2f}")
    print(f"  Fair Value (at avg P/E): ${current_ttm_eps * pe_stats.p50:.2f}")
    print(f"  Cheap Price (at P10 P/E): ${current_ttm_eps * pe_stats.p10:.2f}")
    print(f"  Expensive Price (at P90 P/E): ${current_ttm_eps * pe_stats.p90:.2f}")


def get_valuation_assessment(
    pe_stats: PEStats, current_pe: float, mode: BandMode
) -> ValuationAssessment:
    """
    Determine valuation assessment based on current P/E.

    Args:
        pe_stats: P/E statistics.
        current_pe: Current P/E ratio.
        mode: Band calculation mode.

    Returns:
        ValuationAssessment with label, description, and price targets.
    """
    # We need current TTM EPS to calculate price targets
    # Since we don't have it here, we'll calculate from pe_stats
    # Approximate current EPS from the stats (this is a simplification)

    if mode == "stddev":
        mean_pe = pe_stats.mean
        std_pe = pe_stats.std

        # Determine assessment
        if current_pe <= mean_pe - 2 * std_pe:
            label = VALUATION_VERY_CHEAP
            description = "Below Avg -2σ"
        elif current_pe <= mean_pe - std_pe:
            label = VALUATION_CHEAP
            description = "Between Avg -2σ and Avg -1σ"
        elif current_pe <= mean_pe:
            label = VALUATION_BELOW_AVERAGE
            description = "Between Avg -1σ and Avg"
        elif current_pe <= mean_pe + std_pe:
            label = VALUATION_ABOVE_AVERAGE
            description = "Between Avg and Avg +1σ"
        elif current_pe <= mean_pe + 2 * std_pe:
            label = VALUATION_EXPENSIVE
            description = "Between Avg +1σ and Avg +2σ"
        else:
            label = VALUATION_VERY_EXPENSIVE
            description = "Above Avg +2σ"

        # Calculate implied EPS from current P/E (for price targets)
        # This assumes current_pe is valid
        if current_pe > 0:
            implied_eps = 1.0  # Normalize to $1 EPS for ratio calculations
            fair_value_price = implied_eps * mean_pe
            cheap_price = implied_eps * (mean_pe - 2 * std_pe)
            expensive_price = implied_eps * (mean_pe + 2 * std_pe)
        else:
            fair_value_price = cheap_price = expensive_price = 0.0

    else:  # percentile mode
        if current_pe <= pe_stats.p10:
            label = VALUATION_VERY_CHEAP
            description = "Below 10th percentile"
        elif current_pe <= pe_stats.p25:
            label = VALUATION_CHEAP
            description = "Below 25th percentile"
        elif current_pe <= pe_stats.p50:
            label = VALUATION_BELOW_AVERAGE
            description = "25th to 50th percentile"
        elif current_pe <= pe_stats.p75:
            label = VALUATION_ABOVE_AVERAGE
            description = "50th to 75th percentile"
        elif current_pe <= pe_stats.p90:
            label = VALUATION_EXPENSIVE
            description = "75th to 90th percentile"
        else:
            label = VALUATION_VERY_EXPENSIVE
            description = "Above 90th percentile"

        # Price targets (normalized)
        implied_eps = 1.0
        fair_value_price = implied_eps * pe_stats.p50
        cheap_price = implied_eps * pe_stats.p10
        expensive_price = implied_eps * pe_stats.p90

    return ValuationAssessment(
        label=label,
        description=description,
        fair_value_price=fair_value_price,
        cheap_price=cheap_price,
        expensive_price=expensive_price,
    )
