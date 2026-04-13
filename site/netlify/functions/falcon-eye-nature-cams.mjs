// Curated live nature / space / institutional cameras that specifically
// allow iframe embedding (no X-Frame-Options blocks). These are *live*,
// not timelapses.

const NATURE_CAMS = [
  // NASA / Space
  { id: "nasa-iss", label: "ISS Live HD Earth View", lat: 28.5721, lon: -80.6480,
    kind: "iframe", url: "https://www.ustream.tv/embed/17074538?html5ui=1&autoplay=1", source: "nasa" },
  { id: "nasa-ksc", label: "Kennedy Space Center Live", lat: 28.5721, lon: -80.6480,
    kind: "iframe", url: "https://www.ustream.tv/embed/9408562?html5ui=1&autoplay=1", source: "nasa" },
  { id: "nasa-jpl", label: "JPL Mission Control Mars", lat: 34.2013, lon: -118.1712,
    kind: "iframe", url: "https://www.ustream.tv/embed/6540154?html5ui=1&autoplay=1", source: "nasa" },

  // Explore.org — wildlife / nature (iframe embed endpoint)
  { id: "exp-alaska-bears", label: "Alaska Brooks Falls Brown Bears", lat: 58.5546, lon: -155.7800,
    kind: "iframe", url: "https://explore.org/livecams/brown-bears/brown-bear-salmon-cam-brooks-falls", source: "explore" },
  { id: "exp-africa", label: "Africam — Tembe Elephant Park", lat: -26.9500, lon: 32.4167,
    kind: "iframe", url: "https://explore.org/livecams/african-wildlife/africam-tembe-elephant-park", source: "explore" },
  { id: "exp-puffins", label: "Puffin Burrow, Maine", lat: 43.8791, lon: -68.8708,
    kind: "iframe", url: "https://explore.org/livecams/puffins/puffin-burrow-cam", source: "explore" },
  { id: "exp-sea-otters", label: "Monterey Bay Sea Otters", lat: 36.6178, lon: -121.9015,
    kind: "iframe", url: "https://explore.org/livecams/aquariums/monterey-bay-otter-cam", source: "explore" },
  { id: "exp-sharks", label: "Monterey Bay Kelp Forest", lat: 36.6178, lon: -121.9015,
    kind: "iframe", url: "https://explore.org/livecams/aquariums/monterey-bay-aquarium-kelp-cam", source: "explore" },
  { id: "exp-pandas", label: "Smithsonian Panda Cam", lat: 38.9296, lon: -77.0500,
    kind: "iframe", url: "https://explore.org/livecams/zoos/panda-cam", source: "explore" },
  { id: "exp-wolves", label: "International Wolf Center", lat: 47.9028, lon: -91.8655,
    kind: "iframe", url: "https://explore.org/livecams/wolves/wolf-cam", source: "explore" },
  { id: "exp-bison", label: "Yellowstone Old Faithful", lat: 44.4605, lon: -110.8281,
    kind: "iframe", url: "https://www.nps.gov/yell/learn/photosmultimedia/webcams.htm", source: "nps" },

  // Port cams
  { id: "port-rotterdam", label: "Port of Rotterdam", lat: 51.9497, lon: 4.1333,
    kind: "iframe", url: "https://www.portofrotterdam.com/en/webcam", source: "ports" },
];

export default async (req) => {
  if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
  return Response.json({ cams: NATURE_CAMS, source: "nature", ts: Date.now() });
};

export const config = { path: "/api/falcon-eye/nature-cams" };
