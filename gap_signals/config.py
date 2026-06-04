"""
Gap Signal Generator — Configuration
All assets, data sources, and thresholds live here.
"""

# ── Assets ─────────────────────────────────────────────────────────────────
FOREX_PAIRS = [
    "EURUSD", "GBPUSD", "USDJPY", "USDCHF", "AUDUSD",
    "NZDUSD", "USDCAD", "EURJPY", "GBPJPY", "EURGBP",
    "AUDJPY", "EURAUD", "GBPAUD", "EURCAD", "CADJPY",
]

INDICES = ["US30", "NAS100"]
COMMODITIES = ["GOLD", "OIL"]

# yfinance ticker mappings
YFINANCE_MAP = {
    "EURUSD": "EURUSD=X",
    "GBPUSD": "GBPUSD=X",
    "USDJPY": "JPY=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "NZDUSD": "NZDUSD=X",
    "USDCAD": "CAD=X",
    "EURJPY": "EURJPY=X",
    "GBPJPY": "GBPJPY=X",
    "EURGBP": "EURGBP=X",
    "AUDJPY": "AUDJPY=X",
    "EURAUD": "EURAUD=X",
    "GBPAUD": "GBPAUD=X",
    "EURCAD": "EURCAD=X",
    "CADJPY": "CADJPY=X",
    "US30":   "^DJI",
    "NAS100": "^NDX",
    "GOLD":   "GC=F",
    "OIL":    "CL=F",
}

# ── RSS / News Sources ─────────────────────────────────────────────────────
NEWS_FEEDS = [
    # Financial / Market
    {"name": "Reuters Markets",         "url": "https://feeds.reuters.com/reuters/businessNews"},
    {"name": "Reuters Top News",        "url": "https://feeds.reuters.com/reuters/topNews"},
    {"name": "CNBC Top News",           "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html"},
    {"name": "CNBC Finance",            "url": "https://www.cnbc.com/id/10000664/device/rss/rss.html"},
    {"name": "MarketWatch Top",         "url": "https://feeds.marketwatch.com/marketwatch/topstories/"},
    {"name": "MarketWatch Markets",     "url": "https://feeds.marketwatch.com/marketwatch/marketpulse/"},
    {"name": "Bloomberg Markets",       "url": "https://feeds.bloomberg.com/markets/news.rss"},
    {"name": "FT Markets",              "url": "https://www.ft.com/markets?format=rss"},
    {"name": "Investing.com News",      "url": "https://www.investing.com/rss/news.rss"},
    {"name": "Investing.com Forex",     "url": "https://www.investing.com/rss/news_285.rss"},
    {"name": "Investing.com Commodities","url": "https://www.investing.com/rss/news_8.rss"},
    {"name": "Yahoo Finance",           "url": "https://finance.yahoo.com/news/rssindex"},
    {"name": "ForexLive",               "url": "https://www.forexlive.com/feed/news"},
    {"name": "ForexFactory News",       "url": "https://www.forexfactory.com/news?format=rss"},
    # Geopolitical / General
    {"name": "BBC World",               "url": "http://feeds.bbci.co.uk/news/world/rss.xml"},
    {"name": "BBC Business",            "url": "http://feeds.bbci.co.uk/news/business/rss.xml"},
    {"name": "Al Jazeera",              "url": "https://www.aljazeera.com/xml/rss/all.xml"},
    {"name": "Guardian World",          "url": "https://www.theguardian.com/world/rss"},
    {"name": "AP Top News",             "url": "https://rsshub.app/apnews/topics/apf-topnews"},
    {"name": "Politico",                "url": "https://www.politico.com/rss/politicopicks.xml"},
    # Commodities / Energy
    {"name": "OilPrice.com",            "url": "https://oilprice.com/rss/main"},
    {"name": "EIA News",                "url": "https://www.eia.gov/rss/news.xml"},
    # Central Banks
    {"name": "Federal Reserve",         "url": "https://www.federalreserve.gov/feeds/press_all.xml"},
    {"name": "ECB News",                "url": "https://www.ecb.europa.eu/rss/press.html"},
    # Trump / Political
    {"name": "Truth Social (Trump)",    "url": "https://truthsocial.com/@realDonaldTrump/feed.rss"},
    {"name": "White House Briefings",   "url": "https://www.whitehouse.gov/feed/"},
]

