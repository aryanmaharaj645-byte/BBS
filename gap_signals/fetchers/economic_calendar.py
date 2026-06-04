"""
Economic calendar fetcher — upcoming high-impact events for the coming week.
Uses ForexFactory RSS + fallback scrape.
"""
import feedparser
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
import re


FF_CAL_RSS = "https://www.forexfactory.com/calendar?format=rss"

# Known high-impact recurring events
HIGH_IMPACT_EVENTS = [
    "non-farm payroll", "nfp", "fomc", "fed rate decision", "interest rate decision",
    "cpi", "core cpi", "pce", "gdp", "unemployment rate", "retail sales",
    "ism manufacturing", "ism services", "pmi", "jobless claims",
    "consumer confidence", "durable goods", "trade balance", "current account",
    "rba", "boe", "ecb", "boj", "snb", "rbnz", "boc",
    "jackson hole", "press conference", "minutes",
    "opec", "crude oil inventories", "eia",
    "us treasury", "debt auction", "bond auction",
    "trump", "tariff", "executive order",
]

CURRENCY_COUNTRY_MAP = {
    "USD": ["united states", "us", "america", "federal reserve", "fed"],
    "EUR": ["eurozone", "euro area", "ecb", "germany", "france", "italy", "spain"],
    "GBP": ["uk", "united kingdom", "britain", "boe", "bank of england"],
    "JPY": ["japan", "boj", "bank of japan"],
    "AUD": ["australia", "rba", "reserve bank of australia"],
    "NZD": ["new zealand", "rbnz"],
    "CAD": ["canada", "boc", "bank of canada"],
    "CHF": ["switzerland", "snb", "swiss"],
}


def _is_high_impact(text: str) -> bool:
    low = text.lower()
    return any(kw in low for kw in HIGH_IMPACT_EVENTS)


def _affected_currencies(text: str) -> list[str]:
    low = text.lower()
    affected = []
    for ccy, terms in CURRENCY_COUNTRY_MAP.items():
        if any(t in low for t in terms):
            affected.append(ccy)
    return affected or ["ALL"]


def fetch_economic_calendar(verbose: bool = True) -> list[dict]:
    """
    Returns list of upcoming high-impact economic events for the next 7 days.
    """
    events = []
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(days=7)

    # ── Source 1: ForexFactory RSS ─────────────────────────────────────────
    try:
        resp = requests.get(FF_CAL_RSS, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 GapSignalBot/1.0"
        })
        parsed = feedparser.parse(resp.content)
        for entry in parsed.entries:
            title = entry.get("title", "")
            summary = entry.get("summary", "")
            combined = f"{title} {summary}"
            if not _is_high_impact(combined):
                continue
            events.append({
                "source": "ForexFactory",
                "title": title,
                "summary": summary[:400],
                "affected_currencies": _affected_currencies(combined),
                "impact": "HIGH",
                "url": entry.get("link", ""),
            })
        if verbose and events:
            print(f"  ✓ ForexFactory Calendar: {len(events)} high-impact events")
    except Exception as e:
        if verbose:
            print(f"  ⚠ ForexFactory RSS failed: {e}")

    # ── Source 2: Investing.com economic calendar RSS ───────────────────────
    try:
        url = "https://www.investing.com/economic-calendar/rss"
        resp = requests.get(url, timeout=10, headers={
            "User-Agent": "Mozilla/5.0 GapSignalBot/1.0"
        })
        parsed = feedparser.parse(resp.content)
        for entry in parsed.entries[:30]:
            title = entry.get("title", "")
            summary = entry.get("summary", "")
            combined = f"{title} {summary}"
            if not _is_high_impact(combined):
                continue
            # Skip duplicates
            if any(e["title"].lower() == title.lower() for e in events):
                continue
            events.append({
                "source": "Investing.com Calendar",
                "title": title,
                "summary": summary[:400],
                "affected_currencies": _affected_currencies(combined),
                "impact": "HIGH",
                "url": entry.get("link", ""),
            })
    except Exception:
        pass

    # ── Source 3: Hardcoded awareness of major weekly events ──────────────
    # These are permanent awareness additions for the AI to consider
    permanent_context = [
        {
            "source": "Structural",
            "title": "OPEC+ Production Policy Monitor",
            "summary": "Check for any OPEC+ emergency meetings, quota changes, or member country deviations from production targets this week.",
            "affected_currencies": ["CAD", "USD"],
            "assets_affected": ["OIL", "USDCAD"],
            "impact": "HIGH",
            "url": "",
        },
        {
            "source": "Structural",
            "title": "US Treasury Auction Schedule",
            "summary": "Monitor 2Y/5Y/10Y/30Y auction results and demand. Weak auctions spike yields and strengthen USD.",
            "affected_currencies": ["USD"],
            "assets_affected": ["US30", "NAS100", "GOLD"],
            "impact": "MEDIUM",
            "url": "",
        },
        {
            "source": "Structural",
            "title": "COT (Commitment of Traders) Positioning",
            "summary": "Latest CFTC COT report released Friday. Check net speculative positions for USD, EUR, GBP, JPY, Gold, Oil. Extreme positioning = reversal risk.",
            "affected_currencies": ["USD", "EUR", "GBP", "JPY"],
            "assets_affected": ["ALL"],
            "impact": "MEDIUM",
            "url": "https://www.cftc.gov/dea/futures/deacmesf.htm",
        },
        {
            "source": "Structural",
            "title": "China PMI / Economic Data",
            "summary": "Chinese economic data heavily affects AUD, NZD, commodity FX, and Gold. Monitor Caixin PMI and NBS PMI releases.",
            "affected_currencies": ["AUD", "NZD", "CAD"],
            "assets_affected": ["AUDUSD", "NZDUSD", "GOLD", "OIL"],
            "impact": "HIGH",
            "url": "",
        },
        {
            "source": "Structural",
            "title": "Trump Social Media Risk",
            "summary": "Trump Truth Social / X posts over the weekend can open large gaps Monday. Any posts about tariffs, Fed, dollar, trade deals, or geopolitics are market moving.",
            "affected_currencies": ["USD", "ALL"],
            "assets_affected": ["ALL"],
            "impact": "EXTREME",
            "url": "https://truthsocial.com/@realDonaldTrump",
        },
        {
            "source": "Structural",
            "title": "Geopolitical Risk Monitor — Middle East / Ukraine / Taiwan",
            "summary": "Active conflict zones. Any escalation over the weekend creates gap risk: Oil spikes, Gold spikes, JPY/CHF safe-haven bid, Risk-off.",
            "affected_currencies": ["USD", "JPY", "CHF"],
            "assets_affected": ["GOLD", "OIL", "USDJPY", "USDCHF"],
            "impact": "EXTREME",
            "url": "",
        },
        {
            "source": "Structural",
            "title": "Asian Session Sunday Open Futures",
            "summary": "CME/SGX futures open Sunday 6pm ET. The direction of NKY225, HSI, and S&P500 futures at Sunday open gives early Monday gap signal.",
            "affected_currencies": ["JPY"],
            "assets_affected": ["US30", "NAS100"],
            "impact": "HIGH",
            "url": "",
        },
    ]
    events.extend(permanent_context)

    return events
