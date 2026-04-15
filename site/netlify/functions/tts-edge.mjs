// Natural neural TTS via Google Translate's read-aloud endpoint.
// Free, no API key, works from Netlify Lambda. The endpoint returns
// real WaveNet-adjacent audio that sounds natural on most English
// content. The community fgtts / gTTS libraries use the same trick.
//
// GET  /api/tts-edge?voice=en&text=hello
// POST { voice, text }
//
// Voice codes map to Google Translate language+accent combinations:
//   en-GB → British
//   en-US → American
//   en-AU → Australian
//   en-IE → Irish
//   en-IN → Indian
//   en-ZA → South African
//
// The endpoint has a 200-char-per-request limit, so we chunk long
// text and concatenate the MP3 segments.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

// Split text into ≤200-char chunks on sentence/clause boundaries so
// each TTS request fits within Google's limit without cutting words.
function chunkText(text, max = 195) {
  const out = [];
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return out;
  const parts = clean.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const p of parts) {
    if (p.length > max) {
      // Hard split on commas or word boundaries
      const words = p.split(" ");
      let sub = "";
      for (const w of words) {
        if ((sub + " " + w).length > max) {
          if (sub) out.push(sub.trim());
          sub = w;
        } else {
          sub = sub ? sub + " " + w : w;
        }
      }
      if (sub) out.push(sub.trim());
      buf = "";
      continue;
    }
    if ((buf + " " + p).length > max) {
      if (buf) out.push(buf.trim());
      buf = p;
    } else {
      buf = buf ? buf + " " + p : p;
    }
  }
  if (buf) out.push(buf.trim());
  return out;
}

async function fetchChunk(text, lang) {
  const url = `https://translate.google.com/translate_tts` +
    `?ie=UTF-8` +
    `&q=${encodeURIComponent(text)}` +
    `&tl=${encodeURIComponent(lang)}` +
    `&client=tw-ob` +
    `&ttsspeed=1`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      "Referer": "https://translate.google.com/",
      "Accept": "audio/mpeg, audio/*, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`google tts ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length < 32) throw new Error("google tts: empty audio");
  return buf;
}

// Voice param → Google Translate language code. The "voice" field is
// preserved for API compat with the previous Edge implementation so the
// frontend doesn't have to change.
function voiceToLang(voice) {
  if (!voice) return "en";
  const v = voice.toLowerCase();
  if (v.startsWith("en-gb")) return "en-GB";
  if (v.startsWith("en-us")) return "en-US";
  if (v.startsWith("en-au")) return "en-AU";
  if (v.startsWith("en-ie")) return "en-IE";
  if (v.startsWith("en-in")) return "en-IN";
  if (v.startsWith("en-za")) return "en-ZA";
  if (v.startsWith("en-ca")) return "en-CA";
  if (v.startsWith("en-nz")) return "en-AU"; // NZ not supported, use AU
  if (v.startsWith("en")) return "en";
  if (v.startsWith("fr")) return "fr";
  if (v.startsWith("de")) return "de";
  if (v.startsWith("es")) return "es";
  if (v.startsWith("it")) return "it";
  if (v.startsWith("pt")) return "pt";
  if (v.startsWith("ja")) return "ja";
  if (v.startsWith("ko")) return "ko";
  if (v.startsWith("zh")) return "zh-CN";
  return "en";
}

export default async (req) => {
  let voice = "en-GB";
  let text = "";

  if (req.method === "GET") {
    const url = new URL(req.url);
    voice = url.searchParams.get("voice") || voice;
    text = url.searchParams.get("text") || "";
  } else if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    voice = body.voice || voice;
    text = body.text || "";
  } else {
    return new Response("Method not allowed", { status: 405 });
  }

  // Clean markdown + code blocks
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  if (!text) return Response.json({ error: "no text" }, { status: 400 });

  const lang = voiceToLang(voice);

  try {
    const chunks = chunkText(text);
    if (!chunks.length) return Response.json({ error: "no speakable text" }, { status: 400 });

    // Fetch all chunks in parallel, in original order
    const buffers = await Promise.all(chunks.map((c) => fetchChunk(c, lang)));
    const total = buffers.reduce((s, b) => s + b.length, 0);
    const combined = Buffer.concat(buffers, total);

    return new Response(combined, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(combined.length),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return Response.json({ error: e?.message || "google tts failed" }, { status: 502 });
  }
};

export const config = { path: "/api/tts-edge" };
