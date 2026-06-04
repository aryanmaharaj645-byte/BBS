"""
News fetcher — pulls from all RSS feeds, filters by relevance and recency.
"""
import feedparser
import requests
import time
from datetime import datetime, timezone, timedelta
from bs4 import BeautifulSoup
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import NEWS_FEEDS, HIGH_IMPACT_KEYWORDS, MAX_ARTICLES_PER_FEED, MAX_TOTAL_ARTICLES, NEWS_LOOKBACK_HOURS


def _strip_html(text: str) -> str:
    try:
        return BeautifulSoup(text, "lxml").get_text(separator=" ").strip()
    except Exception:
        return text


def _parse_date(entry) -> datetime:
    """Best-effort parse of feed entry date → UTC datetime."""
    for attr in ("published_parsed", "updated_parsed", "created_parsed"):
        t = getattr(entry, attr, None)
        if t:
            try:
                return datetime(*t[:6], tzinfo=timezone.utc)
            except Exception:
                pass
    return datetime.now(timezone.utc)


def _is_relevant(text: str) -> bool:
    low = text.lower()
    return any(kw in low for kw in HIGH_IMPACT_KEYWORDS)


def fetch_all_news(verbose: bool = True) -> list[dict]:
    """
    Returns a list of article dicts:
      {source, title, summary, url, published_utc, age_hours}
    Sorted newest-first, capped at MAX_TOTAL_ARTICLES.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(hours=NEWS_LOOKBACK_HOURS)
    articles = []
    failed = []

    for feed_cfg in NEWS_FEEDS:
        source = feed_cfg["name"]
        url = feed_cfg["url"]
        try:
            # feedparser is tolerant but set a timeout via requests first
            resp = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0 GapSignalBot/1.0"
            })
            raw = resp.content
            parsed = feedparser.parse(raw)
        except Exception as e:
            failed.append(f"{source}: {e}")
            continue

        count = 0
        for entry in parsed.entries:
            if count >= MAX_ARTICLES_PER_FEED:
                break
            pub = _parse_date(entry)
            if pub < cutoff:
                continue

            title = entry.get("title", "")
            summary = _strip_html(entry.get("summary", entry.get("description", "")))
            combined = f"{title} {summary}"

            if not _is_relevant(combined):
                continue

            age_hours = (datetime.now(timezone.utc) - pub).total_seconds() / 3600
            articles.append({
                "source": source,
                "title": title,
                "summary": summary[:800],
                "url": entry.get("link", ""),
                "published_utc": pub.isoformat(),
                "age_hours": round(age_hours, 1),
            })
            count += 1

        if verbose and count:
            print(f"  ✓ {source}: {count} relevant articles")

    if failed and verbose:
        print(f"\n  ⚠ Failed feeds ({len(failed)}): {', '.join(f.split(':')[0] for f in failed)}")

    # Sort newest-first, cap total
    articles.sort(key=lambda x: x["age_hours"])
    return articles[:MAX_TOTAL_ARTICLES]
