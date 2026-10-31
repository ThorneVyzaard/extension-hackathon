#!/usr/bin/env bash
# Lance le backend FakeLens (local uniquement).
set -e
cd "$(dirname "$0")/backend"
[ -d .venv ] || python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt -q
exec uvicorn main:app --host 127.0.0.1 --port 8000
