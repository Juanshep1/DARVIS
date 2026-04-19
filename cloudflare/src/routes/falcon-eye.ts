import { Hono } from "hono";
import type { Env } from "../env";
import { feStaticRoutes } from "./falcon-eye/static";
import { feCamsRoutes } from "./falcon-eye/cams";
import { feFlightsRoutes } from "./falcon-eye/flights";
import { feNewsRoutes } from "./falcon-eye/news";

// All Falcon Eye API endpoints mounted under /api/falcon-eye/*.
// Split across sub-files for maintainability but exposed as a single
// router so the frontend URLs don't change.
export const falconEyeRoutes = new Hono<{ Bindings: Env }>();

falconEyeRoutes.route("/", feStaticRoutes);
falconEyeRoutes.route("/", feCamsRoutes);
falconEyeRoutes.route("/", feFlightsRoutes);
falconEyeRoutes.route("/", feNewsRoutes);

falconEyeRoutes.all("*", (c) => c.json({ error: "falcon-eye: route not found", path: c.req.path }, 404));
