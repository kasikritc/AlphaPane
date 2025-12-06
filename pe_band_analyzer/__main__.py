"""
CLI entry point for VI-Scanner (Value Investing Scanner).

After installing with `pip install -e .`, run directly:
    vi-scanner AAPL
    vi-scanner MSFT --years 5 --mode stddev

Or run as a module:
    python -m pe_band_analyzer AAPL
"""

import argparse
import sys

from pe_band_analyzer import analyze_stock_pe_band, __version__


def create_parser() -> argparse.ArgumentParser:
    """Create and configure the argument parser."""
    parser = argparse.ArgumentParser(
        prog="vi-scanner",
        description="VI-Scanner: Value Investing Scanner - P/E Band Analysis Tool",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  vi-scanner AAPL                    # Analyze AAPL with default settings
  vi-scanner MSFT --years 5          # Analyze MSFT with 5 years of history
  vi-scanner NVDA --mode stddev      # Analyze NVDA using std dev bands
  vi-scanner GOOGL --years 10 --mode stddev

Environment Variables:
  FMP_API_KEY    Set this to enable extended historical EPS data (5+ years)
                 Get a free key at: https://site.financialmodelingprep.com/developer/docs
        """,
    )

    parser.add_argument(
        "ticker",
        type=str,
        help="Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)",
    )

    parser.add_argument(
        "--years",
        type=int,
        default=10,
        help="Number of years of historical data (default: 10)",
    )

    parser.add_argument(
        "--mode",
        type=str,
        choices=["percentile", "stddev"],
        default="percentile",
        help=(
            "Band calculation mode: 'percentile' (P10/P25/P50/P75/P90) "
            "or 'stddev' (avg +/- 1/2 std dev) (default: percentile)"
        ),
    )

    parser.add_argument(
        "--version",
        action="version",
        version=f"%(prog)s {__version__}",
    )

    return parser


def main() -> int:
    """
    Main entry point for CLI.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    parser = create_parser()
    args = parser.parse_args()

    # Validate ticker format
    ticker = args.ticker.upper()
    if not ticker.isalpha() or len(ticker) > 5:
        print(f"Error: Invalid ticker symbol '{args.ticker}'")
        print("Ticker should be 1-5 alphabetic characters (e.g., AAPL, MSFT)")
        return 1

    # Run analysis
    result = analyze_stock_pe_band(
        symbol=ticker,
        years=args.years,
        mode=args.mode,
    )

    if result is None:
        print("\nAnalysis failed. Check the error messages above.")
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
