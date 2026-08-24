"""
Live data feeds.

Two external sources sit behind this package:

    Feed A  Barcelona traffic control data  -- real congestion / signal state
    Feed B  Vehicle data                    -- real vehicle positions or counts

Both are OPTIONAL and both are inert until configured. Nothing in the
simulation depends on them being present, and nothing pretends they are
present when they are not: an unconfigured feed reports `not_configured` and
the UI keeps labelling that data synthetic. See feeds/live.py for why that
matters more than it might seem.
"""

from .live import (
    FEEDS,
    FeedConfig,
    FeedResult,
    feed_status,
    fetch,
)

__all__ = ["FEEDS", "FeedConfig", "FeedResult", "feed_status", "fetch"]
