"""Mastyf for custom agents: every tool call checked before it runs, every result before the model reads it."""

from .client import CheckClient, MastyfUnavailable
from .verdict import Verdict

__all__ = ["CheckClient", "MastyfUnavailable", "Verdict"]
__version__ = "5.0.0"
