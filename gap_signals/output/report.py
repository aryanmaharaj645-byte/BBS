"""
Report generator — renders the signal JSON into a clean terminal report
and saves it to a dated file.
"""
import json
import os
from datetime import datetime, timezone
from colorama import init, Fore, Style, Back
from tabulate import tabulate

init(autoreset=True)

DIRECTION_COLOR = {
    "BUY":     Fore.GREEN,
    "SELL":    Fore.RED,
    "NEUTRAL": Fore.YELLOW,
}

CONFIDENCE_COLOR = {
    range(80, 101): Fore.GREEN + Style.BRIGHT,
    range(60, 80):  Fore.GREEN,
    range(40, 60):  Fore.YELLOW,
    range(20, 40):  Fore.RED,
    range(0, 20):   Fore.RED + Style.DIM,
}

RISK_COLOR = {
    "NONE":    Fore.GREEN,
    "LOW":     Fore.GREEN,
    "MEDIUM":  Fore.YELLOW,
    "HIGH":    Fore.RED,
    "EXTREME": Fore.RED + Style.BRIGHT,
}

GAP_TYPE_COLOR = {
    "CONTINUATION": Fore.CYAN,
    "FILL":         Fore.MAGENTA,
    "UNCERTAIN":    Fore.YELLOW,
}


def _conf_color(conf: int) -> str:
    for r, color in CONFIDENCE_COLOR.items():
        if conf in r:
            return color
    return Fore.WHITE


def _bar(conf: int, width: int = 20) -> str:
    filled = int(conf / 100 * width)
    bar = "█" * filled + "░" * (width - filled)
    return _conf_color(conf) + bar + Style.RESET_ALL


