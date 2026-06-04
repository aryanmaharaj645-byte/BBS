"""
AI Analyzer — sends all data to Claude for comprehensive gap signal generation.
"""
from groq import Groq
import json
from dotenv import load_dotenv
import os
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env"))
from datetime import datetime, timezone
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import FOREX_PAIRS, INDICES, COMMODITIES, ASSET_KEYWORDS


SYSTEM_PROMPT = """You are an elite institutional FX and multi-asset trader with 20+ years experience specializing in weekend gap analysis. You analyze Friday session closes to predict Monday morning gap direction and magnitude.

Your analysis must be:
- Ruthlessly data-driven: weight evidence by impact (geopolitical shock > central bank > economic data > technicals)
- Specific: name the exact news items driving each signal
- Calibrated: distinguish between gap-fills (reversion) and gap-continuations (trend extension)
- Honest about uncertainty: if signals conflict, say so and explain which dominates

Gap trading rules you apply:
1. **Weekend gaps fill ~70% of the time** — but NOT when driven by major fundamental breaks
2. **Risk-off events** (geopolitical shock, major data miss) create continuation gaps
3. **Thin weekend news** gaps tend to fill by Monday London open
4. **Trump posts** on geopolitics/tariffs = high continuation risk; Trump posts on markets = fades within hours
5. **Safe-haven flows**: Gold ↑, JPY ↑, CHF ↑ when risk-off
6. **USD correlations**: strong USD = EURUSD/GBPUSD/AUDUSD down, USDJPY up
7. **Oil**: OPEC news + Middle East = sustained moves; inventory/demand = short-term only
8. **Indices**: Tech (NAS100) more sensitive to rate/Fed news; Dow (US30) more sensitive to trade/earnings

Output format: You MUST return a valid JSON object. No markdown, no explanation outside JSON."""


def build_analysis_prompt(
    news_articles: list[dict],
    market_snapshot: dict,
    risk_sentiment: dict,
    economic_events: list[dict],
) -> str:
    all_assets = FOREX_PAIRS + INDICES + COMMODITIES
    now = datetime.now(timezone.utc).strftime("%A %Y-%m-%d %H:%M UTC")

    # Compress news to stay within Groq free tier token limits (~10k input target)
    news_text = "\n".join([
        f"[{a['age_hours']:.0f}h|{a['source']}] {a['title']}: {a['summary'][:120]}"
        for a in news_articles[:30]
    ])

    # Compact market snapshot — only key fields
    compact_market = {
        asset: {k: v for k, v in data.items() if k in
                ("friday_close", "weekly_pct", "atr14", "trend_20d", "rsi14")}
        for asset, data in market_snapshot.items()
        if isinstance(data, dict) and "error" not in data
    }
    market_text = json.dumps(compact_market)
    risk_text = json.dumps(risk_sentiment)
    events_text = json.dumps([
        {"title": e["title"], "affected": e.get("affected_currencies", []), "impact": e.get("impact", "")}
        for e in economic_events[:15]
    ])

    asset_list = ", ".join(all_assets)

    return f"""CURRENT DATE/TIME: {now}

=== MARKET SNAPSHOT (Friday Close Data) ===
{market_text}

=== MACRO RISK SENTIMENT ===
{risk_text}

=== HIGH-IMPACT ECONOMIC EVENTS (Next 7 Days) ===
{events_text}

=== NEWS FEED (Last 72 Hours — {len(news_articles)} Articles) ===
{news_text}

=== YOUR TASK ===
Analyze ALL data above and generate Monday morning gap signals for these assets:
{asset_list}

For each asset return:
- direction: "BUY" | "SELL" | "NEUTRAL"
- confidence: 0-100 integer
- gap_type: "CONTINUATION" | "FILL" | "UNCERTAIN"
- expected_gap_size: "NONE" | "SMALL(<0.2%)" | "MEDIUM(0.2-0.5%)" | "LARGE(>0.5%)"
- key_drivers: array of 2-5 specific news/data items driving the signal (be specific, name the actual event/post/data)
- risks: array of 2-3 things that could invalidate this signal
- trade_bias: one sentence describing the ideal trade setup

Also return:
- macro_theme: the dominant theme this week (1-2 sentences)
- trump_risk_level: "NONE" | "LOW" | "MEDIUM" | "HIGH" | "EXTREME" (based on any Trump posts/policy risk)
- geopolitical_risk: "LOW" | "MEDIUM" | "HIGH" | "EXTREME"
- recommended_assets: top 3 assets with clearest signals this weekend (array of asset names)
- assets_to_avoid: assets where signals conflict or uncertainty is too high

Return ONLY this JSON structure:
{{
  "generated_at": "{now}",
  "macro_theme": "...",
  "trump_risk_level": "...",
  "geopolitical_risk": "...",
  "recommended_assets": ["...", "...", "..."],
  "assets_to_avoid": ["..."],
  "signals": {{
    "EURUSD": {{
      "direction": "...",
      "confidence": 0,
      "gap_type": "...",
      "expected_gap_size": "...",
      "key_drivers": ["...", "..."],
      "risks": ["...", "..."],
      "trade_bias": "..."
    }},
    ... (all assets)
  }}
}}"""


def run_ai_analysis(
    news_articles: list[dict],
    market_snapshot: dict,
    risk_sentiment: dict,
    economic_events: list[dict],
    verbose: bool = True,
) -> dict:
    """Calls Groq API and returns structured signal JSON."""
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise ValueError("Set GROQ_API_KEY in your .env file. Get a free key at https://console.groq.com")

    client = Groq(api_key=api_key)

    prompt = build_analysis_prompt(
        news_articles, market_snapshot, risk_sentiment, economic_events
    )

    if verbose:
        print(f"\n  Sending {len(prompt):,} chars to Groq (Llama 3.3 70B) for analysis...")

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        temperature=0.2,
        max_tokens=8192,
    )
    raw = response.choices[0].message.content.strip()

    # Strip markdown fences if present
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
    raw = raw.strip()

    try:
        result = json.loads(raw)
    except json.JSONDecodeError as e:
        if verbose:
            print(f"  ⚠ JSON parse error: {e}")
            print(f"  Raw (first 500): {raw[:500]}")
        result = {"error": str(e), "raw": raw}

    return result
