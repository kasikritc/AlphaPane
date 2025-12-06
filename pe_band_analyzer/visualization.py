"""
P/E Band chart visualization.

This module provides functions to create P/E band charts
that visualize stock prices relative to historical valuation bands.
"""

import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import pandas as pd

from pe_band_analyzer.constants import (
    BAND_COLORS_PERCENTILE,
    BAND_COLORS_STDDEV,
    PRICE_LINE_COLOR,
    PE_RATIO_LINE_COLOR,
    CHART_FIGURE_SIZE,
    CHART_DPI,
    CHART_HEIGHT_RATIOS,
)
from pe_band_analyzer.models import PEStats, BandMode


def plot_pe_band_chart(
    symbol: str,
    prices: pd.DataFrame,
    band_prices: pd.DataFrame,
    pe_stats: PEStats,
    pe_ratio: pd.Series,
    band_pe_levels: dict[str, float],
    mode: BandMode = "percentile",
    output_path: str | None = None,
) -> str:
    """
    Create a P/E band chart showing stock price vs valuation bands.

    The chart consists of two subplots:
    1. Top: Stock price with P/E valuation bands
    2. Bottom: Historical P/E ratio over time

    Args:
        symbol: Stock ticker symbol.
        prices: DataFrame with price data (must have 'Close' column).
        band_prices: DataFrame with implied prices at each band level.
        pe_stats: P/E statistics object.
        pe_ratio: Series of P/E ratios over time.
        band_pe_levels: Dictionary mapping band names to P/E levels.
        mode: Band calculation mode ('percentile' or 'stddev').
        output_path: Custom output path for the chart. If None, saves as
                     {symbol}_pe_band_chart.png in current directory.

    Returns:
        Path to the saved chart file.

    Example:
        >>> chart_path = plot_pe_band_chart(
        ...     symbol="AAPL",
        ...     prices=prices_df,
        ...     band_prices=band_df,
        ...     pe_stats=stats,
        ...     pe_ratio=pe_series,
        ...     band_pe_levels=levels,
        ...     mode="percentile"
        ... )
    """
    # Filter to dates where we have band data
    valid_mask = band_prices.notna().all(axis=1)
    valid_dates = band_prices.index[valid_mask]

    if len(valid_dates) == 0:
        print("No valid band data to plot")
        return ""

    # Get the date range where we have EPS data
    start_date = valid_dates.min()
    end_date = valid_dates.max()

    # Filter data to this range
    mask = (prices.index >= start_date) & (prices.index <= end_date)
    plot_prices = prices.loc[mask]
    plot_bands = band_prices.loc[mask]
    plot_pe = pe_ratio.loc[mask]

    # Get colors based on mode
    band_colors = BAND_COLORS_STDDEV if mode == "stddev" else BAND_COLORS_PERCENTILE

    # Create figure with two subplots
    fig, (ax1, ax2) = plt.subplots(
        2,
        1,
        figsize=CHART_FIGURE_SIZE,
        height_ratios=CHART_HEIGHT_RATIOS,
        sharex=True,
        gridspec_kw={"hspace": 0.1},
    )

    # Plot top chart (price with bands)
    _plot_price_chart(
        ax1, symbol, plot_prices, plot_bands, band_pe_levels, band_colors, pe_stats, mode
    )

    # Plot bottom chart (P/E ratio)
    _plot_pe_ratio_chart(ax2, plot_pe, pe_stats, mode, start_date, end_date)

    # Format x-axis dates
    _format_date_axis(ax2, start_date, end_date)

    # Finalize and save
    plt.tight_layout()

    if output_path is None:
        output_path = f"{symbol}_pe_band_chart.png"

    plt.savefig(output_path, dpi=CHART_DPI, bbox_inches="tight")
    plt.close(fig)

    print(f"\n✓ Chart saved as {output_path}")
    return output_path


