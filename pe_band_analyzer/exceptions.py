"""
Custom exceptions for the P/E Band Analyzer.

This module defines specific exception types for different error scenarios,
making error handling more precise and informative.
"""


class PEBandAnalyzerError(Exception):
    """Base exception for all P/E Band Analyzer errors."""

    pass


class DataFetchError(PEBandAnalyzerError):
    """
    Raised when data cannot be fetched from an API.

    This includes network errors, API rate limits, authentication failures,
    and unexpected API response formats.
    """

    def __init__(self, source: str, symbol: str, message: str) -> None:
        self.source = source
        self.symbol = symbol
        self.message = message
        super().__init__(f"Failed to fetch data for {symbol} from {source}: {message}")


class NoDataError(PEBandAnalyzerError):
    """
    Raised when no data is available for the requested symbol.

    This can occur when:
    - The symbol doesn't exist
    - The symbol has no price history
    - The symbol has no earnings data
    """

    def __init__(self, symbol: str, data_type: str) -> None:
        self.symbol = symbol
        self.data_type = data_type
        super().__init__(f"No {data_type} data found for {symbol}")


class InvalidSymbolError(PEBandAnalyzerError):
    """
    Raised when the provided stock symbol is invalid.

    This can occur when:
    - The symbol format is incorrect
    - The symbol is not recognized by any data source
    """

    def __init__(self, symbol: str, reason: str | None = None) -> None:
        self.symbol = symbol
        self.reason = reason
        message = f"Invalid symbol: {symbol}"
        if reason:
            message += f" ({reason})"
        super().__init__(message)


class InsufficientDataError(PEBandAnalyzerError):
    """
    Raised when there is insufficient data for analysis.

    This can occur when:
    - Not enough quarterly EPS data points
    - Price history is too short
    - TTM EPS cannot be calculated
    """

    def __init__(self, symbol: str, required: str, available: str) -> None:
        self.symbol = symbol
        self.required = required
        self.available = available
        super().__init__(
            f"Insufficient data for {symbol}: required {required}, got {available}"
        )


class APIConfigurationError(PEBandAnalyzerError):
    """
    Raised when API configuration is invalid or missing.

    This can occur when:
    - API key is missing or invalid
    - API endpoint is unreachable
    - API subscription tier doesn't support the requested feature
    """

    def __init__(self, api_name: str, message: str) -> None:
        self.api_name = api_name
        self.message = message
        super().__init__(f"{api_name} configuration error: {message}")
