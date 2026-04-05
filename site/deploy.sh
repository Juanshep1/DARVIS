#!/bin/bash
# Deploy D.A.R.V.I.S. web dashboard to Netlify
set -e

cd "$(dirname "$0")"

echo ""
echo "  Deploying D.A.R.V.I.S. to Netlify..."
echo ""

# Check if logged in
if ! netlify status 2>/dev/null | grep -q "Logged in"; then
    echo "  First, log in to Netlify:"
    netlify login
fi

# Check if site is linked
if [ ! -f ".netlify/state.json" ]; then
    echo "  Creating new Netlify site..."
    netlify init --manual
fi

# Set environment variables
echo "  Setting API keys..."
netlify env:set OLLAMA_API_KEY "0305bcb541ec4980bc99bb1aa77a3d12.lIr9I8Ir2oj-S26Bo1745Kcu" --force 2>/dev/null
netlify env:set ELEVENLABS_API_KEY "sk_fc66616221fcc7b5f374a38e485815297965f2fc7baf4f7b" --force 2>/dev/null
netlify env:set DARVIS_VOICE_ID "kPtEHAvRnjUJFv7SK9WI" --force 2>/dev/null
netlify env:set DARVIS_MODEL "llama3.3:70b" --force 2>/dev/null

# Deploy
echo "  Deploying..."
netlify deploy --prod

echo ""
echo "  Done! Your DARVIS is live."
echo ""
