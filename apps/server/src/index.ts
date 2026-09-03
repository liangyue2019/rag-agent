import "dotenv/config";
import express from "express";
import cors from "cors";
import pino from "pino";
import { env } from "./config.js";
import { ensureCollection } from "./qdrant/client.js";

export const logger = pino({ transport: { target: "pino-pretty" } });
const app = express();
app.use(cors({ origin: env.WEB_URL }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

await ensureCollection();

app.listen(env.PORT, () => logger.info(`server listening on :${env.PORT}`));
