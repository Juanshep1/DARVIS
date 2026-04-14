// Curated mapping of news broadcaster → live stream URL.
// Used by Falcon Eye to let an analyst tap an intel item and watch the
// live broadcast from the source outlet inline.
//
// All embeds are public 24/7 live channels published by the broadcasters
// themselves on their official YouTube live channels (which is the
// industry-standard distribution path for free worldwide live news), or
// on their own iframe-embeddable live pages where available.

// Use the YouTube channel live_stream embed format. YouTube auto-resolves
// it to whatever the channel is currently broadcasting live, which is FAR
// more reliable than hardcoding video IDs (the previous direct-video IDs
// were stale or geo-blocked, so the iframe loaded but showed nothing).
//
// Format: https://www.youtube.com/embed/live_stream?channel=<UC...>&autoplay=1&mute=1
const yt = (channelId) =>
  `https://www.youtube.com/embed/live_stream?channel=${channelId}&autoplay=1&mute=1`;

const BROADCASTS = {
  bbc:        { name: "BBC News",            region: "UK",       kind: "iframe", url: yt("UC16niRr50-MSBwiO3YDb3RA") },
  aljazeera:  { name: "Al Jazeera English",  region: "Qatar",    kind: "iframe", url: yt("UCNye-wNBqNL5ZzHSJj3l8Bg") },
  france24:   { name: "France 24 English",   region: "France",   kind: "iframe", url: yt("UCQfwfsi5VrQ8yKZ-UWmAEFg") },
  dw:         { name: "DW News",             region: "Germany",  kind: "iframe", url: yt("UCknLrEdhRCp1aegoMqRaCZg") },
  skynews:    { name: "Sky News",            region: "UK",       kind: "iframe", url: yt("UCoMdktPbSTixAyNGwb-UYkQ") },
  cnn:        { name: "CNN",                 region: "USA",      kind: "iframe", url: "https://www.cnn.com/live-tv" },
  ap:         { name: "Associated Press",    region: "USA",      kind: "iframe", url: yt("UCH1oRy1dINbMVp3UFWrKP0w") },
  nhk:        { name: "NHK World",           region: "Japan",    kind: "iframe", url: "https://www3.nhk.or.jp/nhkworld/en/live/" },
  cna:        { name: "Channel NewsAsia",    region: "Singapore",kind: "iframe", url: yt("UCXcAUwoarMzqZW2RPN3-vTw") },
  abcau:      { name: "ABC News Australia",  region: "Australia",kind: "iframe", url: yt("UcVgPSjAKqDmkVcqjJDzbe6Q") },
  abcus:      { name: "ABC News Live",       region: "USA",      kind: "iframe", url: yt("UCBi2mrWuNuyYy4gbM6fU18Q") },
  cbs:        { name: "CBS News",            region: "USA",      kind: "iframe", url: yt("UC8p1vwvWtl6T73JiExfWs1g") },
  nbc:        { name: "NBC News NOW",        region: "USA",      kind: "iframe", url: yt("UCeY0bbntWzzVIaj2z3QigXg") },
  reuters:    { name: "Reuters",             region: "UK",       kind: "iframe", url: "https://www.reuters.com/video/" },
  guardian:   { name: "The Guardian",        region: "UK",       kind: "iframe", url: "https://www.theguardian.com/world/series/guardian-live" },
  nyt:        { name: "The New York Times",  region: "USA",      kind: "iframe", url: "https://www.nytimes.com/video" },
  toi:        { name: "Times of India",      region: "India",    kind: "iframe", url: yt("UCttspZesZIDEwwpVIgoZtWQ") },
  wion:       { name: "WION",                region: "India",    kind: "iframe", url: yt("UC_gUM8rL-Lrg6O3adPW9K1g") },
  kyiv:       { name: "Kyiv Independent",    region: "Ukraine",  kind: "iframe", url: "https://kyivindependent.com/" },
  toi_il:     { name: "Times of Israel",     region: "Israel",   kind: "iframe", url: "https://www.timesofisrael.com/" },
  i24:        { name: "i24NEWS English",     region: "Israel",   kind: "iframe", url: yt("UCmkMsJqg-2_KHA46BLNdYNw") },
  euronews:   { name: "Euronews English",    region: "Europe",   kind: "iframe", url: yt("UCSrZ3UV4jOidv8ppoVuvW9Q") },
  bloomberg:  { name: "Bloomberg",           region: "USA",      kind: "iframe", url: yt("UCIALMKvObZNtJ6AmdCLP7Lg") },
};

// Loose-match: convert a noisy source string ("BBC News", "bbc.co.uk",
// "BBC", "bbc.com") to a known channel id.
function matchChannel(input) {
  if (!input) return null;
  const s = String(input).toLowerCase();
  if (s.includes("bbc")) return "bbc";
  if (s.includes("guardian")) return "guardian";
  if (s.includes("al jazeera") || s.includes("aljazeera")) return "aljazeera";
  if (s.includes("france 24") || s.includes("france24")) return "france24";
  if (s === "dw" || s.includes("deutsche welle") || s.includes("dw.com") || s.includes("dw news")) return "dw";
  if (s.includes("cnn")) return "cnn";
  if (s.includes("sky news") || s.includes("skynews")) return "skynews";
  if (s.includes("new york times") || s.includes("nytimes") || s === "nyt") return "nyt";
  if (s.includes("reuters")) return "reuters";
  if (s.includes("associated press") || s === "ap" || s.includes("apnews")) return "ap";
  if (s.includes("nhk")) return "nhk";
  if (s.includes("channel news asia") || s.includes("channel newsasia") || s.includes("cna")) return "cna";
  if (s.includes("abc news") && (s.includes("australia") || s.includes("au"))) return "abcau";
  if (s.includes("times of india") || s.includes("timesofindia") || s.includes("toi")) return "toi";
  if (s.includes("kyiv independent")) return "kyiv";
  if (s.includes("times of israel") || s.includes("timesofisrael")) return "toi_il";
  if (s.includes("i24")) return "i24";
  if (s.includes("euronews")) return "euronews";
  if (s.includes("bloomberg")) return "bloomberg";
  if (s.includes("wion")) return "wion";
  if (s.includes("cbs news") || s === "cbsnews" || s.includes("cbsnews.com")) return "cbs";
  if (s.includes("nbc news") || s === "nbcnews" || s.includes("nbcnews.com")) return "nbc";
  if (s.includes("abc news") && !s.includes("australia") && !s.includes("au")) return "abcus";
  return null;
}

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  const source = url.searchParams.get("source");

  if (id && BROADCASTS[id]) {
    return Response.json({ id, ...BROADCASTS[id] });
  }
  if (source) {
    const match = matchChannel(source);
    if (match && BROADCASTS[match]) return Response.json({ id: match, ...BROADCASTS[match] });
    return Response.json({ id: null, error: `no broadcast for source: ${source}` }, { status: 404 });
  }
  // No params → return the full directory
  return Response.json({ broadcasts: BROADCASTS, count: Object.keys(BROADCASTS).length });
};

export const config = { path: "/api/falcon-eye/broadcasts" };
