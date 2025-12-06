"""
Yahoo Finance API client.

This module provides a direct interface to Yahoo Finance's unofficial API
for fetching historical stock prices and earnings data.
"""

from datetime import datetime, timedelta
from typing import Any

import pandas as pd
import requests

from pe_band_analyzer.constants import (
    USER_AGENT,
    YAHOO_FINANCE_BASE_URL,
    API_TIMEOUT_SECONDS,
)
from pe_band_analyzer.exceptions import DataFetchError, NoDataError


class YahooFinanceAPI:
    """
    Direct Yahoo Finance API client.

    Provides methods to fetch historical prices and earnings data
    without relying on third-party wrapper libraries.

    Example:
        >>> api = YahooFinanceAPI()
        >>> prices = api.get_historical_prices("AAPL", years=5)
        >>> earnings = api.get_earnings_data("AAPL")
    """

    def __init__(self) -> None:
        """Initialize the Yahoo Finance API client."""
        self._session: requests.Session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT})
        self._crumb: str | None = None

    def _get_crumb(self) -> str:
        """
        Get authentication crumb from Yahoo Finance.

        The crumb is required for certain API endpoints like quoteSummary.
        It's obtained by first getting cookies from fc.yahoo.com.

        Returns:
            Authentication crumb string.

        Raises:
            DataFetchError: If crumb cannot be obtained.
        """
        try:
            # Step 1: Get cookie from fc.yahoo.com
            self._session.get("https://fc.yahoo.com", timeout=API_TIMEOUT_SECONDS)

            # Step 2: Get crumb using the cookie
            crumb_url = f"{YAHOO_FINANCE_BASE_URL}/v1/test/getcrumb"
            response = self._session.get(crumb_url, timeout=API_TIMEOUT_SECONDS)
            response.raise_for_status()
            self._crumb = response.text
            return self._crumb
        except requests.RequestException as e:
            raise DataFetchError("Yahoo Finance", "auth", str(e)) from e

    def get_historical_prices(self, symbol: str, years: int = 10) -> pd.DataFrame:
        """
        Fetch historical OHLCV prices for a stock.

        Uses Yahoo Finance's v8/finance/chart API endpoint.

        Args:
            symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT').
            years: Number of years of historical data to fetch.

        Returns:
            DataFrame with columns: Open, High, Low, Close, Adj Close, Volume.
            Index is a DatetimeIndex of trading dates.

        Raises:
            NoDataError: If no price data is found for the symbol.
            DataFetchError: If the API request fails.

        Example:
            >>> api = YahooFinanceAPI()
            >>> df = api.get_historical_prices("AAPL", years=5)
            >>> df.columns
            Index(['Open', 'High', 'Low', 'Close', 'Adj Close', 'Volume'], dtype='object')
        """
        end = datetime.now()
        start = end - timedelta(days=years * 365)

        url = f"{YAHOO_FINANCE_BASE_URL}/v8/finance/chart/{symbol}"
        params: dict[str, Any] = {
            "period1": int(start.timestamp()),
            "period2": int(end.timestamp()),
            "interval": "1d",
        }

        try:
            response = self._session.get(
                url, params=params, timeout=API_TIMEOUT_SECONDS
            )
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            raise DataFetchError("Yahoo Finance", symbol, str(e)) from e

        # Validate response structure
        if "chart" not in data or not data["chart"]["result"]:
            raise NoDataError(symbol, "price")

        result = data["chart"]["result"][0]

        # Check for required fields
        if "timestamp" not in result:
            raise NoDataError(symbol, "price history")

        timestamps: list[int] = result["timestamp"]
        quote: dict[str, list[float | None]] = result["indicators"]["quote"][0]
        adjclose: list[float | None] = result["indicators"]["adjclose"][0]["adjclose"]

        df = pd.DataFrame(
            {
                "Date": pd.to_datetime(timestamps, unit="s"),
                "Open": quote["open"],
                "High": quote["high"],
                "Low": quote["low"],
                "Close": quote["close"],
                "Adj Close": adjclose,
                "Volume": quote["volume"],
            }
        )
        df = df.set_index("Date")
        df.index = df.index.tz_localize(None)  # Remove timezone for consistency

        return df

    def get_earnings_data(self, symbol: str) -> dict[str, Any]:
        """
        Fetch earnings data for a stock.

        Uses Yahoo Finance's v10/finance/quoteSummary API endpoint.
        Retrieves earnings history, income statements, and key statistics.

        Args:
            symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT').

        Returns:
            Dictionary containing:
            - earningsHistory: Quarterly EPS data
            - incomeStatementHistory: Annual income statements
            - incomeStatementHistoryQuarterly: Quarterly income statements
            - defaultKeyStatistics: Current trailing/forward EPS
            - earnings: Earnings estimates and actuals

        Raises:
            NoDataError: If no earnings data is found for the symbol.
            DataFetchError: If the API request fails.

        Example:
            >>> api = YahooFinanceAPI()
            >>> earnings = api.get_earnings_data("AAPL")
            >>> "earningsHistory" in earnings
            True
        """
        if not self._crumb:
            self._get_crumb()

        url = f"{YAHOO_FINANCE_BASE_URL}/v10/finance/quoteSummary/{symbol}"
        modules = [
            "earnings",
            "earningsHistory",
            "defaultKeyStatistics",
            "incomeStatementHistory",
            "incomeStatementHistoryQuarterly",
        ]
        params: dict[str, str] = {
            "modules": ",".join(modules),
            "crumb": self._crumb or "",
        }

        try:
            response = self._session.get(
                url, params=params, timeout=API_TIMEOUT_SECONDS
            )
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            raise DataFetchError("Yahoo Finance", symbol, str(e)) from e

        # Validate response structure
        if "quoteSummary" not in data or not data["quoteSummary"]["result"]:
            raise NoDataError(symbol, "earnings")

        result: dict[str, Any] = data["quoteSummary"]["result"][0]
        return result