def render_terminal(signals: dict, save_path: str | None = None) -> None:
    """Print a full signal report to terminal (and optionally save to file)."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    divider = "═" * 80

    lines = []
    lines.append(f"\n{Fore.CYAN}{Style.BRIGHT}{divider}")
    lines.append(f"  WEEKEND GAP SIGNAL REPORT  ·  Generated {now}")
    lines.append(f"{divider}{Style.RESET_ALL}")

    # ── Macro Summary ─────────────────────────────────────────────────────
    macro = signals.get("macro_theme", "N/A")
    trump_risk = signals.get("trump_risk_level", "N/A")
    geo_risk = signals.get("geopolitical_risk", "N/A")
    recommended = signals.get("recommended_assets", [])
    avoid = signals.get("assets_to_avoid", [])

    lines.append(f"\n{Style.BRIGHT}MACRO THEME{Style.RESET_ALL}")
    lines.append(f"  {macro}")
    lines.append(f"\n{Style.BRIGHT}RISK ENVIRONMENT{Style.RESET_ALL}")
    lines.append(f"  Trump Risk:         {RISK_COLOR.get(trump_risk, Fore.WHITE)}{trump_risk}{Style.RESET_ALL}")
    lines.append(f"  Geopolitical Risk:  {RISK_COLOR.get(geo_risk, Fore.WHITE)}{geo_risk}{Style.RESET_ALL}")

    if recommended:
        lines.append(f"\n{Style.BRIGHT}BEST SETUPS THIS WEEKEND{Style.RESET_ALL}")
        for a in recommended:
            lines.append(f"  ★ {Fore.GREEN}{a}{Style.RESET_ALL}")
    if avoid:
        lines.append(f"\n{Style.BRIGHT}AVOID (conflicted/low confidence){Style.RESET_ALL}")
        for a in avoid:
            lines.append(f"  ✗ {Fore.RED}{a}{Style.RESET_ALL}")

    # ── Signals Table ────────────────────────────────────────────────────
    sigs = signals.get("signals", {})
    if not sigs:
        lines.append(f"\n{Fore.RED}No signals generated.{Style.RESET_ALL}")
        for l in lines:
            print(l)
        return

    # Group by category
    from config import FOREX_PAIRS, INDICES, COMMODITIES
    groups = [
        ("FOREX PAIRS", FOREX_PAIRS),
        ("INDICES", INDICES),
        ("COMMODITIES", COMMODITIES),
    ]

    for group_name, asset_list in groups:
        lines.append(f"\n{Fore.CYAN}{Style.BRIGHT}{'─'*80}")
        lines.append(f"  {group_name}")
        lines.append(f"{'─'*80}{Style.RESET_ALL}")

        table_rows = []
        for asset in asset_list:
            sig = sigs.get(asset)
            if not sig:
                continue

            direction = sig.get("direction", "N/A")
            conf = sig.get("confidence", 0)
            gap_type = sig.get("gap_type", "N/A")
            gap_size = sig.get("expected_gap_size", "N/A")

            dir_str = (DIRECTION_COLOR.get(direction, "") + f"{direction:8}" + Style.RESET_ALL)
            conf_str = _conf_color(conf) + f"{conf:3}%" + Style.RESET_ALL
            gap_str = GAP_TYPE_COLOR.get(gap_type, "") + f"{gap_type:13}" + Style.RESET_ALL
            bar_str = _bar(conf)

            table_rows.append([
                Style.BRIGHT + f"{asset:8}" + Style.RESET_ALL,
                dir_str,
                conf_str,
                bar_str,
                gap_str,
                gap_size,
            ])

        if table_rows:
            header = ["Asset", "Direction", "Conf", "Confidence Bar", "Gap Type", "Expected Size"]
            print("\n".join(lines))
            lines = []
            print(tabulate(table_rows, headers=header, tablefmt="plain"))

    # ── Detailed Signal Cards ─────────────────────────────────────────────
    lines.append(f"\n{Fore.CYAN}{Style.BRIGHT}{'═'*80}")
    lines.append(f"  SIGNAL DETAIL CARDS")
    lines.append(f"{'═'*80}{Style.RESET_ALL}")

    # Show top recommended first, then all others
    ordered_assets = []
    for a in recommended:
        if a in sigs:
            ordered_assets.append(a)
    for a in sigs:
        if a not in ordered_assets:
            ordered_assets.append(a)

    for asset in ordered_assets:
        sig = sigs[asset]
        direction = sig.get("direction", "N/A")
        conf = sig.get("confidence", 0)
        gap_type = sig.get("gap_type", "N/A")
        gap_size = sig.get("expected_gap_size", "N/A")
        drivers = sig.get("key_drivers", [])
        risks = sig.get("risks", [])
        bias = sig.get("trade_bias", "")

        is_recommended = asset in recommended
        star = " ★" if is_recommended else ""
        dir_color = DIRECTION_COLOR.get(direction, "")

        lines.append(f"\n  {Style.BRIGHT}{asset}{star}{Style.RESET_ALL}  "
                     f"{dir_color}{direction}{Style.RESET_ALL}  "
                     f"{_conf_color(conf)}{conf}%{Style.RESET_ALL}  "
                     f"{GAP_TYPE_COLOR.get(gap_type, '')}{gap_type}{Style.RESET_ALL}  "
                     f"{gap_size}")

        lines.append(f"  {Fore.WHITE}Trade Bias:{Style.RESET_ALL} {bias}")

        if drivers:
            lines.append(f"  {Fore.GREEN}Key Drivers:{Style.RESET_ALL}")
            for d in drivers:
                lines.append(f"    • {d}")

        if risks:
            lines.append(f"  {Fore.RED}Invalidation Risks:{Style.RESET_ALL}")
            for r in risks:
                lines.append(f"    ⚠ {r}")

    lines.append(f"\n{Fore.CYAN}{divider}{Style.RESET_ALL}\n")
    print("\n".join(lines))

    # ── Save to file ──────────────────────────────────────────────────────
    if save_path:
        os.makedirs(os.path.dirname(save_path), exist_ok=True)
        # Strip ANSI for file output
        import re
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        clean = "\n".join([
            ansi_escape.sub("", l) for l in lines
        ])
        with open(save_path, "w") as f:
            json.dump(signals, f, indent=2)
        print(f"  Report saved: {save_path}")


def save_json(signals: dict, path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as f:
        json.dump(signals, f, indent=2)
    print(f"  JSON saved: {path}")
