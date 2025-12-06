"""
EPS (Earnings Per Share) extraction and TTM calculation.

This module provides functions to extract quarterly and annual EPS data
from various sources and calculate trailing 12-month (TTM) EPS.
"""

from typing import Any

import numpy as np
import pandas as pd

from pe_band_analyzer.api.fmp import FinancialModelingPrepAPI
from pe_band_analyzer.exceptions import NoDataError


def extract_quarterly_eps_from_yahoo(earnings_data: dict[str, Any]) -> pd.DataFrame:
    """
    Extract quarterly EPS from Yahoo Finance earnings data.

    Parses the earningsHistory and incomeStatementHistoryQuarterly
    modules from Yahoo Finance quoteSummary response.

    Args:
        earnings_data: Raw earnings data dictionary from Yahoo Finance API.

    Returns:
        DataFrame with columns: date, eps, source.
        Sorted by date, typically contains ~4 quarters of data.

    Note:
        Yahoo Finance typically only provides ~4 quarters of quarterly EPS.
        For longer history, use FMP API via extract_quarterly_eps().
    """
    eps_list: list[dict[str, Any]] = []

    # Try earningsHistory first (most detailed quarterly data)
    if "earningsHistory" in earnings_data:
        history = earnings_data["earningsHistory"].get("history", [])
        for item in history:
            if "epsActual" in item and item["epsActual"]:
                date_val = _extract_date_value(
                    item, ["quarterDate", "quarter", "endDate", "fiscalDateEnding"]
                )
                if date_val:
                    eps_list.append(
                        {
                            "date": pd.to_datetime(date_val),
                            "eps": item["epsActual"].get("raw", 0),
                            "source": "Yahoo",
                        }
                    )

    # Also try incomeStatementHistoryQuarterly for additional data
    if "incomeStatementHistoryQuarterly" in earnings_data:
        statements = earnings_data["incomeStatementHistoryQuarterly"].get(
            "incomeStatementHistory", []
        )
        for stmt in statements:
            if "dilutedEPS" in stmt and stmt["dilutedEPS"]:
                date_val = _extract_date_value(
                    stmt, ["endDate", "fiscalDateEnding", "date"]
                )
                if date_val:
                    date = pd.to_datetime(date_val)
                    # Avoid duplicates
                    if not any(e["date"] == date for e in eps_list):
                        eps_list.append(
                            {
                                "date": date,
                                "eps": stmt["dilutedEPS"].get("raw", 0),
                                "source": "Yahoo",
                            }
                        )

    if not eps_list:
        return pd.DataFrame(columns=["date", "eps", "source"])

    df = pd.DataFrame(eps_list)
    df = df.sort_values("date").drop_duplicates(subset=["date"])
    return df


def _extract_date_value(
    item: dict[str, Any], date_fields: list[str]
) -> str | None:
    """
    Extract date value from a dictionary, trying multiple field names.

    Args:
        item: Dictionary to extract date from.
        date_fields: List of field names to try in order.

    Returns:
        Date string if found, None otherwise.
    """
    for date_field in date_fields:
        if date_field in item and item[date_field]:
            if isinstance(item[date_field], dict):
                return item[date_field].get("fmt") or item[date_field].get("raw")
            return item[date_field]
    return None


def extract_quarterly_eps(
    earnings_data: dict[str, Any],
    fmp_api: FinancialModelingPrepAPI | None = None,
    symbol: str | None = None,
) -> pd.DataFrame:
    """
    Extract quarterly EPS data from multiple sources.

    Uses FMP API (if available) for extended historical data,
    with Yahoo Finance as fallback for recent quarters.

    Args:
        earnings_data: Yahoo Finance earnings data dictionary.
        fmp_api: Optional FMP API client for extended history.
        symbol: Stock symbol (required if using FMP API).

    Returns:
        DataFrame with columns: date, eps, source.
        Combined data from all available sources.

    Raises:
        NoDataError: If no EPS data is found from any source.

    Example:
        >>> from pe_band_analyzer.api import YahooFinanceAPI, FinancialModelingPrepAPI
        >>> yahoo = YahooFinanceAPI()
        >>> fmp = FinancialModelingPrepAPI("your_key")
        >>> earnings = yahoo.get_earnings_data("AAPL")
        >>> eps_df = extract_quarterly_eps(earnings, fmp_api=fmp, symbol="AAPL")
    """
    # Try FMP API first if available (provides 5 years of annual EPS data)
    if fmp_api and symbol:
        try:
            fmp_eps = fmp_api.get_annual_eps_history(symbol, limit=5)
            if len(fmp_eps) > 0:
                print(
                    f"  ✓ Using Financial Modeling Prep API: "
                    f"{len(fmp_eps)} years of annual EPS data"
                )

                # Convert annual EPS to quarterly estimates (divide by 4)
                fmp_quarterly = _convert_annual_to_quarterly(fmp_eps)

                # Get Yahoo data for recent quarters (more accurate for recent data)
                yahoo_eps = extract_quarterly_eps_from_yahoo(earnings_data)

                if len(yahoo_eps) > 0:
                    # Combine: use Yahoo for recent quarters, FMP for historical
                    combined = _merge_eps_data(fmp_quarterly, yahoo_eps)
                    print(
                        f"  → Combined with Yahoo: {len(combined)} quarters total "
                        f"(~{len(combined) // 4} years)"
                    )
                    return combined
                else:
                    print(f"  → Estimated {len(fmp_quarterly)} quarters from annual data")
                    return fmp_quarterly

        except Exception as e:
            print(f"  ⚠ FMP API unavailable: {e}")

    # Fallback to Yahoo Finance only
    yahoo_eps = extract_quarterly_eps_from_yahoo(earnings_data)

    if len(yahoo_eps) > 0:
        print(f"  ⚠ Using Yahoo Finance only: {len(yahoo_eps)} quarters (limited history)")
        print("    → Set FMP_API_KEY environment variable for 5+ years of history")
        return yahoo_eps

    raise NoDataError(symbol or "unknown", "quarterly EPS")


