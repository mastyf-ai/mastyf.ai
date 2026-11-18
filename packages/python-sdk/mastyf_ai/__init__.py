"""Mastyf for custom agents: every tool call checked before it runs, every result before the model reads it.

Runs Mastyf's free checks on your own machine. Paid protection is the Shield app (mastyf.ai).
"""

from .client import CheckClient, MastyfUnavailable
from .guard import Guard
from .verdict import Verdict

__all__ = ["CheckClient", "Guard", "MastyfUnavailable", "Verdict"]
__version__ = "5.0.1"
