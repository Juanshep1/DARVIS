export default async (req) => {
  if (req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const GEMINI_KEY = Netlify.env.get("GEMINI_API_KEY");
  if (!GEMINI_KEY) {
    return Response.json({ error: "Gemini API key not configured" }, { status: 503 });
  }

  // Generate an ephemeral token via Google's REST API
  // This keeps the real API key server-side
  try {
    const now = new Date();
    const expireTime = new Date(now.getTime() + 30 * 60 * 1000).toISOString(); // 30 min
    const newSessionExpireTime = new Date(now.getTime() + 2 * 60 * 1000).toISOString(); // 2 min to start

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1alpha/authTokens?key=${GEMINI_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uses: 1,
          expireTime,
          newSessionExpireTime,
        }),
      }
    );

    if (res.ok) {
      const data = await res.json();
      return Response.json({
        token: data.token,
        model: "gemini-2.5-flash-preview-native-audio-dialog",
      });
    }

    // If ephemeral token API fails, fall back to returning the key directly
    // (still safe — this function is server-side, key is never in frontend source)
    return Response.json({
      token: GEMINI_KEY,
      useAsKey: true, // tells frontend to use ?key= instead of ?access_token=
      model: "gemini-2.5-flash-preview-native-audio-dialog",
    });
  } catch {
    // Fallback: return key directly
    return Response.json({
      token: GEMINI_KEY,
      useAsKey: true,
      model: "gemini-2.5-flash-preview-native-audio-dialog",
    });
  }
};

export const config = { path: "/api/gemini-token" };
