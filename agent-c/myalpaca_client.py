"""
agent-c/myalpaca_client.py
--------------------------
HTTP client for the myAlpaca Node.js service (Alpaca brokerage connector).

TODO: Implement order submission methods:
      - submit_order(order: dict) → dict
      - get_positions() → list[dict]
      - get_account() → dict
"""

import logging

import httpx

from config import config

logger = logging.getLogger(__name__)


class MyAlpacaClient:
    """Thin async-compatible HTTP wrapper around the myAlpaca REST API."""

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or config.MYALPACA_BASE_URL).rstrip("/")

    def submit_order(self, order: dict) -> dict:
        """
        Submit a single order to the myAlpaca service.

        TODO: Implement POST /orders with full error handling and logging.

        Args:
            order: Order payload dict matching myAlpaca schema.

        Returns:
            Response dict from myAlpaca.
        """
        # TODO: implement real HTTP call
        logger.info("submit_order called (stub): %s", order)
        raise NotImplementedError("submit_order not yet implemented")

    def get_positions(self) -> list[dict]:
        """
        Retrieve current open positions.

        TODO: Implement GET /positions.
        """
        # TODO: implement real HTTP call
        raise NotImplementedError("get_positions not yet implemented")

    def get_account(self) -> dict:
        """
        Retrieve account information.

        TODO: Implement GET /account.
        """
        # TODO: implement real HTTP call
        raise NotImplementedError("get_account not yet implemented")


# Module-level singleton
myalpaca_client = MyAlpacaClient()
