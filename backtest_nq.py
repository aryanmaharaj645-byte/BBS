#!/usr/bin/env python3
"""
=============================================================================
  US100 ORB  –  Dual-Timeframe Comparative Backtest  (V3)

  Opening range : single 9:30am EST 15-min candle  (M15 file)
  Entry / exit  : 1-min bars after 9:45am          (M1  file)

  STRATEGY A  –  1:1 RR, no breakeven
  STRATEGY B  –  1:2 RR + breakeven at 1R

  Filters applied (in order)
    1. Skip Mondays
    2. Skip days adjacent to US public holidays
    3. Skip if 9:30am M15 candle is missing
    4. Skip if range size outside 10–80 pts
    5. Skip if no previous-day M15 trend data
    6. Take only trades that match previous-day trend direction
       (Long only if prior day bullish; Short only if prior day bearish)

  Risk  : 1.5 % of current balance  |  pos_size = (bal × 0.015) / range_size
  Spread: 1.5 pts per trade
  Capital: $10,000 starting
=============================================================================
"""

import warnings
warnings.filterwarnings("ignore")

import sys
import os
from datetime import date, timedelta

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec


# ─────────────────────────────────────────────────────────────────────────────
#  CONFIGURATION
# ─────────────────────────────────────────────────────────────────────────────
BASE = ("/Users/Aryan/Library/Application Support/"
        "net.metaquotes.wine.metatrader5/drive_c/"
        "Program Files/MetaTrader 5/MQL5/Files/")

M15_PATH = BASE + "US100_M15.csv"
M1_PATH  = BASE + "US100_M1.csv"

BROKER_UTC_OFFSET = 2       # UTC+2 confirmed for this broker

START_CAP   = 10_000.0
RISK_PCT    = 0.015
SPREAD_PTS  = 1.5

MIN_RANGE   = 10            # pts – skip narrower OR
MAX_RANGE   = 80            # pts – skip wider OR

FORCE_CLOSE_H = 13          # 1 pm EST

A_RR = 1.0                  # Strategy A: 1:1
B_RR = 2.0                  # Strategy B: 1:2
B_BE = 1.0                  # Strategy B: breakeven trigger at 1R

CREDENTIALS_PATH = os.path.expanduser("~/Desktop/credentials.json")
SHEET_NAME       = "US100 ORB Backtest V3"


# ─────────────────────────────────────────────────────────────────────────────
#  HOLIDAY CALENDAR
# ─────────────────────────────────────────────────────────────────────────────
def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """Return the nth occurrence (1-based) of weekday (Mon=0) in month/year."""
    d, count = date(year, month, 1), 0
    while True:
        if d.weekday() == weekday:
            count += 1
            if count == n:
                return d
        d += timedelta(days=1)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    """Return the last occurrence of weekday in month/year."""
    if month == 12:
        d = date(year, 12, 31)
    else:
        d = date(year, month + 1, 1) - timedelta(days=1)
    while d.weekday() != weekday:
        d -= timedelta(days=1)
    return d


def _observe(d: date) -> date:
    """Saturday holiday → Friday obs.  Sunday holiday → Monday obs."""
    if d.weekday() == 5:
        return d - timedelta(days=1)
    if d.weekday() == 6:
        return d + timedelta(days=1)
    return d


def us_market_holidays(years) -> set:
    """Return observed US equity market holiday dates for each year."""
    h = set()
    for y in years:
        h.add(_observe(date(y, 1, 1)))           # New Year's Day
        h.add(_nth_weekday(y, 1, 0, 3))          # MLK Day  (3rd Mon Jan)
        h.add(_nth_weekday(y, 2, 0, 3))          # Presidents Day (3rd Mon Feb)
        h.add(_last_weekday(y, 5, 0))            # Memorial Day (last Mon May)
        h.add(_observe(date(y, 6, 19)))          # Juneteenth
        h.add(_observe(date(y, 7, 4)))           # Independence Day
        h.add(_nth_weekday(y, 9, 0, 1))          # Labor Day (1st Mon Sep)
        h.add(_nth_weekday(y, 11, 3, 4))         # Thanksgiving (4th Thu Nov)
        h.add(_observe(date(y, 12, 25)))         # Christmas
    return h


def adjacent_holiday_dates(holidays: set, trading_days) -> set:
    """Return the trading days immediately before AND after each holiday."""
    trd = sorted(trading_days)
    adj = set()
    for h in holidays:
        before = [d for d in trd if d < h]
        after  = [d for d in trd if d > h]
        if before:
            adj.add(before[-1])
        if after:
            adj.add(after[0])
    return adj


