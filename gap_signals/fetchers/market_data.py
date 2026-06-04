"""
Market data fetcher — Friday close prices, weekly range, ATR, trend context.
"""
import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta, timezone
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from config import YFINANCE_MAP, FOREX_PAIRS, INDICES, COMMODITIES


def _get_ticker_data(ticker_sym: str, period: str = "60d") -> pd.DataFrame | None:
    try:
        t = yf.Ticker(ticker_sym)
        df = t.history(period=period, interval="1d", auto_adjust=True)
        if df.empty:
            return None
        return df
    except Exception:
        return None


def _atr(df: pd.DataFrame, n: int = 14) -> float:
    high = df["High"]
    low = df["Low"]
    close = df["Close"]
    tr = pd.concat([
        high - low,
        (high - close.shift()).abs(),
        (low - close.shift()).abs(),
    ], axis=1).max(axis=1)
    return round(float(tr.rolling(n).mean().iloc[-1]), 5)


def fetch_market_snapshot() -> dict:
    """
    Returns dict keyed by asset name with:
      friday_close, prev_close, weekly_high, weekly_low,
      atr14, trend_20d (bullish/bearish/neutral), rsi14, pct_change_week
    """
    all_assets = FOREX_PAIRS + INDICES + COMMODITIES
    snapshot = {}

    for asset in all_assets:
        sym = YFINANCE_MAP.get(asset)
        if not sym:
            continue
        df = _get_ticker_data(sym, period="60d")
        if df is None or len(df) < 20:
            snapshot[asset] = {"error": "no data"}
            continue

        # Friday close = most recent session close (last row)
        friday_close = round(float(df["Close"].iloc[-1]), 5)
        prev_close   = round(float(df["Close"].iloc[-2]), 5)

        # Last 5 trading days (week)
        week = df.tail(5)
        weekly_high = round(float(week["High"].max()), 5)
        weekly_low  = round(float(week["Low"].min()), 5)
        pct_change_week = round((friday_close - float(week["Close"].iloc[0])) / float(week["Close"].iloc[0]) * 100, 3)

        # 20-day trend
        ma20 = float(df["Close"].rolling(20).mean().iloc[-1])
        if friday_close > ma20 * 1.002:
            trend = "BULLISH"
        elif friday_close < ma20 * 0.998:
            trend = "BEARISH"
        else:
            trend = "NEUTRAL"

        # RSI-14
        delta = df["Close"].diff()
        gain = delta.clip(lower=0).rolling(14).mean()
        loss = (-delta.clip(upper=0)).rolling(14).mean()
        rs = gain / loss.replace(0, float("nan"))
        rsi = round(float(100 - 100 / (1 + rs.iloc[-1])), 1)

        # Day-over-day gap size (Friday vs Thursday close)
        gap_pct = round((friday_close - prev_close) / prev_close * 100, 3)

        # Volume context (only meaningful for indices/commodities)
        vol_ratio = None
        if "Volume" in df.columns:
            avg_vol = float(df["Volume"].tail(20).mean())
            last_vol = float(df["Volume"].iloc[-1])
            if avg_vol > 0:
                vol_ratio = round(last_vol / avg_vol, 2)

        snapshot[asset] = {
            "friday_close":     friday_close,
            "prev_close":       prev_close,
            "weekly_high":      weekly_high,
            "weekly_low":       weekly_low,
            "weekly_pct":       pct_change_week,
            "atr14":            _atr(df),
            "trend_20d":        trend,
            "rsi14":            rsi,
            "friday_gap_pct":   gap_pct,
            "vol_ratio":        vol_ratio,
        }

    return snapshot


def fetch_risk_sentiment() -> dict:
    """
    Derives macro risk-on / risk-off context from:
    VIX, DXY, 10Y yield, Gold, JPY.
    """
    tickers = {
        "VIX":  "^VIX",
        "DXY":  "DX-Y.NYB",
        "US10Y": "^TNX",   # 10yr yield (x10 = %)
        "GOLD": "GC=F",
        "JPY":  "JPY=X",
    }
    risk = {}
    for name, sym in tickers.items():
        df = _get_ticker_data(sym, period="10d")
        if df is None or df.empty:
            risk[name] = None
            continue
        last = round(float(df["Close"].iloc[-1]), 4)
        prev = round(float(df["Close"].iloc[-2]), 4)
        risk[name] = {
            "value": last,
            "change_pct": round((last - prev) / prev * 100, 3),
        }

    # Derive overall sentiment label
    vix = risk.get("VIX", {})
    vix_val = vix.get("value", 20) if vix else 20
    if vix_val > 30:
        sentiment = "EXTREME_FEAR"
    elif vix_val > 22:
        sentiment = "RISK_OFF"
    elif vix_val < 14:
        sentiment = "EXTREME_GREED"
    elif vix_val < 18:
        sentiment = "RISK_ON"
    else:
        sentiment = "NEUTRAL"

    risk["overall_sentiment"] = sentiment
    return risk
