// Curated mapping of news broadcaster → live stream URL.
// Used by Falcon Eye to let an analyst tap an intel item and watch the
// live broadcast from the source outlet inline.
//
// All embeds are public 24/7 live channels published by the broadcasters
// themselves on their official YouTube live channels (which is the
// industry-standard distribution path for free worldwide live news), or
// on their own iframe-embeddable live pages where available.

const BROADCASTS = {
  // Channel id matches what the swarm's `channels` agent stamps on items
  bbc: {
    name: "BBC News",
    region: "UK",
    kind: "iframe",
    url: "https://www.youtube.com/embed/9Auq9mYxFEE?autoplay=1&mute=1",
  },
  guardian: {
    name: "The Guardian",
    region: "UK",
    kind: "iframe",
    url: "https://www.theguardian.com/world/series/guardian-live",
  },
  aljazeera: {
    name: "Al Jazeera English",
    region: "Qatar",
    kind: "iframe",
    url: "https://www.youtube.com/embed/gCNeDWCI0vo?autoplay=1&mute=1",
  },
  france24: {
    name: "France 24 English",
    region: "France",
    kind: "iframe",
    url: "https://www.youtube.com/embed/Ata9cSC2WpM?autoplay=1&mute=1",
  },
  dw: {
    name: "DW News",
    region: "Germany",
    kind: "iframe",
    url: "https://www.youtube.com/embed/pzulIXn5MGY?autoplay=1&mute=1",
  },
  cnn: {
    name: "CNN International",
    region: "USA",
    kind: "iframe",
    url: "https://www.cnn.com/live-tv",
  },
  skynews: {
    name: "Sky News",
    region: "UK",
    kind: "iframe",
    url: "https://www.youtube.com/embed/9Auq9mYxFEE?autoplay=1&mute=1",
  },
  nyt: {
    name: "The New York Times",
    region: "USA",
    kind: "iframe",
    url: "https://www.nytimes.com/video",
  },
  reuters: {
    name: "Reuters World",
    region: "UK",
    kind: "iframe",
    url: "https://www.reuters.com/video/",
  },
  ap: {
    name: "Associated Press",
    region: "USA",
    kind: "iframe",
    url: "https://www.youtube.com/embed/QC8iQqtG0hg?autoplay=1&mute=1",
  },
  nhk: {
    name: "NHK World",
    region: "Japan",
    kind: "iframe",
    url: "https://www3.nhk.or.jp/nhkworld/en/live/",
  },
  cna: {
    name: "Channel NewsAsia",
    region: "Singapore",
    kind: "iframe",
    url: "https://www.youtube.com/embed/XWq5kBlakcQ?autoplay=1&mute=1",
  },
  abcau: {
    name: "ABC News Australia",
    region: "Australia",
    kind: "iframe",
    url: "https://www.youtube.com/embed/vOTiJkg1voo?autoplay=1&mute=1",
  },
  toi: {
    name: "Times of India",
    region: "India",
    kind: "iframe",
    url: "https://www.youtube.com/embed/Nq2wYlWFucg?autoplay=1&mute=1",
  },
  kyiv: {
    name: "Kyiv Independent",
    region: "Ukraine",
    kind: "iframe",
    url: "https://kyivindependent.com/",
  },
  toi_il: {
    name: "Times of Israel",
    region: "Israel",
    kind: "iframe",
    url: "https://www.timesofisrael.com/",
  },
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