# ─────────────────────────────────────────────────────────────────────────────
#  DATA LOADING
# ─────────────────────────────────────────────────────────────────────────────
def _load(path: str, label: str) -> pd.DataFrame:
    if not os.path.exists(path):
        sys.exit(f"ERROR: File not found:\n  {path}")
    df = pd.read_csv(path)
    df["Time"] = pd.to_datetime(df["Time"], format="%Y.%m.%d %H:%M")
    df = df.set_index("Time").sort_index()
    tz = f"Etc/GMT-{BROKER_UTC_OFFSET}"
    df.index = df.index.tz_localize(
        tz, ambiguous="infer", nonexistent="shift_forward")
    df.index = df.index.tz_convert("America/New_York")
    df = df[["Open", "High", "Low", "Close", "Volume"]].copy()
    df = df[~df.index.duplicated(keep="first")]
    df.dropna(subset=["Close"], inplace=True)
    df = df[df.index.dayofweek < 5]
    print(f"  {label:<10} {len(df):>8,} bars  │  "
          f"{df.index[0].date()}  →  {df.index[-1].date()}")
    return df


def load_data():
    print("=" * 65)
    print("  Loading MT5 data files")
    print("=" * 65)
    m15 = _load(M15_PATH, "M15")
    m1  = _load(M1_PATH,  "M1")
    return m15, m1


# ─────────────────────────────────────────────────────────────────────────────
#  PREVIOUS-DAY TREND  (derived from M15 regular-session bars)
# ─────────────────────────────────────────────────────────────────────────────
def build_daily_trend(m15: pd.DataFrame) -> dict:
    """
    For each trading date in M15, compute daily open (first bar ≥ 9:30am)
    and daily close (last bar ≤ 3:55pm).
    Returns {date: 'bull' | 'bear'}.
    """
    sess = m15[(m15.index.hour >= 9) & (m15.index.hour < 16)].copy()
    trend = {}
    for d, grp in sess.groupby(sess.index.date):
        if len(grp) == 0:
            continue
        d_open  = float(grp.iloc[0]["Open"])
        d_close = float(grp.iloc[-1]["Close"])
        trend[d] = "bull" if d_close >= d_open else "bear"
    return trend


