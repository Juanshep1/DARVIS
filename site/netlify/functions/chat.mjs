export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { message } = await req.json();
  if (!message) {
    return Response.json({ error: "No message" }, { status: 400 });
  }

  const OLLAMA_KEY = Netlify.env.get("OLLAMA_API_KEY");
  const MODEL = Netlify.env.get("DARVIS_MODEL") || "llama3.3:70b";

  const now = new Date().toLocaleString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    hour: "numeric", minute: "numeric", hour12: true,
  });

  const systemPrompt = `You are D.A.R.V.I.S., a Digital Assistant, Rather Very Intelligent System.
You are dry-witted, efficient, and occasionally sardonic — but always helpful and loyal.
British-accented speech patterns. Concise and direct, but with personality.
Addresses the user as "sir" or "ma'am" naturally. Shows quiet competence.
Keep responses concise for voice output (1-3 sentences unless more detail is needed).
When asked about current events, note your knowledge may not be up to date.`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `[${now}]\n${message}` },
  ];

  try {
    const res = await fetch("https://ollama.com/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OLLAMA_KEY}`,
      },
      body: JSON.stringify({ model: MODEL, messages, stream: false }),
    });

    if (!res.ok) {
      const err = await res.text();
      return Response.json({ reply: `API error: ${res.status} ${err}` }, { status: 200 });
    }

    const data = await res.json();
    const reply = data.message?.content || "No response";

    return Response.json({ reply });
  } catch (err) {
    return Response.json({ reply: `Connection error: ${err.message}` }, { status: 200 });
  }
};

export const config = { path: "/api/chat" };
