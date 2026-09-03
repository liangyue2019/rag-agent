import { z } from "zod";

const Env = z.object({
  ZHIPU_API_KEY: z.string().min(1, "缺少 ZHIPU_API_KEY"),
  ZHIPU_BASE_URL: z.string().default("https://open.bigmodel.cn/api/paas/v4/"),
  CHAT_MODEL: z.string().default("glm-4-flash"),
  EMBEDDING_MODEL: z.string().default("embedding-3"),
  EMBEDDING_DIM: z.coerce.number().default(1024),
  QDRANT_URL: z.string().default("http://localhost:6333"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().default("http://localhost:3000"),
  LANGSMITH_TRACING: z.string().default("false"),
});

export const env = Env.parse(process.env);
