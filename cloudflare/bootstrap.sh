#!/usr/bin/env bash
# SPECTRA — one-shot Cloudflare Workers bootstrap.
# Run this after `npx wrangler login` has completed.
#
# It will:
#   1. Create the KV namespace (production + preview) if missing
#   2. Patch wrangler.toml with the IDs
#   3. Prompt for each required/optional secret (skip to leave blank)
#   4. Deploy
#
# Safe to re-run — uses existing KV IDs if found, and `wrangler secret put`
# overwrites in-place. No destructive actions.

set -euo pipefail

cd "$(dirname "$0")"

# ── Preflight ──────────────────────────────────────────────────────────────
if ! npx wrangler whoami >/dev/null 2>&1; then
  echo "❌ Not logged in to Cloudflare. Run: npx wrangler login"
  exit 1
fi

echo "✓ Wrangler logged in as:"
npx wrangler whoami 2>&1 | grep -E "email|account" || true

# ── KV namespaces ──────────────────────────────────────────────────────────
echo ""
echo "── KV namespace setup ─────────────────────────────────────────────"

# Detect existing entries in wrangler.toml
EXISTING_ID=$(grep '^id = ' wrangler.toml | head -1 | awk -F'"' '{print $2}' || true)
EXISTING_PREVIEW=$(grep '^preview_id = ' wrangler.toml | head -1 | awk -F'"' '{print $2}' || true)

if [[ "$EXISTING_ID" == "REPLACE_WITH_KV_ID" || -z "$EXISTING_ID" ]]; then
  echo "Creating production KV namespace 'SPECTRA'..."
  RAW=$(npx wrangler kv:namespace create SPECTRA 2>&1)
  echo "$RAW"
  ID=$(echo "$RAW" | grep -oE 'id = "[a-f0-9]{32}"' | head -1 | awk -F'"' '{print $2}')
  if [[ -z "$ID" ]]; then
    echo "⚠ Could not parse KV id. Paste it manually into wrangler.toml."
    exit 1
  fi
  echo "  → id: $ID"
  # macOS sed needs "" after -i
  sed -i.bak "s/REPLACE_WITH_KV_ID/$ID/" wrangler.toml && rm wrangler.toml.bak
else
  echo "  using existing production id: $EXISTING_ID"
fi

if [[ "$EXISTING_PREVIEW" == "REPLACE_WITH_PREVIEW_KV_ID" || -z "$EXISTING_PREVIEW" ]]; then
  echo "Creating preview KV namespace..."
  RAW=$(npx wrangler kv:namespace create SPECTRA --preview 2>&1)
  echo "$RAW"
  PID=$(echo "$RAW" | grep -oE 'preview_id = "[a-f0-9]{32}"' | head -1 | awk -F'"' '{print $2}')
  if [[ -z "$PID" ]]; then
    echo "⚠ Could not parse preview KV id. Paste it manually into wrangler.toml."
    exit 1
  fi
  echo "  → preview_id: $PID"
  sed -i.bak "s/REPLACE_WITH_PREVIEW_KV_ID/$PID/" wrangler.toml && rm wrangler.toml.bak
else
  echo "  using existing preview id: $EXISTING_PREVIEW"
fi

# ── Secrets ────────────────────────────────────────────────────────────────
echo ""
echo "── Secrets ─────────────────────────────────────────────────────────"
echo "Paste each value when prompted. Press Enter with no input to skip."
echo ""

put_secret() {
  local name="$1"
  local hint="$2"
  echo -n "$name ($hint): "
  read -s VALUE
  echo ""
  if [[ -z "$VALUE" ]]; then
    echo "  skipped"
    return
  fi
  echo "$VALUE" | npx wrangler secret put "$name" 2>&1 | grep -E "Success|Uploaded" || true
}

# Required
put_secret "OLLAMA_API_KEY"     "classic mode brain"
put_secret "GEMINI_API_KEY"     "Gemini Live voice + query rewrite"
put_secret "TAVILY_API_KEY"     "web search"

# Optional
put_secret "ELEVENLABS_API_KEY" "optional — ElevenLabs TTS"
put_secret "OPENROUTER_API_KEY" "optional — OpenRouter chat"
put_secret "AZURE_SPEECH_KEY"   "optional — Azure Neural TTS"
put_secret "AZURE_SPEECH_REGION" "optional — e.g. eastus"
put_secret "CESIUM_ION_TOKEN"   "optional — Falcon Eye 3D globe"
put_secret "WSDOT_ACCESS_CODE"  "optional — Falcon Eye WA traffic cams"
put_secret "FIRMS_MAP_KEY"      "optional — NASA active fires"
put_secret "RAPIDAPI_KEY"       "optional — ADS-B Exchange mil"

# ── Deploy ─────────────────────────────────────────────────────────────────
echo ""
echo "── Deploying ──────────────────────────────────────────────────────"
npx wrangler deploy

echo ""
echo "✓ Done. Your API lives at the URL printed above."
echo ""
echo "Next: open SPECTRA in your browser, DevTools console, and run:"
echo '  spectraSetApiBase("https://spectra-api.<account>.workers.dev")'
echo '  location.reload()'
