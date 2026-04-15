// Microsoft Edge Read-Aloud TTS proxy — genuinely natural neural voices,
// free, no API key, no signup. Uses the same WebSocket endpoint the
// Edge browser's Read Aloud feature hits, with the community-known
// trusted client token.
//
// GET  /api/tts-edge?voice=en-GB-RyanNeural&text=hello
// POST { voice, text, rate, pitch }
//
// Audio format: audio-24khz-48kbitrate-mono-mp3

import WebSocket from "ws";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const ENDPOINT = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

function nowTimestamp() {
  // Windows File Time style — MS uses this format
  return new Date().toString().replace(/\([^)]+\)$/, "").trim() + " GMT+0000 (Coordinated Universal Time)";
}

function uuid() {
  return crypto.randomUUID().replace(/-/g, "");
}

function escapeXml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildSsml(text, voice, rate, pitch) {
  const clean = escapeXml(text).slice(0, 3000);
  const lang = voice.slice(0, 5); // en-GB, en-US, etc.
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${lang}'>` +
    `<voice name='${voice}'>` +
    `<prosody pitch='${pitch}' rate='${rate}' volume='+0%'>` +
    clean +
    `</prosody></voice></speak>`;
}

function synthesize({ text, voice, rate = "+0%", pitch = "+0Hz" }) {
  return new Promise((resolve, reject) => {
    const reqId = uuid();
    const ws = new WebSocket(ENDPOINT, {
      headers: {
        "User-Agent": USER_AGENT,
        "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
      },
      timeout: 15000,
    });

    const chunks = [];
    let settled = false;
    const settle = (fn, val) => { if (!settled) { settled = true; try { ws.close(); } catch {} fn(val); } };
    const timer = setTimeout(() => settle(reject, new Error("edge tts timeout")), 20000);

    ws.on("open", () => {
      // 1) Audio config message
      const config = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
              outputFormat: "audio-24khz-48kbitrate-mono-mp3",
            },
          },
        },
      };
      const configMsg =
        `X-Timestamp:${nowTimestamp()}\r\n` +
        `Content-Type:application/json; charset=utf-8\r\n` +
        `Path:speech.config\r\n\r\n` +
        JSON.stringify(config);
      ws.send(configMsg);

      // 2) SSML message
      const ssml = buildSsml(text, voice, rate, pitch);
      const ssmlMsg =
        `X-RequestId:${reqId}\r\n` +
        `Content-Type:application/ssml+xml\r\n` +
        `X-Timestamp:${nowTimestamp()}\r\n` +
        `Path:ssml\r\n\r\n` +
        ssml;
      ws.send(ssmlMsg);
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary && Buffer.isBuffer(data)) {
        // Binary frame — first 2 bytes are the header length big-endian,
        // then that many bytes of text header, then raw audio bytes.
        if (data.length < 2) return;
        const headerLen = data.readUInt16BE(0);
        const header = data.slice(2, 2 + headerLen).toString("utf8");
        if (header.toLowerCase().includes("path:audio")) {
          const audio = data.slice(2 + headerLen);
          if (audio.length) chunks.push(audio);
        }
      } else {
        // Text frame — check for end-of-turn
        const msg = data.toString();
        if (msg.includes("Path:turn.end")) {
          clearTimeout(timer);
          settle(resolve, Buffer.concat(chunks));
        }
      }
    });

    ws.on("error", (err) => { clearTimeout(timer); settle(reject, err); });
    ws.on("close", () => { clearTimeout(timer); if (!settled) settle(resolve, Buffer.concat(chunks)); });
  });
}

export default async (req) => {
  let voice = "en-GB-RyanNeural";
  let text = "";
  let rate = "+0%";
  let pitch = "+0Hz";

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

  // Clean up markdown / emoji
  text = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[*_`#\[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return Response.json({ error: "no text" }, { status: 400 });

  try {
    const audio = await synthesize({ text, voice, rate, pitch });
    if (!audio || !audio.length) throw new Error("empty audio from edge tts");
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.length),
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return Response.json({ error: e?.message || "edge tts failed" }, { status: 502 });
  }
};

export const config = { path: "/api/tts-edge" };
