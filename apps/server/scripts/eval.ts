import "dotenv/config";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { hybridSearch } from "../src/retrieval/hybrid.js";
import { makeChatModel } from "../src/llm/factory.js";

interface EvalItem { id: string; question: string; expectedKeywords: string[]; source: string }

const key = process.env.ZHIPU_API_KEY ?? "";
if (!key || key === "sk-placeholder") {
  console.log("[SKIP] ZHIPU_API_KEY 未配置真实 key。评测需真实 LLM/Embedding 调用。");
  console.log("       配置后运行：corepack pnpm --filter server eval");
  process.exit(0);
}

const datasetPath = join(import.meta.dirname, "../../../eval/dataset.json");
const dataset: EvalItem[] = JSON.parse(readFileSync(datasetPath, "utf-8"));
const TOP_K = 5;

// ---- 指标1：召回率@K（检索层，直接调 hybridSearch）----
let hit = 0, total = 0;
const results: Array<{ id: string; recall: boolean }> = [];
for (const item of dataset) {
  if (item.source === "chat" || item.source === "fallback") continue;
  total++;
  const hits = await hybridSearch(item.question, TOP_K);
  const ok = hits.some((h) => item.expectedKeywords.some((k) => h.content.includes(k)));
  if (ok) hit++;
  results.push({ id: item.id, recall: ok });
  console.log(`${ok ? "✅" : "❌"} [${item.id}] ${item.question} → top1: ${hits[0]?.docTitle ?? "无"}`);
}
console.log(`\n召回率@${TOP_K}: ${hit}/${total} = ${total ? (hit / total * 100).toFixed(1) : 0}%`);

// ---- 指标2：忠实度（LLM-as-judge，对可召回问题走 HTTP 完整问答）----
// 服务需已启动（localhost:3001）：POST /api/chat 收集 SSE 文本与 citations
const judge = makeChatModel().withStructuredOutput(
  z.object({ score: z.number().min(1).max(5), reason: z.string() }),
);

async function askChat(content: string): Promise<{ answer: string; citations: Array<{ preview: string }> }> {
  const res = await fetch("http://localhost:3001/api/chat", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  // 解析 SSE（UIMessage Stream：data: {json} 每行，text-delta 携带 delta，data-citations 携带 data 数组）
  const body = await res.text();
  let answer = ""; let citations: Array<{ preview: string }> = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice(6);
    if (payload === "[DONE]") continue;
    try {
      const ev = JSON.parse(payload);
      if (ev.type === "text-delta") answer += ev.delta;
      if (ev.type === "data-citations" && Array.isArray(ev.data)) citations = ev.data;
    } catch { /* 忽略非 JSON 行 */ }
  }
  return { answer, citations };
}

const faithful: Array<{ id: string; score: number; reason: string }> = [];
const recallable = results.filter((r) => r.recall).slice(0, 5);
for (const r of recallable) {
  const item = dataset.find((d) => d.id === r.id)!;
  try {
    const { answer, citations } = await askChat(item.question);
    if (!answer) { console.log(`⚠️ [${item.id}] 问答无输出（服务未启动或出错），跳过忠实度`); continue; }
    const { score, reason } = await judge.invoke([
      { role: "system", content: "你是评审。判断客服回答是否完全由给定的引用资料支持（忠实度，不评好坏只评有无编造）。输出 score(1-5) 与 reason（中文一句话）。" },
      { role: "user", content: `引用资料：\n${citations.map((c) => c.preview).join("\n")}\n\n回答：${answer}` },
    ]);
    faithful.push({ id: item.id, score, reason });
    console.log(`⚖️ [${item.id}] 忠实度 ${score}/5 — ${reason}`);
  } catch (e) {
    console.log(`⚠️ [${item.id}] 忠实度评测失败：${e instanceof Error ? e.message : e}`);
  }
}
if (faithful.length) {
  const avg = faithful.reduce((s, f) => s + f.score, 0) / faithful.length;
  console.log(`\n忠实度均分：${avg.toFixed(1)} / 5（${faithful.length} 条）`);
}
console.log("\n[提示] 完整结果请记入 docs/eval/ 报告。dataset 的 expectedKeywords 应按实际入库知识调整。");