# ─────────────────────────────────────────────────────────────────────────────
#  BACKTEST ENGINE
# ─────────────────────────────────────────────────────────────────────────────
def run_backtest(m15: pd.DataFrame, m1: pd.DataFrame):
    """
    Day-by-day loop.  Each day runs both Strategy A and B in parallel on
    the same entry signal so the comparison is perfectly controlled.

    Returns
    -------
    trades_A, trades_B : list[dict]
    eq_A, eq_B         : list[(timestamp, balance)]
    filter_counts      : dict
    """
    daily_trend = build_daily_trend(m15)

    # All weekdays in M15 date range
    all_dates = sorted({d for d in m15.index.date})
    years     = list({d.year for d in all_dates})
    holidays  = us_market_holidays(years)
    adj_hols  = adjacent_holiday_dates(holidays, set(all_dates))

    fc = {
        "total_weekdays":    len(all_dates),
        "monday":            0,
        "holiday_adjacent":  0,
        "no_or_candle":      0,
        "range_size":        0,
        "no_prev_trend":     0,
        "trend_no_signal":   0,   # signal existed but in wrong direction
        "no_breakout":       0,   # no breakout at all in entry window
        "traded":            0,
    }

    bal_A, bal_B = START_CAP, START_CAP
    trades_A, trades_B = [], []
    t0 = m15.index[0]
    eq_A = [(t0, START_CAP)]
    eq_B = [(t0, START_CAP)]

    for d in all_dates:

        # ── Filter 1: Monday ─────────────────────────────────────────────────
        if d.weekday() == 0:
            fc["monday"] += 1
            continue

        # ── Filter 2: Adjacent to US holiday ─────────────────────────────────
        if d in adj_hols:
            fc["holiday_adjacent"] += 1
            continue

        # ── Filter 3: 9:30am M15 OR candle ───────────────────────────────────
        or_rows = m15[(m15.index.date == d) &
                      (m15.index.hour  == 9) &
                      (m15.index.minute == 30)]
        if or_rows.empty:
            fc["no_or_candle"] += 1
            continue

        or_bar     = or_rows.iloc[0]
        rng_hi     = float(or_bar["High"])
        rng_lo     = float(or_bar["Low"])
        rng_sz     = round(rng_hi - rng_lo, 2)

        # ── Filter 4: Range size ─────────────────────────────────────────────
        if rng_sz < MIN_RANGE or rng_sz > MAX_RANGE:
            fc["range_size"] += 1
            continue

        # ── Filter 5: Previous-day trend ─────────────────────────────────────
        prev_days = [pd2 for pd2 in all_dates if pd2 < d]
        prev_day  = prev_days[-1] if prev_days else None

        if prev_day is None or prev_day not in daily_trend:
            fc["no_prev_trend"] += 1
            continue

        allowed_dir = "long" if daily_trend[prev_day] == "bull" else "short"

        # ── M1 entry window: 9:45am – 12:59pm ────────────────────────────────
        m1_window = m1[
            (m1.index.date == d) &
            (
                (m1.index.hour > 9) |
                ((m1.index.hour == 9) & (m1.index.minute >= 45))
            ) &
            (m1.index.hour < FORCE_CLOSE_H)
        ]

        if m1_window.empty:
            fc["no_breakout"] += 1
            continue

        # ── Find first breakout (either direction) ────────────────────────────
        first_dir  = None
        first_ts   = None
        first_px   = None

        for _, bar in m1_window.iterrows():
            cl = float(bar["Close"])
            if cl > rng_hi:
                first_dir, first_ts, first_px = "long",  bar.name, cl; break
            if cl < rng_lo:
                first_dir, first_ts, first_px = "short", bar.name, cl; break

        if first_dir is None:
            fc["no_breakout"] += 1
            continue

        # ── Filter 6: Trend direction match ──────────────────────────────────
        if first_dir != allowed_dir:
            fc["trend_no_signal"] += 1
            continue

        fc["traded"] += 1
        direction = first_dir
        entry_ts  = first_ts
        entry_px  = first_px

        # ── SL / TP levels ────────────────────────────────────────────────────
        sl_px   = rng_lo  if direction == "long" else rng_hi

        tp_A_px = (entry_px + rng_sz * A_RR) if direction == "long" \
                  else (entry_px - rng_sz * A_RR)
        tp_B_px = (entry_px + rng_sz * B_RR) if direction == "long" \
                  else (entry_px - rng_sz * B_RR)

        ps_A = (bal_A * RISK_PCT) / rng_sz
        ps_B = (bal_B * RISK_PCT) / rng_sz

        # ── M1 bars after entry, same day ────────────────────────────────────
        post = m1[(m1.index.date == d) &
                  (m1.index > entry_ts) &
                  (m1.index.hour < FORCE_CLOSE_H)]

        # ── Simulate Strategy A ───────────────────────────────────────────────
        xpx_A = xts_A = xrsn_A = None
        for _, bar in post.iterrows():
            hi, lo = float(bar["High"]), float(bar["Low"])
            if direction == "long":
                if lo <= sl_px:
                    xpx_A, xts_A, xrsn_A = sl_px,   bar.name, "STOP";   break
                if hi >= tp_A_px:
                    xpx_A, xts_A, xrsn_A = tp_A_px, bar.name, "TARGET"; break
            else:
                if hi >= sl_px:
                    xpx_A, xts_A, xrsn_A = sl_px,   bar.name, "STOP";   break
                if lo <= tp_A_px:
                    xpx_A, xts_A, xrsn_A = tp_A_px, bar.name, "TARGET"; break

        if xpx_A is None:
            lb = post.iloc[-1] if not post.empty else m1_window.iloc[-1]
            xpx_A, xts_A, xrsn_A = float(lb["Close"]), lb.name, "FORCE_CLOSE"

        # ── Simulate Strategy B ───────────────────────────────────────────────
        xpx_B = xts_B = xrsn_B = None
        be_hit = False
        sl_B   = sl_px   # may move to entry after 1R

        for _, bar in post.iterrows():
            hi, lo = float(bar["High"]), float(bar["Low"])
            if direction == "long":
                if not be_hit and hi >= entry_px + rng_sz * B_BE:
                    be_hit = True
                    sl_B   = entry_px
                if lo <= sl_B:
                    xpx_B  = sl_B
                    xts_B  = bar.name
                    xrsn_B = "BREAKEVEN" if be_hit else "STOP"
                    break
                if hi >= tp_B_px:
                    xpx_B, xts_B, xrsn_B = tp_B_px, bar.name, "TARGET"; break
            else:
                if not be_hit and lo <= entry_px - rng_sz * B_BE:
                    be_hit = True
                    sl_B   = entry_px
                if hi >= sl_B:
                    xpx_B  = sl_B
                    xts_B  = bar.name
                    xrsn_B = "BREAKEVEN" if be_hit else "STOP"
                    break
                if lo <= tp_B_px:
                    xpx_B, xts_B, xrsn_B = tp_B_px, bar.name, "TARGET"; break

        if xpx_B is None:
            lb = post.iloc[-1] if not post.empty else m1_window.iloc[-1]
            xpx_B, xts_B, xrsn_B = float(lb["Close"]), lb.name, "FORCE_CLOSE"

        # ── P&L ──────────────────────────────────────────────────────────────
        def pnl(ep, xp, ps):
            raw = (xp - ep) if direction == "long" else (ep - xp)
            return round(raw * ps - SPREAD_PTS * ps, 2)

        pnl_A = pnl(entry_px, xpx_A, ps_A)
        pnl_B = pnl(entry_px, xpx_B, ps_B)
        bal_A = round(bal_A + pnl_A, 2)
        bal_B = round(bal_B + pnl_B, 2)

        def result(rsn):
            return {"TARGET": "WIN", "STOP": "LOSS",
                    "BREAKEVEN": "BREAKEVEN",
                    "FORCE_CLOSE": "FORCED_CLOSE"}.get(rsn, rsn)

        def dur(t1, t2):
            try:
                return round((t2 - t1).total_seconds() / 60, 1)
            except Exception:
                return None

        common = dict(
            date        = str(d),
            direction   = direction,
            range_high  = round(rng_hi, 2),
            range_low   = round(rng_lo, 2),
            range_size  = round(rng_sz, 2),
            entry_time  = str(entry_ts),
            entry_price = round(entry_px, 2),
        )

        trades_A.append({**common,
            "sl":          round(sl_px, 2),
            "tp":          round(tp_A_px, 2),
            "exit_time":   str(xts_A),
            "exit_price":  round(xpx_A, 2),
            "exit_reason": xrsn_A,
            "pnl":         pnl_A,
            "balance":     bal_A,
            "duration_min": dur(entry_ts, xts_A),
            "_result":     result(xrsn_A),
            "_entry_ts":   entry_ts,
        })
        trades_B.append({**common,
            "sl":          round(sl_px, 2),
            "tp":          round(tp_B_px, 2),
            "exit_time":   str(xts_B),
            "exit_price":  round(xpx_B, 2),
            "exit_reason": xrsn_B,
            "pnl":         pnl_B,
            "balance":     bal_B,
            "duration_min": dur(entry_ts, xts_B),
            "_result":     result(xrsn_B),
            "_entry_ts":   entry_ts,
        })

        eq_A.append((xts_A, bal_A))
        eq_B.append((xts_B, bal_B))

    return trades_A, trades_B, eq_A, eq_B, fc