# Economic calendar sources
ECONDB_BASE = "https://www.econdb.com/api/series/"
FOREXFACTORY_CAL = "https://www.forexfactory.com/calendar?format=rss"

# ── Keywords for relevance scoring ────────────────────────────────────────
HIGH_IMPACT_KEYWORDS = [
    # Trump / Policy
    "trump", "tariff", "trade war", "executive order", "sanctions", "white house",
    "treasury", "mnuchin", "bessent", "fed chair", "powell",
    # Central Banks
    "federal reserve", "fed rate", "interest rate", "rate hike", "rate cut",
    "fomc", "ecb", "boe", "boj", "rba", "rbnz", "boc", "snb",
    "quantitative", "balance sheet", "monetary policy", "inflation target",
    # Economic Data
    "nfp", "non-farm payroll", "cpi", "pce", "gdp", "pmi", "ism",
    "unemployment", "jobless", "retail sales", "consumer confidence",
    "core inflation", "durable goods", "trade balance", "current account",
    # Geopolitical
    "war", "conflict", "military", "nato", "ukraine", "russia", "china",
    "middle east", "israel", "iran", "north korea", "taiwan", "south china sea",
    "opec", "oil production", "energy", "gas pipeline", "embargo",
    # Market Specific
    "recession", "stagflation", "credit crunch", "bank failure", "bailout",
    "debt ceiling", "government shutdown", "default", "downgrade",
    "dollar", "dxy", "gold", "oil", "crude", "risk-off", "risk-on",
    "vix", "volatility", "market crash", "circuit breaker",
    # Crypto (correlation signal)
    "bitcoin", "crypto", "btc", "crypto market",
]

ASSET_KEYWORDS = {
    "EURUSD": ["euro", "eur", "ecb", "eurozone", "germany", "france", "draghi", "lagarde"],
    "GBPUSD": ["pound", "sterling", "gbp", "boe", "bank of england", "brexit", "uk economy", "bailey"],
    "USDJPY": ["yen", "jpy", "boj", "bank of japan", "ueda", "japan", "carry trade"],
    "USDCHF": ["franc", "chf", "snb", "swiss", "safe haven"],
    "AUDUSD": ["aussie", "aud", "rba", "australia", "iron ore", "china demand"],
    "NZDUSD": ["kiwi", "nzd", "rbnz", "new zealand"],
    "USDCAD": ["cad", "loonie", "boc", "bank of canada", "canada", "crude oil", "wti"],
    "GOLD":   ["gold", "xau", "haven", "inflation hedge", "bullion", "fed", "real rates"],
    "OIL":    ["oil", "crude", "wti", "brent", "opec", "energy", "production cut", "rig count"],
    "US30":   ["dow", "us30", "djia", "industrials", "blue chip"],
    "NAS100": ["nasdaq", "tech", "nasdaq100", "ndx", "big tech", "ai", "semiconductor", "apple", "nvidia", "microsoft"],
}

# ── Signal thresholds ──────────────────────────────────────────────────────
CONFIDENCE_THRESHOLDS = {
    "STRONG_BUY":  80,
    "BUY":         60,
    "NEUTRAL":     40,
    "SELL":        20,
    "STRONG_SELL":  0,
}

# Max articles per feed to avoid context bloat
MAX_ARTICLES_PER_FEED = 5
MAX_TOTAL_ARTICLES = 120
NEWS_LOOKBACK_HOURS = 72   # look back 72h (covers full weekend)
