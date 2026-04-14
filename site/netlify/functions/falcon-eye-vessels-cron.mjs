import { ingestVessels } from "./falcon-eye-vessels-ingest.mjs";

export default async () => ingestVessels(
  new Request("https://darvis1.netlify.app/.netlify/functions/falcon-eye-vessels-cron", {
    method: "GET",
  }),
);

export const config = {
  schedule: "*/1 * * * *",
};
