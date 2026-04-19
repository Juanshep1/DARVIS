// Shared time-block helper — appended to every LLM system prompt so the
// model never has to guess the current time.
export function buildTimeBlock(tz: string | undefined): string {
  const d = new Date();
  const userTZ = (typeof tz === "string" && tz.length > 0 && tz.length < 64) ? tz : "America/Chicago";
  let localTime: string;
  let localHour: number;
  try {
    localTime = d.toLocaleString("en-US", {
      timeZone: userTZ,
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: true, timeZoneName: "short",
    });
    localHour = parseInt(d.toLocaleString("en-US", { timeZone: userTZ, hour: "numeric", hour12: false }));
  } catch {
    localTime = d.toLocaleString("en-US", {
      timeZone: "America/Chicago",
      weekday: "long", year: "numeric", month: "long", day: "numeric",
      hour: "numeric", minute: "numeric", hour12: true,
    });
    localHour = parseInt(d.toLocaleString("en-US", { timeZone: "America/Chicago", hour: "numeric", hour12: false }));
  }
  const period = localHour < 6 ? "LATE NIGHT" : localHour < 12 ? "MORNING" : localHour < 17 ? "AFTERNOON" : localHour < 21 ? "EVENING" : "NIGHT";
  return `CURRENT DATE/TIME (ground truth — the REAL time on the user's device, NOT your training cutoff):\n  Date: ${localTime}\n  Period: ${period}\n  Timezone: ${userTZ}\n  Epoch: ${d.getTime()}\nDo NOT guess the time. If asked "what time is it?", answer using this value exactly.`;
}