def _plot_price_chart(
    ax: plt.Axes,
    symbol: str,
    prices: pd.DataFrame,
    band_prices: pd.DataFrame,
    band_pe_levels: dict[str, float],
    band_colors: dict[str, str],
    pe_stats: PEStats,
    mode: BandMode,
) -> None:
    """
    Plot the main price chart with P/E bands.

    Args:
        ax: Matplotlib axes to plot on.
        symbol: Stock ticker symbol.
        prices: Filtered price data.
        band_prices: Filtered band prices.
        band_pe_levels: P/E levels for each band.
        band_colors: Color mapping for bands.
        pe_stats: P/E statistics.
        mode: Band calculation mode.
    """
    band_names = list(band_prices.columns)

    # Fill between bands (shaded regions)
    for i in range(len(band_names) - 1):
        lower_band = band_names[i]
        upper_band = band_names[i + 1]
        ax.fill_between(
            band_prices.index,
            band_prices[lower_band],
            band_prices[upper_band],
            alpha=0.2,
            color=band_colors[upper_band],
            label=None,
        )

    # Plot band lines
    for band_name in band_names:
        pe_level = band_pe_levels[band_name]
        ax.plot(
            band_prices.index,
            band_prices[band_name],
            color=band_colors[band_name],
            linestyle="--",
            linewidth=1.5,
            alpha=0.8,
            label=f"{band_name}: {pe_level:.1f}x P/E",
        )

    # Plot actual price (on top)
    ax.plot(
        prices.index,
        prices["Close"],
        color=PRICE_LINE_COLOR,
        linewidth=2,
        label=f"{symbol} Price",
    )

    # Styling
    ax.set_ylabel("Price ($)", fontsize=12)
    mode_label = "Std Dev Bands" if mode == "stddev" else "Percentile Bands"
    ax.set_title(
        f"{symbol} P/E Band Chart ({mode_label})\n"
        f"Historical P/E Range: {pe_stats.min:.1f}x - {pe_stats.max:.1f}x | "
        f"Current P/E: {pe_stats.current:.1f}x",
        fontsize=14,
        fontweight="bold",
    )
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    ax.set_xlim(prices.index.min(), prices.index.max())

    # Format y-axis as currency
    ax.yaxis.set_major_formatter(plt.FuncFormatter(lambda x, p: f"${x:,.0f}"))


def _plot_pe_ratio_chart(
    ax: plt.Axes,
    pe_ratio: pd.Series,
    pe_stats: PEStats,
    mode: BandMode,
    start_date: pd.Timestamp,
    end_date: pd.Timestamp,
) -> None:
    """
    Plot the P/E ratio over time chart.

    Args:
        ax: Matplotlib axes to plot on.
        pe_ratio: Filtered P/E ratio series.
        pe_stats: P/E statistics.
        mode: Band calculation mode.
        start_date: Start date of the plot range.
        end_date: End date of the plot range.
    """
    ax.plot(pe_ratio.index, pe_ratio, color=PE_RATIO_LINE_COLOR, linewidth=1.5)

    # Add horizontal lines for key P/E levels based on mode
    if mode == "stddev":
        mean_pe = pe_stats.mean
        std_pe = pe_stats.std
        ax.axhline(
            y=mean_pe - std_pe,
            color="#84cc16",
            linestyle="--",
            alpha=0.7,
            label=f"Avg-1σ: {mean_pe - std_pe:.1f}x",
        )
        ax.axhline(
            y=mean_pe,
            color="#3b82f6",
            linestyle="--",
            alpha=0.7,
            label=f"Avg: {mean_pe:.1f}x",
        )
        ax.axhline(
            y=mean_pe + std_pe,
            color="#f97316",
            linestyle="--",
            alpha=0.7,
            label=f"Avg+1σ: {mean_pe + std_pe:.1f}x",
        )
        # Set reasonable y-axis limits for P/E (stddev mode)
        pe_min = max(0, mean_pe - 2.5 * std_pe)
        pe_max = min(mean_pe + 2.5 * std_pe, 100)
    else:
        ax.axhline(
            y=pe_stats.p25,
            color="#84cc16",
            linestyle="--",
            alpha=0.7,
            label=f"P25: {pe_stats.p25:.1f}x",
        )
        ax.axhline(
            y=pe_stats.p50,
            color="#3b82f6",
            linestyle="--",
            alpha=0.7,
            label=f"P50: {pe_stats.p50:.1f}x",
        )
        ax.axhline(
            y=pe_stats.p75,
            color="#f97316",
            linestyle="--",
            alpha=0.7,
            label=f"P75: {pe_stats.p75:.1f}x",
        )
        # Set reasonable y-axis limits for P/E (percentile mode)
        pe_min = max(0, pe_stats.p10 - 5)
        pe_max = min(pe_stats.p90 + 10, 100)

    ax.set_ylabel("P/E Ratio", fontsize=12)
    ax.set_xlabel("Date", fontsize=12)
    ax.legend(loc="upper left", fontsize=9)
    ax.grid(True, alpha=0.3)
    ax.set_ylim(pe_min, pe_max)


def _format_date_axis(
    ax: plt.Axes, start_date: pd.Timestamp, end_date: pd.Timestamp
) -> None:
    """
    Format the x-axis date labels based on date range.

    Args:
        ax: Matplotlib axes to format.
        start_date: Start date of the plot range.
        end_date: End date of the plot range.
    """
    # Calculate number of quarters in the date range
    date_range = end_date - start_date
    num_quarters = date_range.days / 90.0

    if num_quarters > 2:
        # Show start of every quarter (Jan, Apr, Jul, Oct)
        ax.xaxis.set_major_locator(mdates.MonthLocator(bymonth=[1, 4, 7, 10]))
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d, %Y"))
    else:
        # Show every month
        ax.xaxis.set_major_locator(mdates.MonthLocator())
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %d, %Y"))

    # Rotate x-axis date labels to prevent overlap
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=45, ha="right")
