import { z } from "zod";

/** LLM 角色化配置：chat / embedding / rerank 三角色各自独立指定
 * model + OpenAI 兼容端点 + apiKey，不限定厂商（智谱/DeepSeek/Kimi/Qwen/Ollama 均可）。
 * 三个 MODEL 均为必填——不给任何厂商默认值，避免 baseURL 与模型名不匹配。 */
const Env = z.object({
  // chat 角色：对话与结构化输出（router/rewrite/grade/generate/chatReply/judge）
  CHAT_MODEL: z.string().min(1, "缺少 CHAT_MODEL（chat 角色的模型 id）"),
  CHAT_BASE_URL: z.string().min(1, "缺少 CHAT_BASE_URL（chat 角色的 OpenAI 兼容端点）"),
  CHAT_API_KEY: z.string().min(1, "缺少 CHAT_API_KEY"),
  /** 透传到 chat 请求体的额外字段（JSON 对象），用于适配各厂商差异。
   * 例：DeepSeek-V4.1-Flash 默认思考模式会拒绝强制 tool_choice，需 `{"thinking":{"type":"disabled"}}` */
  CHAT_EXTRA_BODY: z.string().default("").refine(
    (v) => {
      if (!v) return true;
      try {
        const parsed = JSON.parse(v);
        return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
      } catch {
        return false;
      }
    },
    { message: "CHAT_EXTRA_BODY 必须是合法 JSON 对象字符串" },
  ),

  // embedding 角色：入库与查询向量化（维度须与 Qdrant 集合 dense size 一致，换模型需重建集合）
  EMBEDDING_MODEL: z.string().min(1, "缺少 EMBEDDING_MODEL（embedding 角色的模型 id）"),
  EMBEDDING_BASE_URL: z.string().min(1, "缺少 EMBEDDING_BASE_URL（embedding 角色的 OpenAI 兼容端点）"),
  EMBEDDING_API_KEY: z.string().min(1, "缺少 EMBEDDING_API_KEY"),
  EMBEDDING_DIM: z.coerce.number().default(1024),

  // rerank 角色：图内重排序节点打分
  RERANK_MODEL: z.string().min(1, "缺少 RERANK_MODEL（rerank 角色的模型 id）"),
  RERANK_BASE_URL: z.string().min(1, "缺少 RERANK_BASE_URL（rerank 角色的 OpenAI 兼容端点）"),
  RERANK_API_KEY: z.string().min(1, "缺少 RERANK_API_KEY"),

  QDRANT_URL: z.string().default("http://localhost:6333"),
  DATABASE_URL: z.string().default("file:./data/app.db"),
  PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().default("http://localhost:3000"),
  LANGSMITH_TRACING: z.string().default("false"),
});

export const env = Env.parse(process.env);
