import { ChatOpenAI, OpenAIEmbeddings } from "@langchain/openai";
import { env } from "../config.js";

export function makeChatModel() {
  return new ChatOpenAI({
    model: env.CHAT_MODEL,
    apiKey: env.ZHIPU_API_KEY,
    temperature: 0.2,
    maxRetries: 2,
    configuration: { baseURL: env.ZHIPU_BASE_URL },
  });
}

export function makeEmbeddings() {
  return new OpenAIEmbeddings({
    model: env.EMBEDDING_MODEL,
    apiKey: env.ZHIPU_API_KEY,
    // 智谱 embedding-3 默认 2048 维，显式指定以与 Qdrant 集合 dense size / EMBEDDING_DIM 保持一致
    dimensions: env.EMBEDDING_DIM,
    configuration: { baseURL: env.ZHIPU_BASE_URL },
  });
}
