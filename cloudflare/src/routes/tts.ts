import { Hono } from "hono";
import type { Env } from "../env";
import { kvGetJSON } from "../lib/kv";

// ── /api/tts — ElevenLabs ──────────────────────────────────────────────────

export const ttsRoute = new Hono<{ Bindings: Env }>();

ttsRoute.post("/", async (c) => {
  const body = await c.req.json<{ text?: string }>().catch(() => ({} as { text?: string }));
  const text = body.text;
  if (!text) return c.json({ error: "No text" }, 400);

  const key = c.env.ELEVENLABS_API_KEY;
  if (!key) return new Response(null, { status: 204 });

  let voiceId = c.env.DARVIS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
  try {
    const s = await kvGetJSON<{ voice_id?: string }>(c.env, "settings", "current");
    if (s?.voice_id) voiceId = s.voice_id;
  } catch {}

  let clean = text.replace(/[*_`#\[\]()]/g, "").replace(/\n+/g, ". ");
  if (clean.length > 2000) clean = clean.substring(0, 2000);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "xi-api-key": key, Accept: "audio/mpeg" },
      body: JSON.stringify({
        text: clean,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
      }),
    });
    if (!res.ok) return new Response(null, { status: 204 });
    const audio = await res.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
});

// ── /api/tts-stream — StreamElements / free voices ─────────────────────────

const STREAMELEMENTS_VOICES = new Set([
  "Brian", "Amy", "Emma", "Russell", "Nicole", "Joey", "Justin",
  "Matthew", "Joanna", "Salli", "Kimberly", "Kendra", "Ivy", "Mizuki",
  "Geraint", "Raveena", "Chantal", "Celine", "Mathieu", "Marlene",
  "Hans", "Vicki", "Carla", "Conchita", "Enrique", "Liv", "Lotte",
  "Naja", "Maja", "Jacek", "Ewa", "Cristiano", "Vitoria", "Astrid",
  "Tatyana", "Maxim", "Filiz",
]);

async function fetchStreamElements(text: string, voice: string): Promise<Response> {
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
    },
  });
}

export const ttsStreamRoute = new Hono<{ Bindings: Env }>();

async function ttsStreamHandler(c: { req: { method: string; url: string; query: (k: string) => string | undefined; json: <T>() => Promise<T> }; json: (body: unknown, status?: number) => Response }): Promise<Response> {
  let provider = "streamelements";
  let voice = "Brian";
  let text = "";
  if (c.req.method === "GET") {
    provider = c.req.query("provider") || provider;
    voice = c.req.query("voice") || voice;
    text = c.req.query("text") || "";
  } else {
    const body = await c.req.json<{ provider?: string; voice?: string; text?: string }>().catch(() => ({} as { provider?: string; voice?: string; text?: string }));
    provider = body.provider || provider;
    voice = body.voice || voice;
    text = body.text || "";
  }
  if (!text.trim()) return c.json({ error: "no text" }, 400);
  text = text.replace(/```[\s\S]*?```/g, "").replace(/[*_`#\[\]()]/g, "").replace(/\s+/g, " ").trim();
  try {
    if (provider === "streamelements") return await fetchStreamElements(text, voice);
    return c.json({ error: `unknown provider: ${provider}` }, 400);
  } catch (e) {
    return c.json({ error: (e as Error).message || "tts failed" }, 502);
  }
}

ttsStreamRoute.get("/", (c) => ttsStreamHandler(c));
ttsStreamRoute.post("/", (c) => ttsStreamHandler(c));

// ── /api/tts-edge — Google Translate TTS (free) ───────────────────────────

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

function chunkText(text: string, max = 195): string[] {
  const out: string[] = [];
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return out;
  const parts = clean.split(/(?<=[.!?])\s+/);
  let buf = "";
  for (const p of parts) {
    if (p.length > max) {
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

async function fetchGoogleChunk(text: string, lang: string): Promise<ArrayBuffer> {
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${encodeURIComponent(lang)}&client=tw-ob&ttsspeed=1`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Referer: "https://translate.google.com/",
      Accept: "audio/mpeg, audio/*, */*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`google tts ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength < 32) throw new Error("google tts: empty audio");
  return buf;
}

function voiceToLang(voice: string | undefined): string {
  if (!voice) return "en";
  const v = voice.toLowerCase();
  if (v.startsWith("en-gb")) return "en-GB";
  if (v.startsWith("en-us")) return "en-US";
  if (v.startsWith("en-au")) return "en-AU";
  if (v.startsWith("en-ie")) return "en-IE";
  if (v.startsWith("en-in")) return "en-IN";
  if (v.startsWith("en-za")) return "en-ZA";
  if (v.startsWith("en-ca")) return "en-CA";
  if (v.startsWith("en-nz")) return "en-AU";
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

function concatArrayBuffers(bufs: ArrayBuffer[]): ArrayBuffer {
  const total = bufs.reduce((s, b) => s + b.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) {
    out.set(new Uint8Array(b), off);
    off += b.byteLength;
  }
  return out.buffer;
}

export const ttsEdgeRoute = new Hono<{ Bindings: Env }>();

async function ttsEdgeHandler(c: { req: { method: string; query: (k: string) => string | undefined; json: <T>() => Promise<T> }; json: (body: unknown, status?: number) => Response }): Promise<Response> {
  let voice = "en-GB";
  let text = "";
  if (c.req.method === "GET") {
    voice = c.req.query("voice") || voice;
    text = c.req.query("text") || "";
  } else {
    const body = await c.req.json<{ voice?: string; text?: string }>().catch(() => ({} as { voice?: string; text?: string }));
    voice = body.voice || voice;
    text = body.text || "";
  }
  text = text.replace(/```[\s\S]*?```/g, "").replace(/[*_`#\[\]()]/g, "").replace(/\s+/g, " ").trim().slice(0, 3000);
  if (!text) return c.json({ error: "no text" }, 400);
  const lang = voiceToLang(voice);
  try {
    const chunks = chunkText(text);
    if (!chunks.length) return c.json({ error: "no speakable text" }, 400);
    const buffers = await Promise.all(chunks.map((ch) => fetchGoogleChunk(ch, lang)));
    const combined = concatArrayBuffers(buffers);
    return new Response(combined, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(combined.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message || "google tts failed" }, 502);
  }
}

ttsEdgeRoute.get("/", (c) => ttsEdgeHandler(c));
ttsEdgeRoute.post("/", (c) => ttsEdgeHandler(c));

// ── /api/tts-azure — Azure Cognitive Services ──────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function buildSsml(text: string, voice: string, rate: string, pitch: string): string {
  const clean = escapeXml(text).slice(0, 5000);
  const lang = voice.slice(0, 5);
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'><voice name='${voice}'><prosody rate='${rate}' pitch='${pitch}'>${clean}</prosody></voice></speak>`;
}

export const ttsAzureRoute = new Hono<{ Bindings: Env }>();

async function ttsAzureHandler(c: { env: Env; req: { method: string; query: (k: string) => string | undefined; json: <T>() => Promise<T> }; json: (body: unknown, status?: number) => Response }): Promise<Response> {
  const KEY = c.env.AZURE_SPEECH_KEY;
  const REGION = c.env.AZURE_SPEECH_REGION;
  if (!KEY || !REGION) {
    return c.json({
      error: "no_key",
      hint: "Azure Speech not configured. Set AZURE_SPEECH_KEY and AZURE_SPEECH_REGION via `wrangler secret put`.",
    }, 503);
  }

  let voice = "en-GB-RyanNeural";
  let text = "";
  let rate = "0%";
  let pitch = "0Hz";
  if (c.req.method === "GET") {
    voice = c.req.query("voice") || voice;
    text = c.req.query("text") || "";
    rate = c.req.query("rate") || rate;
    pitch = c.req.query("pitch") || pitch;
  } else {
    const body = await c.req.json<{ voice?: string; text?: string; rate?: string; pitch?: string }>().catch(() => ({} as { voice?: string; text?: string; rate?: string; pitch?: string }));
    voice = body.voice || voice;
    text = body.text || "";
    rate = body.rate || rate;
    pitch = body.pitch || pitch;
  }
  text = text.replace(/```[\s\S]*?```/g, "").replace(/[*_`#\[\]()]/g, "").replace(/\s+/g, " ").trim();
  if (!text) return c.json({ error: "no text" }, 400);

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
      return c.json({ error: `azure ${r.status}`, detail: errText.slice(0, 300) }, 502);
    }
    const audio = await r.arrayBuffer();
    if (!audio || audio.byteLength < 100) throw new Error("empty audio");
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e) {
    return c.json({ error: (e as Error).message || "azure tts failed" }, 502);
  }
}

ttsAzureRoute.get("/", (c) => ttsAzureHandler(c));
ttsAzureRoute.post("/", (c) => ttsAzureHandler(c));