def _convert_annual_to_quarterly(annual_eps: pd.DataFrame) -> pd.DataFrame:
    """
    Convert annual EPS data to quarterly estimates.

    Divides annual EPS by 4 and creates 4 quarters for each year.

    Args:
        annual_eps: DataFrame with annual EPS data.

    Returns:
        DataFrame with quarterly estimates.
    """
    quarterly_estimates: list[dict[str, Any]] = []

    for _, row in annual_eps.iterrows():
        year_end = row["date"]
        annual_eps_value = row["eps"]
        quarterly_eps = annual_eps_value / 4.0

        # Create 4 quarters for each year (going backwards from year-end)
        for q in range(4):
            quarter_date = year_end - pd.DateOffset(months=3 * q)
            quarterly_estimates.append(
                {
                    "date": quarter_date,
                    "eps": quarterly_eps,
                    "source": "FMP-Annual",
                }
            )

    df = pd.DataFrame(quarterly_estimates)
    df = df.sort_values("date").drop_duplicates(subset=["date"])
    return df


def _merge_eps_data(
    historical_eps: pd.DataFrame, recent_eps: pd.DataFrame
) -> pd.DataFrame:
    """
    Merge historical and recent EPS data, preferring recent data.

    Args:
        historical_eps: Historical EPS data (e.g., from FMP).
        recent_eps: Recent EPS data (e.g., from Yahoo).

    Returns:
        Combined DataFrame with no overlapping dates.
    """
    # Remove historical quarters that overlap with recent data
    recent_min_date = recent_eps["date"].min()
    historical_only = historical_eps[historical_eps["date"] < recent_min_date]

    # Combine and sort
    combined = pd.concat([historical_only, recent_eps], ignore_index=True)
    combined = combined.sort_values("date").drop_duplicates(subset=["date"])
    return combined


def extract_annual_eps(earnings_data: dict[str, Any]) -> pd.DataFrame:
    """
    Extract annual EPS from Yahoo Finance income statement history.

    Args:
        earnings_data: Raw earnings data dictionary from Yahoo Finance API.

    Returns:
        DataFrame with columns: date, eps, source.
        Returns empty DataFrame if no annual EPS is available.

    Note:
        This is used as a fallback when quarterly data is insufficient.
    """
    eps_list: list[dict[str, Any]] = []

    if "incomeStatementHistory" in earnings_data:
        statements = earnings_data["incomeStatementHistory"].get(
            "incomeStatementHistory", []
        )
        for stmt in statements:
            if "dilutedEPS" in stmt and stmt["dilutedEPS"]:
                date_val = _extract_date_value(
                    stmt, ["endDate", "fiscalDateEnding", "date"]
                )
                if date_val:
                    eps_list.append(
                        {
                            "date": pd.to_datetime(date_val),
                            "eps": stmt["dilutedEPS"].get("raw", 0),
                            "source": "incomeStatementAnnual",
                        }
                    )

    if not eps_list:
        return pd.DataFrame(columns=["date", "eps", "source"])

    df = pd.DataFrame(eps_list)
    df = df.sort_values("date")
    return df


def calculate_ttm_eps_series(
    quarterly_eps: pd.DataFrame,
    annual_eps: pd.DataFrame,
    price_dates: pd.DatetimeIndex,
) -> pd.Series:
    """
    Calculate Trailing 12-Month (TTM) EPS for each price date.

    For each date, TTM EPS = sum of last 4 quarters' EPS.
    Falls back to annual EPS or extrapolation when data is limited.

    Args:
        quarterly_eps: DataFrame with quarterly EPS data.
        annual_eps: DataFrame with annual EPS data (fallback).
        price_dates: DatetimeIndex of dates to calculate TTM EPS for.

    Returns:
        Series with TTM EPS values, indexed by price_dates.
        NaN values indicate insufficient data.

    Example:
        >>> ttm_eps = calculate_ttm_eps_series(quarterly_df, annual_df, prices.index)
        >>> current_ttm = ttm_eps.iloc[-1]
    """
    ttm_eps: pd.Series = pd.Series(index=price_dates, dtype=float)

    # Sort quarterly EPS by date
    quarterly_eps = quarterly_eps.sort_values("date")

    for price_date in price_dates:
        # Get quarters before this date
        available_quarters = quarterly_eps[quarterly_eps["date"] <= price_date].tail(4)

        if len(available_quarters) >= 4:
            # Sum last 4 quarters for TTM
            ttm_eps[price_date] = available_quarters["eps"].sum()
        elif len(available_quarters) > 0:
            # Extrapolate from available quarters
            avg_quarterly = available_quarters["eps"].mean()
            ttm_eps[price_date] = avg_quarterly * 4
        elif len(annual_eps) > 0:
            # Fallback to annual EPS if available
            available_annual = annual_eps[annual_eps["date"] <= price_date].tail(1)
            if len(available_annual) > 0:
                ttm_eps[price_date] = available_annual["eps"].values[0]
            else:
                ttm_eps[price_date] = np.nan
        else:
            ttm_eps[price_date] = np.nan

    return ttm_eps
