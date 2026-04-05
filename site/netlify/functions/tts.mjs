export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { text } = await req.json();
  if (!text) {
    return Response.json({ error: "No text" }, { status: 400 });
  }

  const ELEVENLABS_KEY = Netlify.env.get("ELEVENLABS_API_KEY");
  const VOICE_ID = Netlify.env.get("DARVIS_VOICE_ID") || "kPtEHAvRnjUJFv7SK9WI";

  // Clean text for speech
  let clean = text.replace(/[*_`#\[\]()]/g, "").replace(/\n+/g, ". ");
  if (clean.length > 2000) clean = clean.substring(0, 2000);

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_KEY,
        "Accept": "audio/mpeg",
      },
      body: JSON.stringify({
        text: clean,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.3 },
      }),
    });

    if (!res.ok) {
      return new Response(null, { status: 204 }); // No audio, frontend handles gracefully
    }

    const audioBuffer = await res.arrayBuffer();

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
        "Cache-Control": "no-cache",
      },
    });
  } catch (err) {
    return new Response(null, { status: 204 });
  }
};

export const config = { path: "/api/tts" };
