"""
Financial Modeling Prep (FMP) API client.

This module provides an interface to the Financial Modeling Prep API
for fetching extended historical EPS data (up to 5 years on free tier).

Get a free API key at: https://site.financialmodelingprep.com/developer/docs
"""

from typing import Any

import pandas as pd
import requests

from pe_band_analyzer.constants import (
    USER_AGENT,
    FMP_BASE_URL,
    FMP_MAX_FREE_YEARS,
    API_TIMEOUT_SECONDS,
)
from pe_band_analyzer.exceptions import (
    DataFetchError,
    NoDataError,
    APIConfigurationError,
)


class FinancialModelingPrepAPI:
    """
    Financial Modeling Prep API client for historical EPS data.

    Provides access to annual EPS data with up to 5 years of history
    on the free tier. Quarterly data requires a paid subscription.

    Example:
        >>> api = FinancialModelingPrepAPI("your_api_key")
        >>> if api.test_connection():
        ...     eps_data = api.get_annual_eps_history("AAPL", limit=5)
    """

    def __init__(self, api_key: str) -> None:
        """
        Initialize the FMP API client.

        Args:
            api_key: Your Financial Modeling Prep API key.
                    Get one at: https://site.financialmodelingprep.com/developer/docs
        """
        self._api_key: str = api_key
        self._base_url: str = FMP_BASE_URL
        self._session: requests.Session = requests.Session()
        self._session.headers.update({"User-Agent": USER_AGENT})

    def get_annual_eps_history(self, symbol: str, limit: int = 5) -> pd.DataFrame:
        """
        Fetch annual EPS data for a stock.

        On the free tier, maximum 5 years of annual data is available.

        Args:
            symbol: Stock ticker symbol (e.g., 'AAPL', 'MSFT').
            limit: Number of years to fetch (max 5 on free tier).

        Returns:
            DataFrame with columns: date, eps, source.
            Sorted by date in ascending order.

        Raises:
            NoDataError: If no EPS data is found for the symbol.
            DataFetchError: If the API request fails.
            APIConfigurationError: If the API key is invalid or quota exceeded.

        Example:
            >>> api = FinancialModelingPrepAPI("your_api_key")
            >>> df = api.get_annual_eps_history("AAPL", limit=5)
            >>> df.columns
            Index(['date', 'eps', 'source'], dtype='object')
        """
        # Free tier limits to 5 years max
        limit = min(limit, FMP_MAX_FREE_YEARS)

        url = f"{self._base_url}/income-statement"
        params: dict[str, Any] = {
            "symbol": symbol,
            "period": "annual",
            "limit": limit,
            "apikey": self._api_key,
        }

        try:
            response = self._session.get(url, params=params, timeout=API_TIMEOUT_SECONDS)
            response.raise_for_status()
            data = response.json()
        except requests.RequestException as e:
            raise DataFetchError("FMP", symbol, str(e)) from e

        # Check for error responses
        if isinstance(data, str):
            if "Premium" in data or "upgrade" in data.lower():
                raise APIConfigurationError(
                    "FMP", f"Subscription required: {data[:100]}"
                )
            raise DataFetchError("FMP", symbol, data[:100])

        if isinstance(data, dict) and "error" in data:
            error_msg = data.get("error", "Unknown error")
            if "Invalid API" in str(error_msg) or "limit" in str(error_msg).lower():
                raise APIConfigurationError("FMP", str(error_msg))
            raise DataFetchError("FMP", symbol, str(error_msg))

        if not data:
            raise NoDataError(symbol, "annual EPS")

        # Parse EPS data from income statements
        eps_list: list[dict[str, Any]] = []
        for item in data:
            date_str = item.get("date")
            eps_value = item.get("epsDiluted")

            if date_str and eps_value is not None:
                eps_list.append(
                    {
                        "date": pd.to_datetime(date_str),
                        "eps": float(eps_value),
                        "source": "FMP",
                    }
                )

        if not eps_list:
            raise NoDataError(symbol, "annual EPS from FMP")

        df = pd.DataFrame(eps_list)
        df = df.sort_values("date").drop_duplicates(subset=["date"])
        return df

    def test_connection(self) -> bool:
        """
        Test if the API key is valid.

        Makes a simple request to verify the API key works.

        Returns:
            True if the API key is valid and working, False otherwise.

        Example:
            >>> api = FinancialModelingPrepAPI("your_api_key")
            >>> if api.test_connection():
            ...     print("API key is valid")
        """
        try:
            url = f"{self._base_url}/quote"
            params: dict[str, str] = {"symbol": "AAPL", "apikey": self._api_key}
            response = self._session.get(url, params=params, timeout=10)

            if response.status_code == 200:
                data = response.json()
                return isinstance(data, list) and len(data) > 0
            return False
        except Exception:
            return False
