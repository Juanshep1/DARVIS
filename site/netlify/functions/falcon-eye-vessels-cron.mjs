// Scheduled wrapper — runs the AISStream ingest every minute by importing
// the handler from falcon-eye-vessels-ingest.mjs and invoking it with a
// synthetic Request object. Lives in its own file because Netlify config
// can have either `path` or `schedule`, never both.

import ingestHandler from "./falcon-eye-vessels-ingest.mjs";

export default async () => {
  const fakeReq = new Request(
    "https://internal.local/api/falcon-eye/vessels-ingest?window=20",
    { method: "GET" }
  );
  try {
    const res = await ingestHandler(fakeReq);
    // Surface the status to the cron run log
    if (res && typeof res.text === "function") {
      const body = await res.text().catch(() => "");
      return new Response(body || "ok", { status: res.status || 200 });
    }
    return new Response("ok", { status: 200 });
  } catch (e) {
    return new Response(`cron ingest error: ${e?.message || e}`, { status: 500 });
  }
};

export const config = {
  schedule: "*/1 * * * *",
};
