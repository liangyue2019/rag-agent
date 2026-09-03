import "dotenv/config";
import express from "express";
import cors from "cors";
import { env } from "./config.js";
import { logger } from "./logger.js";
import { ensureCollection } from "./qdrant/client.js";
import { documentsRouter } from "./routes/documents.js";
import { retrievalTestRouter } from "./routes/retrieval-test.js";
const app = express();
app.use(cors({ origin: env.WEB_URL }));
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api/documents", documentsRouter);
app.use("/api/retrieval/test", retrievalTestRouter);

await ensureCollection();

app.listen(env.PORT, () => logger.info(`server listening on :${env.PORT}`));
