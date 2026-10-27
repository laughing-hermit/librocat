import rateLimiter from "@convex-dev/rate-limiter/convex.config.js";
import { defineApp } from "convex/server";
import betterAuth from "./betterAuth/convex.config";

const app = defineApp();
app.use(betterAuth);
// Each plan's calls a minute and its monthly ceilings (limits.ts).
app.use(rateLimiter);

export default app;
