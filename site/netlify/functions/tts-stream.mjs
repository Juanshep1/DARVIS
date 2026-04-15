// Free TTS alternatives — StreamElements + others.
// StreamElements: classic TTS-donation voices (Brian, Amy, Joey, Russell,
// etc.), no API key, no signup. Used by every Twitch streamer for years.
// Provider param picks the upstream.
//
// GET /api/tts-stream?provider=streamelements&voice=Brian&text=hello
// POST { provider, voice, text }

const STREAMELEMENTS_VOICES = new Set([
  "Brian", "Amy", "Emma", "Russell", "Nicole", "Joey", "Justin",
  "Matthew", "Joanna", "Salli", "Kimberly", "Kendra", "Ivy", "Mizuki",
  "Geraint", "Raveena", "Chantal", "Celine", "Mathieu", "Marlene",
  "Hans", "Vicki", "Carla", "Conchita", "Enrique", "Liv", "Lotte",
  "Naja", "Maja", "Jacek", "Ewa", "Cristiano", "Vitoria", "Astrid",
  "Tatyana", "Maxim", "Filiz",
]);

async function fetchStreamElements(text, voice) {
  const v = STREAMELEMENTS_VOICES.has(voice) ? voice : "Brian";
  const url = `https://api.streamelements.com/kappa/v2/speech?voice=${encodeURIComponent(v)}&text=${encodeURIComponent(text.slice(0, 1000))}`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 SpectraTTS" },
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`streamelements ${r.status}`);
  const buf = await r.arrayBuffer();
  return new Response(buf, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "public, max-age=3600",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export default async (req) => {
  let provider = "streamelements";
  let voice = "Brian";
  let text = "";

  if (req.method === "GET") {
    const url = new URL(req.url);
    provider = url.searchParams.get("provider") || provider;
    voice = url.searchParams.get("voice") || voice;
    text = url.searchParams.get("text") || "";
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    provider = body.provider || provider;
    voice = body.voice || voice;
    text = body.text || "";
  } else {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!text.trim()) {
    return Response.json({ error: "no text" }, { status: 400 });
  }

  // Clean text — strip markdown, code blocks, emoji
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  try {
    if (provider === "streamelements") return await fetchStreamElements(text, voice);
    return Response.json({ error: `unknown provider: ${provider}` }, { status: 400 });
  } catch (e) {
    return Response.json({ error: e?.message || "tts failed" }, { status: 502 });
  }
};

export const config = { path: "/api/tts-stream" };
