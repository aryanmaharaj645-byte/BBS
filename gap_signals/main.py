#!/usr/bin/env python3
"""
Weekend Gap Signal Generator
─────────────────────────────
Runs every Friday after market close. Analyzes:
  • Trump / political posts (Truth Social, White House)
  • Geopolitical news (Reuters, BBC, Al Jazeera, Politico)
  • Economic data & calendar (ForexFactory, Investing.com)
  • Central bank commentary (Fed, ECB, BOE, BOJ, RBA, etc.)
  • Market technicals (Friday close, ATR, RSI, trend)
  • Macro risk sentiment (VIX, DXY, yields, Gold, JPY)
  • OPEC / energy news
  • COT positioning awareness
  • Crypto correlation signals

Assets: All major Forex pairs + US30 + NAS100 + Gold + Oil

Usage:
  python main.py                    # full run
  python main.py --no-market-data   # skip yfinance (faster, offline test)
  python main.py --save             # save JSON report to reports/
  python main.py --quick            # top 5 news only, quick test
"""

import argparse
import json
import os
import sys
from datetime import datetime, timezone

from colorama import Fore, Style, init
init(autoreset=True)

# ── Ensure project root is on path ────────────────────────────────────────
ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)


def header(text: str) -> None:
    print(f"\n{Fore.CYAN}{Style.BRIGHT}{'─'*60}")
    print(f"  {text}")
    print(f"{'─'*60}{Style.RESET_ALL}")


def main():
    parser = argparse.ArgumentParser(description="Weekend Gap Signal Generator")
    parser.add_argument("--no-market-data", action="store_true", help="Skip yfinance market data")
    parser.add_argument("--save", action="store_true", help="Save JSON report to reports/")
    parser.add_argument("--quick", action="store_true", help="Quick test — minimal news fetch")
    parser.add_argument("--load", type=str, help="Load existing JSON and re-render report (skip fetching)")
    args = parser.parse_args()

    now = datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d_%H%M")

    print(f"\n{Fore.CYAN}{Style.BRIGHT}{'═'*60}")
    print(f"  WEEKEND GAP SIGNAL GENERATOR")
    print(f"  {now.strftime('%A %Y-%m-%d %H:%M UTC')}")
    print(f"{'═'*60}{Style.RESET_ALL}")

    # ── Load mode (re-render saved JSON) ──────────────────────────────────
    if args.load:
        with open(args.load) as f:
            signals = json.load(f)
        from output.report import render_terminal
        render_terminal(signals)
        return

    # ── Step 1: Fetch news ─────────────────────────────────────────────────
    header("STEP 1/4 — Fetching News & Intelligence Feeds")
    from fetchers.news_fetcher import fetch_all_news

    if args.quick:
        # Override limits for quick test
        import fetchers.news_fetcher as nf
        nf.MAX_ARTICLES_PER_FEED = 2
        nf.MAX_TOTAL_ARTICLES = 20

    news = fetch_all_news(verbose=True)
    print(f"\n  Total relevant articles collected: {Fore.GREEN}{len(news)}{Style.RESET_ALL}")

    # ── Step 2: Fetch market data ──────────────────────────────────────────
    header("STEP 2/4 — Fetching Market Data (Friday Closes)")
    market_snapshot = {}
    risk_sentiment = {}

    if not args.no_market_data:
        from fetchers.market_data import fetch_market_snapshot, fetch_risk_sentiment
        print("  Fetching price data via yfinance...")
        market_snapshot = fetch_market_snapshot()
        ok = sum(1 for v in market_snapshot.values() if "error" not in v)
        print(f"  ✓ Market snapshot: {ok}/{len(market_snapshot)} assets loaded")

        print("  Fetching risk sentiment (VIX, DXY, yields)...")
        risk_sentiment = fetch_risk_sentiment()
        sentiment_label = risk_sentiment.get("overall_sentiment", "N/A")
        color = {"RISK_ON": Fore.GREEN, "RISK_OFF": Fore.RED, "EXTREME_FEAR": Fore.RED + Style.BRIGHT,
                 "EXTREME_GREED": Fore.GREEN + Style.BRIGHT}.get(sentiment_label, Fore.YELLOW)
        print(f"  ✓ Risk Sentiment: {color}{sentiment_label}{Style.RESET_ALL}")
    else:
        print(f"  {Fore.YELLOW}Skipped (--no-market-data){Style.RESET_ALL}")

    # ── Step 3: Economic calendar ──────────────────────────────────────────
    header("STEP 3/4 — Fetching Economic Calendar")
    from fetchers.economic_calendar import fetch_economic_calendar
    events = fetch_economic_calendar(verbose=True)
    print(f"  Total high-impact events: {Fore.GREEN}{len(events)}{Style.RESET_ALL}")

    # ── Step 4: AI Analysis ────────────────────────────────────────────────
    header("STEP 4/4 — Running Claude AI Gap Analysis")
    from analyzer.ai_analyzer import run_ai_analysis
    signals = run_ai_analysis(
        news_articles=news,
        market_snapshot=market_snapshot,
        risk_sentiment=risk_sentiment,
        economic_events=events,
        verbose=True,
    )
    print(f"  ✓ Analysis complete")

    # ── Render Report ──────────────────────────────────────────────────────
    from output.report import render_terminal, save_json
    save_path = None
    if args.save:
        os.makedirs(os.path.join(ROOT, "reports"), exist_ok=True)
        save_path = os.path.join(ROOT, "reports", f"gap_signals_{timestamp}.json")

    render_terminal(signals, save_path=save_path)

    if save_path:
        save_json(signals, save_path)

    # Embed top articles into signals JSON for dashboard news feed
    signals["news_articles"] = [
        {"source": a["source"], "title": a["title"],
         "summary": a["summary"][:300], "url": a["url"], "age_hours": a["age_hours"]}
        for a in news[:60]
    ]

    # Always update the dashboard data so Netlify deploy picks it up
    dashboard_data = os.path.join(ROOT, "dashboard", "data", "latest.json")
    save_json(signals, dashboard_data)
    print(f"  Dashboard updated: dashboard/data/latest.json")


if __name__ == "__main__":
    main()
