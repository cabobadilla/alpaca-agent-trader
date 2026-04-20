"""
agent-c/myalpaca_client.py
--------------------------
HTTP client for the myAlpaca Node.js service (Alpaca brokerage connector).
"""

import logging

import httpx

logger = logging.getLogger(__name__)


class MyAlpacaClient:
    """Thin HTTP wrapper around the myAlpaca REST API."""

    def __init__(self, base_url: str = "http://myalpaca:3001") -> None:
        self.base_url = base_url.rstrip("/")

    def health_check(self) -> bool:
        """GET /health — returns True if the service is up."""
        try:
            response = httpx.get(f"{self.base_url}/health", timeout=10)
            return response.status_code == 200
        except httpx.RequestError as exc:
            logger.error("myAlpaca health_check failed: %s", exc)
            return False

    def get_account(self) -> dict:
        """GET /account — returns account information dict."""
        response = httpx.get(f"{self.base_url}/account", timeout=15)
        response.raise_for_status()
        return response.json()

    def get_positions(self) -> list:
        """GET /positions — returns list of open positions."""
        response = httpx.get(f"{self.base_url}/positions", timeout=15)
        response.raise_for_status()
        return response.json()

    def get_orders(self) -> list:
        """GET /orders — returns list of open/recent orders."""
        response = httpx.get(f"{self.base_url}/orders", timeout=15)
        response.raise_for_status()
        return response.json()

    def execute_trade(self, symbol: str, side: str, notional: float) -> dict:
        """
        POST /orders — submit a notional trade order.

        Args:
            symbol:   Ticker symbol, e.g. 'AAPL'
            side:     'buy' or 'sell'
            notional: Dollar amount to trade

        Returns:
            Response dict from myAlpaca.
        """
        payload = {
            "symbol": symbol,
            "side": side,
            "notional": notional,
            "type": "market",
            "time_in_force": "day",
        }
        logger.info("Submitting trade: %s %s $%.2f", side, symbol, notional)
        response = httpx.post(f"{self.base_url}/orders", json=payload, timeout=30)
        response.raise_for_status()
        result = response.json()
        logger.info("Trade submitted: %s → %s", symbol, result)
        return result
