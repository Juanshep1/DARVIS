// Azure Cognitive Services Neural TTS — genuinely natural voices.
// Free tier: 500,000 characters / month, every month, forever.
// Setup:
//   1. Create a free Azure account at https://portal.azure.com
//   2. Create a Speech resource (pick the Free F0 tier)
//   3. Copy Key 1 and the Region
//   4. Set Netlify env vars:
//        netlify env:set AZURE_SPEECH_KEY <key>
//        netlify env:set AZURE_SPEECH_REGION <region>    (e.g. eastus)
//
// GET  /api/tts-azure?voice=en-GB-RyanNeural&text=hello
// POST { voice, text, rate, pitch }

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text, voice, rate, pitch) {
  const clean = escapeXml(text).slice(0, 5000);
  const lang = voice.slice(0, 5); // en-GB, en-US
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody rate='${rate}' pitch='${pitch}'>` +
    clean +
    `</prosody></voice></speak>`;
}

export default async (req) => {
  const KEY = Netlify.env.get("AZURE_SPEECH_KEY");
  const REGION = Netlify.env.get("AZURE_SPEECH_REGION");

  if (!KEY || !REGION) {
    return Response.json({
      error: "no_key",
      hint: "Azure Speech not configured. Grab a free key at https://portal.azure.com (Speech resource, F0 tier), then run: netlify env:set AZURE_SPEECH_KEY <key>; netlify env:set AZURE_SPEECH_REGION eastus",
    }, { status: 503 });
  }

  let voice = "en-GB-RyanNeural";
  let text = "";
  let rate = "0%";
  let pitch = "0Hz";

  if (req.method === "GET") {
    const url = new URL(req.url);
    voice = url.searchParams.get("voice") || voice;
    text = url.searchParams.get("text") || "";
    rate = url.searchParams.get("rate") || rate;
    pitch = url.searchParams.get("pitch") || pitch;
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    voice = body.voice || voice;
    text = body.text || "";
    rate = body.rate || rate;
    pitch = body.pitch || pitch;
  } else {
    return new Response("Method not allowed", { status: 405 });
  }

  // Clean markdown + code blocks
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return Response.json({ error: "no text" }, { status: 400 });

  const ssml = buildSsml(text, voice, rate, pitch);
  const endpoint = `https://${REGION}.tts.speech.microsoft.com/cognitiveservices/v1`;

  try {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
        "User-Agent": "SpectraTTS",
      },
      body: ssml,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      return Response.json({ error: `azure ${r.status}`, detail: errText.slice(0, 300) }, { status: 502 });
    }
    const audio = await r.arrayBuffer();
    if (!audio || audio.byteLength < 100) throw new Error("empty audio");
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return Response.json({ error: e?.message || "azure tts failed" }, { status: 502 });
  }
};

export const config = { path: "/api/tts-azure" };
