#!/bin/bash
# sync-data.sh — copy the latest gap signal output into platform/data/
# Run this before deploying to Netlify (or after python3 main.py --save)

SRC="/Users/Aryan/BBS/gap_signals/dashboard/data/latest.json"
DST="$(dirname "$0")/data/latest.json"

if [ ! -f "$SRC" ]; then
  echo "❌  Source not found: $SRC"
  echo "    Run: python3 /Users/Aryan/BBS/gap_signals/main.py --save"
  exit 1
fi

cp "$SRC" "$DST"
echo "✅  Copied latest.json → platform/data/latest.json"
echo "    Generated at: $(python3 -c "import json; d=json.load(open('$DST')); print(d.get('generated_at','?'))")"
