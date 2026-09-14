import "dotenv/config";
import { z } from "zod";
import { makeChatModel, makeEmbeddings } from "../src/llm/factory.js";
import { env } from "../src/config.js";

const isPlaceholder = (k: string) => !k || k === "sk-placeholder";
if (isPlaceholder(env.CHAT_API_KEY) || isPlaceholder(env.EMBEDDING_API_KEY)) {
  console.log("[SKIP] CHAT_API_KEY 或 EMBEDDING_API_KEY 未配置真实 key，冒烟测试待用户提供 key 后执行：corepack pnpm --filter server exec tsx scripts/smoke-llm.ts");
  process.exit(0);
}

const chat = makeChatModel().withStructuredOutput(z.object({ ok: z.boolean() }));
const r = await chat.invoke("请返回 {ok: true}");
console.log("chat:", JSON.stringify(r));

const emb = makeEmbeddings();
const v = await emb.embedQuery("连通性测试");
console.log("embedding dim:", v.length);
if (v.length !== env.EMBEDDING_DIM) throw new Error(`维度不符: ${v.length}（期望 ${env.EMBEDDING_DIM}）`);
console.log("[OK] LLM 与 Embedding 连通性验证通过");