# ─────────────────────────────────────────────────────────────────────────────
#  METRICS
# ─────────────────────────────────────────────────────────────────────────────
def calc_metrics(trades: list, equity: list) -> dict:
    if not trades:
        return None

    df_t    = pd.DataFrame(trades)
    # Build equity curve: starts at START_CAP, then each trade-close balance
    eq_vals = np.array([START_CAP] + [e[1] for e in equity[1:]], dtype=float)
    final   = eq_vals[-1]

    wins   = df_t[df_t["_result"] == "WIN"]
    losses = df_t[df_t["_result"] == "LOSS"]
    bes    = df_t[df_t["_result"] == "BREAKEVEN"]
    forced = df_t[df_t["_result"] == "FORCED_CLOSE"]

    n        = len(df_t)
    win_rate = len(wins) / n * 100 if n else 0
    gp       = wins["pnl"].sum()        if len(wins)   else 0.0
    gl       = abs(losses["pnl"].sum()) if len(losses) else 1.0
    pf       = gp / gl                  if gl > 0      else float("inf")

    run_max  = np.maximum.accumulate(eq_vals)
    dd_pct   = (eq_vals - run_max) / run_max * 100
    max_dd   = dd_pct.min()

    ret_pt   = df_t["pnl"] / START_CAP
    sharpe   = ret_pt.mean() / ret_pt.std() * np.sqrt(252) \
               if ret_pt.std() > 0 else 0.0

    avg_dur  = df_t["duration_min"].mean()
    avg_rng  = df_t["range_size"].mean()

    df_t["_month"] = pd.to_datetime(df_t["_entry_ts"]).dt.to_period("M")
    monthly = (df_t.groupby("_month")["pnl"]
               .agg(trades="count", net_pnl="sum",
                    wins=lambda x: (x > 0).sum()))
    monthly["win_pct"] = monthly["wins"] / monthly["trades"] * 100

    best_m  = monthly["net_pnl"].idxmax()
    worst_m = monthly["net_pnl"].idxmin()

    return dict(
        df_t=df_t, eq_vals=eq_vals, dd_pct=dd_pct, monthly=monthly,
        final=final, n=n,
        wins=len(wins), losses=len(losses), bes=len(bes), forced=len(forced),
        win_rate=win_rate, pf=pf, max_dd=max_dd, sharpe=sharpe,
        avg_dur=avg_dur, avg_range=avg_rng,
        total_return=(final - START_CAP) / START_CAP * 100,
        best_month=best_m, worst_month=worst_m,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  TERMINAL OUTPUT
# ─────────────────────────────────────────────────────────────────────────────
def print_results(mA: dict, mB: dict, fc: dict):
    W  = 24
    eq = "═"
    dh = "─"
    BK = eq * 74

    def dur_s(m):
        d = m["avg_dur"]
        if d is None:
            return "N/A"
        h, mn = divmod(int(d), 60)
        return f"{h}h {mn:02d}m" if h else f"{d:.1f} min"

    rows = [
        ("Starting Capital",    f"${START_CAP:>12,.2f}",    f"${START_CAP:>12,.2f}"),
        ("Final Balance",       f"${mA['final']:>12,.2f}",  f"${mB['final']:>12,.2f}"),
        ("Total Return",        f"{mA['total_return']:>12.2f}%", f"{mB['total_return']:>12.2f}%"),
        ("Total Trades",        f"{mA['n']:>13,}",          f"{mB['n']:>13,}"),
        ("  Wins",              f"{mA['wins']:>13,}",        f"{mB['wins']:>13,}"),
        ("  Losses",            f"{mA['losses']:>13,}",      f"{mB['losses']:>13,}"),
        ("  Breakevens",        f"{mA['bes']:>13,}",         f"{mB['bes']:>13,}"),
        ("  Forced Closes",     f"{mA['forced']:>13,}",      f"{mB['forced']:>13,}"),
        ("Win Rate",            f"{mA['win_rate']:>12.1f}%", f"{mB['win_rate']:>12.1f}%"),
        ("Profit Factor",       f"{mA['pf']:>13.2f}",        f"{mB['pf']:>13.2f}"),
        ("Max Drawdown",        f"{mA['max_dd']:>12.2f}%",   f"{mB['max_dd']:>12.2f}%"),
        ("Sharpe Ratio (ann.)", f"{mA['sharpe']:>13.2f}",    f"{mB['sharpe']:>13.2f}"),
        ("Avg Trade Duration",  f"{dur_s(mA):>13}",          f"{dur_s(mB):>13}"),
        ("Avg Range Size",      f"{mA['avg_range']:>10.1f} pts", f"{mB['avg_range']:>10.1f} pts"),
        ("Best Month",          f"{mA['best_month']!s:>13}",  f"{mB['best_month']!s:>13}"),
        ("Worst Month",         f"{mA['worst_month']!s:>13}", f"{mB['worst_month']!s:>13}"),
    ]

    print(f"\n{BK}")
    print(f"  {'US100 ORB  DUAL-TIMEFRAME  COMPARATIVE BACKTEST  V3':^70}")
    print(BK)
    print(f"  {'Metric':<28}  {'Strategy A  (1:1 RR)':{W}}  "
          f"{'Strategy B  (1:2 + BE)':{W}}")
    print(f"  {dh * 70}")
    for lbl, va, vb in rows:
        print(f"  {lbl:<28}  {va:{W}}  {vb:{W}}")
    print(BK)

    # ── Monthly side-by-side ─────────────────────────────────────────────────
    all_months = sorted(set(mA["monthly"].index) | set(mB["monthly"].index))
    print(f"\n  {'MONTHLY BREAKDOWN'}")
    print(f"  {dh * 70}")
    print(f"  {'Month':<10}  {'A Trades':>8}  {'A Net PnL':>10}  "
          f"{'A Win%':>6}  │  {'B Trades':>8}  {'B Net PnL':>10}  {'B Win%':>6}")
    print(f"  {dh * 70}")
    for m in all_months:
        aR = mA["monthly"].loc[m] if m in mA["monthly"].index else None
        bR = mB["monthly"].loc[m] if m in mB["monthly"].index else None
        at = int(aR["trades"])  if aR is not None else 0
        ap = aR["net_pnl"]     if aR is not None else 0.0
        aw = aR["win_pct"]     if aR is not None else 0.0
        bt = int(bR["trades"]) if bR is not None else 0
        bp = bR["net_pnl"]    if bR is not None else 0.0
        bw = bR["win_pct"]    if bR is not None else 0.0
        print(f"  {str(m):<10}  {at:>8}  {ap:>+10.2f}  {aw:>5.1f}%  │  "
              f"{bt:>8}  {bp:>+10.2f}  {bw:>5.1f}%")
    print(BK)

    # ── Filter breakdown ─────────────────────────────────────────────────────
    traded = fc["traded"]
    print(f"\n  FILTER BREAKDOWN")
    print(f"  {dh * 50}")
    labels = [
        ("Total weekdays in dataset",      fc["total_weekdays"]),
        ("  Removed – Monday filter",      fc["monday"]),
        ("  Removed – Holiday adjacent",   fc["holiday_adjacent"]),
        ("  Removed – No 9:30 M15 bar",    fc["no_or_candle"]),
        ("  Removed – Range size filter",  fc["range_size"]),
        ("  Removed – No prev-day trend",  fc["no_prev_trend"]),
        ("  Removed – Wrong trend dir",    fc["trend_no_signal"]),
        ("  Removed – No breakout signal", fc["no_breakout"]),
        ("  ─────────────────────────────", ""),
        ("  DAYS TRADED",                  traded),
    ]
    for lbl, val in labels:
        if val == "":
            print(f"  {lbl}")
        else:
            pct = f"  ({val/fc['total_weekdays']*100:.1f}%)" if val != "" and isinstance(val,int) else ""
            print(f"  {lbl:<38}  {val:>4}{pct}")
    print(BK + "\n")


# ─────────────────────────────────────────────────────────────────────────────
#  CHART  (3 panels)
# ─────────────────────────────────────────────────────────────────────────────
def plot_chart(mA: dict, mB: dict, eq_A: list, eq_B: list):
    dark  = "#0f1117"
    gc    = "#2a2d36"
    COL_A = "#2196F3"
    COL_B = "#FF9800"
    RED   = "#F44336"
    GREEN = "#4CAF50"

    # Build time-series arrays
    ts_A  = [e[0] for e in eq_A]
    ts_B  = [e[0] for e in eq_B]
    eq_a  = mA["eq_vals"]
    eq_b  = mB["eq_vals"]
    dd_a  = mA["dd_pct"]
    dd_b  = mB["dd_pct"]

    fig = plt.figure(figsize=(16, 12), facecolor=dark)
    gs  = gridspec.GridSpec(3, 1, height_ratios=[3.2, 1.4, 1.8], hspace=0.48)

    def _style(ax, title):
        ax.set_facecolor("#1a1d27")
        ax.set_title(title, color="#e0e0e0", fontsize=9, pad=5, fontweight="bold")
        ax.tick_params(colors="#777", labelsize=7)
        for sp in ax.spines.values():
            sp.set_color(gc)
        ax.grid(True, color=gc, linewidth=0.4, linestyle="--")

    fmt_usd = plt.FuncFormatter(lambda v, _: f"${v:,.0f}")
    fmt_pct = plt.FuncFormatter(lambda v, _: f"{v:.1f}%")

    # ── Panel 1: Equity curves ────────────────────────────────────────────────
    ax1 = fig.add_subplot(gs[0])
    _style(ax1,
           f"US100 ORB  (15-min OR → 1-min entry)  │  "
           f"A: 1:1 RR  (blue)   B: 1:2 + BE  (orange)")
    ax1.axhline(START_CAP, color="#444", linestyle="--", linewidth=0.9, zorder=1)
    ax1.plot(ts_A, eq_a, color=COL_A, linewidth=1.2, label=f"A  1:1 RR  → ${eq_a[-1]:,.0f}", zorder=4)
    ax1.plot(ts_B, eq_b, color=COL_B, linewidth=1.2, label=f"B  1:2+BE  → ${eq_b[-1]:,.0f}", zorder=4)
    ax1.fill_between(ts_A, eq_a, START_CAP,
                     where=eq_a >= START_CAP, alpha=0.10, color=COL_A)
    ax1.fill_between(ts_A, eq_a, START_CAP,
                     where=eq_a  < START_CAP, alpha=0.12, color=RED)
    ax1.fill_between(ts_B, eq_b, START_CAP,
                     where=eq_b >= START_CAP, alpha=0.10, color=COL_B)
    ax1.fill_between(ts_B, eq_b, START_CAP,
                     where=eq_b  < START_CAP, alpha=0.12, color=RED)
    ax1.yaxis.set_major_formatter(fmt_usd)
    ax1.set_ylabel("Balance ($)", color="#aaa", fontsize=8)
    ax1.yaxis.label.set_color("#aaa")
    ax1.legend(fontsize=8, facecolor="#1a1d27", edgecolor="#444",
               labelcolor="#ddd", loc="lower left")

    # Annotate final balances
    for ts_list, eq_arr, col in [(ts_A, eq_a, COL_A), (ts_B, eq_b, COL_B)]:
        ax1.annotate(
            f"${eq_arr[-1]:,.0f}",
            xy=(ts_list[-1], eq_arr[-1]),
            xytext=(-70, 14), textcoords="offset points",
            color=col, fontsize=8,
            arrowprops=dict(arrowstyle="->", color=col, lw=0.7),
        )

    # ── Panel 2: Drawdown (both strategies) ──────────────────────────────────
    ax2 = fig.add_subplot(gs[1])
    _style(ax2, "Drawdown (%)  –  Blue = A  │  Orange = B")
    ax2.fill_between(ts_A, dd_a, 0, color=COL_A, alpha=0.35)
    ax2.fill_between(ts_B, dd_b, 0, color=COL_B, alpha=0.35)
    ax2.plot(ts_A, dd_a, color=COL_A, linewidth=0.7)
    ax2.plot(ts_B, dd_b, color=COL_B, linewidth=0.7)
    ax2.yaxis.set_major_formatter(fmt_pct)
    ax2.set_ylabel("DD (%)", color="#aaa", fontsize=8)
    ax2.yaxis.label.set_color("#aaa")

    # ── Panel 3: Monthly grouped PnL bars ────────────────────────────────────
    ax3 = fig.add_subplot(gs[2])
    _style(ax3, "Monthly Net PnL ($)  –  Blue = A  │  Orange = B")
    all_months = sorted(set(mA["monthly"].index) | set(mB["monthly"].index))
    x     = np.arange(len(all_months))
    width = 0.38
    pA = [mA["monthly"].loc[m, "net_pnl"] if m in mA["monthly"].index else 0 for m in all_months]
    pB = [mB["monthly"].loc[m, "net_pnl"] if m in mB["monthly"].index else 0 for m in all_months]
    ax3.bar(x - width / 2, pA, width, color=COL_A, alpha=0.85,
            label="A 1:1", edgecolor=dark, linewidth=0.3)
    ax3.bar(x + width / 2, pB, width, color=COL_B, alpha=0.85,
            label="B 1:2+BE", edgecolor=dark, linewidth=0.3)
    for xi, (va, vb) in enumerate(zip(pA, pB)):
        if va != 0:
            ax3.text(xi - width/2, va + (abs(va)*0.05 if va>=0 else -abs(va)*0.05),
                     f"${va:+.0f}", ha="center",
                     va="bottom" if va>=0 else "top",
                     fontsize=6.5, color=COL_A)
        if vb != 0:
            ax3.text(xi + width/2, vb + (abs(vb)*0.05 if vb>=0 else -abs(vb)*0.05),
                     f"${vb:+.0f}", ha="center",
                     va="bottom" if vb>=0 else "top",
                     fontsize=6.5, color=COL_B)
    ax3.set_xticks(x)
    ax3.set_xticklabels([str(m) for m in all_months], rotation=30,
                        ha="right", fontsize=8)
    ax3.axhline(0, color="#444", linewidth=0.8)
    ax3.yaxis.set_major_formatter(fmt_usd)
    ax3.set_ylabel("PnL ($)", color="#aaa", fontsize=8)
    ax3.yaxis.label.set_color("#aaa")
    ax3.legend(fontsize=8, facecolor="#1a1d27", edgecolor="#444",
               labelcolor="#ddd")

    fig.patch.set_facecolor(dark)
    plt.savefig("equity_curve.png", dpi=150, bbox_inches="tight",
                facecolor=dark)
    plt.close(fig)
    print("  Chart        →  equity_curve.png")


# ─────────────────────────────────────────────────────────────────────────────
#  CSV EXPORT
# ─────────────────────────────────────────────────────────────────────────────
CSV_COLS = ["date", "direction", "range_high", "range_low", "range_size",
            "entry_time", "entry_price", "sl", "tp", "exit_time",
            "exit_price", "exit_reason", "pnl", "balance"]

def save_csvs(mA: dict, mB: dict):
    for df_t, fname in [(mA["df_t"], "trade_log_ORB_1R1R.csv"),
                        (mB["df_t"], "trade_log_ORB_1R2R.csv")]:
        out = df_t[[c for c in CSV_COLS if c in df_t.columns]].copy()
        out.to_csv(fname, index=False)
        print(f"  Trade log    →  {fname}")


# ─────────────────────────────────────────────────────────────────────────────
#  GOOGLE SHEETS EXPORT  (5 sheets)
# ─────────────────────────────────────────────────────────────────────────────
def export_to_sheets(mA: dict, mB: dict, fc: dict):
    if not os.path.exists(CREDENTIALS_PATH):
        print("\n  [Google Sheets] credentials.json not found – skipping.")
        print("  Setup: console.cloud.google.com → APIs → Sheets + Drive → "
              "Service Account → download JSON → rename credentials.json → ~/Desktop/")
        return

    try:
        import gspread
        from google.oauth2.service_account import Credentials
    except ImportError:
        print("\n  [Google Sheets] Run: pip install gspread google-auth")
        return

    try:
        creds = Credentials.from_service_account_file(
            CREDENTIALS_PATH,
            scopes=["https://www.googleapis.com/auth/spreadsheets",
                    "https://www.googleapis.com/auth/drive"])
        gc = gspread.authorize(creds)
        try:
            sh = gc.create(SHEET_NAME)
        except Exception:
            sh = gc.open(SHEET_NAME)

        def push(ws, df, title):
            ws.update_title(title)
            rows = df.astype(str).values.tolist()
            ws.update("A1", [list(df.columns)] + rows)
            _fmt_hdr(ws, len(df.columns))

        def _mk(title):
            try:
                return sh.worksheet(title)
            except Exception:
                return sh.add_worksheet(title=title, rows=600, cols=22)

        def _fmt_hdr(ws, n):
            try:
                ws.format(f"A1:{chr(64+min(n,26))}1",
                          {"textFormat": {"bold": True},
                           "backgroundColor": {"red":0.1,"green":0.15,"blue":0.28}})
            except Exception:
                pass

        # Sheet 1 & 2: trade logs
        for ws, m, title in [
            (sh.sheet1,       mA, "Strategy A – Trade Log"),
            (_mk("Strategy B – Trade Log"), mB, "Strategy B – Trade Log"),
        ]:
            tl = m["df_t"][[c for c in CSV_COLS if c in m["df_t"].columns]].copy()
            push(ws, tl, title)

        # Sheet 3: side-by-side stats
        ws3 = _mk("Stats Comparison")
        ws3.update_title("Stats Comparison")

        def _stat_rows(mA, mB):
            def ds(m):
                d = m["avg_dur"]
                if not d: return "N/A"
                h, mn = divmod(int(d), 60)
                return f"{h}h {mn:02d}m" if h else f"{d:.1f} min"
            return [
                ["Metric",         "Strategy A (1:1 RR)", "Strategy B (1:2 + BE)"],
                ["Starting Capital", f"${START_CAP:,.2f}", f"${START_CAP:,.2f}"],
                ["Final Balance",    f"${mA['final']:,.2f}", f"${mB['final']:,.2f}"],
                ["Total Return",     f"{mA['total_return']:.2f}%", f"{mB['total_return']:.2f}%"],
                ["Total Trades",     mA["n"],  mB["n"]],
                ["Wins",             mA["wins"],   mB["wins"]],
                ["Losses",           mA["losses"], mB["losses"]],
                ["Breakevens",       mA["bes"],    mB["bes"]],
                ["Forced Closes",    mA["forced"], mB["forced"]],
                ["Win Rate",         f"{mA['win_rate']:.1f}%", f"{mB['win_rate']:.1f}%"],
                ["Profit Factor",    f"{mA['pf']:.2f}", f"{mB['pf']:.2f}"],
                ["Max Drawdown",     f"{mA['max_dd']:.2f}%", f"{mB['max_dd']:.2f}%"],
                ["Sharpe Ratio",     f"{mA['sharpe']:.2f}", f"{mB['sharpe']:.2f}"],
                ["Avg Duration",     ds(mA), ds(mB)],
                ["Avg Range Size",   f"{mA['avg_range']:.1f} pts", f"{mB['avg_range']:.1f} pts"],
                ["Best Month",       str(mA['best_month']), str(mB['best_month'])],
                ["Worst Month",      str(mA['worst_month']), str(mB['worst_month'])],
            ]
        ws3.update("A1", _stat_rows(mA, mB))
        _fmt_hdr(ws3, 3)

        # Sheet 4: filter breakdown
        ws4 = _mk("Filter Breakdown")
        ws4.update_title("Filter Breakdown")
        frows = [
            ["Filter Stage", "Days Removed", "% of Total"],
            ["Total weekdays",          fc["total_weekdays"], "100.0%"],
            ["Monday filter",           fc["monday"],         f"{fc['monday']/fc['total_weekdays']*100:.1f}%"],
            ["Holiday adjacent",        fc["holiday_adjacent"], f"{fc['holiday_adjacent']/fc['total_weekdays']*100:.1f}%"],
            ["No 9:30am M15 candle",    fc["no_or_candle"],   f"{fc['no_or_candle']/fc['total_weekdays']*100:.1f}%"],
            ["Range size (10-80 pts)",  fc["range_size"],     f"{fc['range_size']/fc['total_weekdays']*100:.1f}%"],
            ["No prev-day trend data",  fc["no_prev_trend"],  f"{fc['no_prev_trend']/fc['total_weekdays']*100:.1f}%"],
            ["Wrong trend direction",   fc["trend_no_signal"],f"{fc['trend_no_signal']/fc['total_weekdays']*100:.1f}%"],
            ["No breakout signal",      fc["no_breakout"],    f"{fc['no_breakout']/fc['total_weekdays']*100:.1f}%"],
            ["DAYS TRADED",             fc["traded"],         f"{fc['traded']/fc['total_weekdays']*100:.1f}%"],
        ]
        ws4.update("A1", frows)
        _fmt_hdr(ws4, 3)

        # Sheet 5: monthly performance both
        ws5 = _mk("Monthly Performance")
        ws5.update_title("Monthly Performance")
        all_months = sorted(set(mA["monthly"].index) | set(mB["monthly"].index))
        mhdr = ["Month","A Trades","A Net PnL","A Win%","B Trades","B Net PnL","B Win%"]
        mrows = []
        for m in all_months:
            aR = mA["monthly"].loc[m] if m in mA["monthly"].index else None
            bR = mB["monthly"].loc[m] if m in mB["monthly"].index else None
            mrows.append([
                str(m),
                int(aR["trades"]) if aR is not None else 0,
                round(aR["net_pnl"],2) if aR is not None else 0,
                round(aR["win_pct"],1) if aR is not None else 0,
                int(bR["trades"]) if bR is not None else 0,
                round(bR["net_pnl"],2) if bR is not None else 0,
                round(bR["win_pct"],1) if bR is not None else 0,
            ])
        ws5.update("A1", [mhdr] + mrows)
        _fmt_hdr(ws5, len(mhdr))

        print(f"\n  Google Sheet →  {sh.url}")

    except Exception as exc:
        print(f"\n  [Google Sheets] Failed: {exc}")


# ─────────────────────────────────────────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────────────────────────────────────────
def main():
    # 1. Load data
    m15, m1 = load_data()

    # 2. Run backtest
    print("\n  Running dual-timeframe ORB backtest …")
    trades_A, trades_B, eq_A, eq_B, fc = run_backtest(m15, m1)

    if not trades_A:
        sys.exit("No trades generated. Check filter thresholds and data range.")

    print(f"  Strategy A: {len(trades_A)} trades  │  "
          f"Strategy B: {len(trades_B)} trades")

    # 3. Compute metrics
    mA = calc_metrics(trades_A, eq_A)
    mB = calc_metrics(trades_B, eq_B)

    # 4. Terminal output
    print_results(mA, mB, fc)

    # 5. Chart
    plot_chart(mA, mB, eq_A, eq_B)

    # 6. CSVs
    save_csvs(mA, mB)

    # 7. Google Sheets
    print("  Exporting to Google Sheets …")
    export_to_sheets(mA, mB, fc)

    print("\n  All done.\n")


if __name__ == "__main__":
    main()
