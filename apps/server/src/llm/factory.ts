import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config.js";

/** chat 角色：对话与结构化输出（router/rewrite/grade/generate/chatReply/judge） */
export function makeChatModel() {
  return new ChatOpenAI({
    model: env.CHAT_MODEL,
    apiKey: env.CHAT_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
    configuration: { baseURL: env.CHAT_BASE_URL },
  });
}

/** embedding 角色：入库与查询向量化。dimensions 必须显式——
 * 不同提供商默认维度不一（如智谱 embedding-3 默认 2048），须与 Qdrant 集合 / EMBEDDING_DIM 一致 */
export function makeEmbeddings() {
  return new OpenAIEmbeddings({
    model: env.EMBEDDING_MODEL,
    apiKey: env.EMBEDDING_API_KEY,
    dimensions: env.EMBEDDING_DIM,
    configuration: { baseURL: env.EMBEDDING_BASE_URL },
  });
}

/** rerank 角色：图内重排序打分（temperature 0 保证打分稳定） */
export function makeRerankModel() {
  return new ChatOpenAI({
    model: env.RERANK_MODEL,
    apiKey: env.RERANK_API_KEY,
    temperature: 0,
    maxRetries: 2,
    configuration: { baseURL: env.RERANK_BASE_URL },
  });
}
