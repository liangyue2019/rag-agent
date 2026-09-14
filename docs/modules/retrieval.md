# 混合检索（retrieval）

> 源码：`apps/server/src/retrieval/hybrid.ts`（混合检索，约 40 行）、`apps/server/src/retrieval/rerank.ts`（DeepSeek LLM 重排序）
> 依赖：`apps/server/src/ingest/bm25.ts`（分词与查询侧稀疏向量）、`apps/server/src/qdrant/client.ts`、`apps/server/src/db/schema.ts`、`apps/server/src/llm/factory.ts`（rerank 用 `makeRerankModel()`）

## 职责与边界

提供两个检索函数：

- `hybridSearch(query, topK)`（`hybrid.ts`）：**dense（智谱 embedding-3 语义向量）+ sparse（自实现 BM25 词项向量）双路召回，Qdrant 服务端 RRF 融合**，返回业务侧统一的 `RetrievedDoc[]`；
- `rerankDocs(query, docs)`（`rerank.ts`）：DeepSeek LLM 二阶段精排——对召回候选逐条打 0-10 相关性分，降序重排（同分稳定）并剪除低分（阈值 `RERANK_MIN_SCORE = 3`）。它只被 graph 的 rerank 节点调用（位于 retrieve 与 grade 之间）；`hybridSearch` 本身不含 rerank，检索测试控制台看到的仍是 RRF 原始排序（见"已知限制与扩展点"）。

边界：不负责多查询改写与合并去重（由 graph 的 retrieve 节点做，见下文"调用方"）、不做引用编号（generate 节点做）。

检索目标为 Qdrant 集合 `kb_chunks`（`apps/server/src/qdrant/client.ts`）：命名向量 `dense`（1024 维，Cosine，`EMBEDDING_DIM` 可配）+ 稀疏向量 `sparse`；payload 含 `chunkId` / `documentId` / `docTitle` / `sourceType` / `sourceRef` / `seq` / `content`（FAQ 另有 `faqQ` / `faqA`），由 ingest 侧写入（见 `docs/modules/ingest.md`）。

## 核心设计：双路 prefetch + 服务端 RRF

```ts
const result = await qdrant.query(COLLECTION, {
  prefetch: [
    { query: dense,   using: "dense",   limit: 20 },
    { query: sparse,  using: "sparse",  limit: 20 },
  ],
  query: { fusion: "rrf" },
  limit: topK,
  with_payload: true,
});
```

- **dense 路**：`embedQuery(query)` 得 1024 维向量，在 Qdrant 内按 Cosine 近邻取 20。
- **sparse 路**：BM25 查询向量（构建见下文"数据依赖"），按稀疏点积取 20。
- **RRF（Reciprocal Rank Fusion）**：Qdrant 服务端对两路结果的**排名**（而非原始分数）做倒数加权融合，标准形式 `score(d) = Σ 1/(k + rank_i(d))`（k 为平滑常数，对两路命中分别求和）。选 RRF 的原因：
  1. dense 的 Cosine 分数与 sparse 的 BM25 点积分数量纲完全不同，RRF 只用排名，**无需调分数量纲/归一化**；
  2. 融合在 Qdrant 内一次请求完成，**无需独立 rerank 模型**（省一次网络往返与模型成本；设计文档明确"独立 rerank 模型（用 Qdrant RRF 融合替代，预留扩展点）"）——该取舍针对双路融合内部；图层面后置的 LLM 精排已按该扩展点另行落地为 `rerank.ts`（见下文"调用方"）。

### 执行时序（hybridSearch 内部）

```
① Promise.all ─┬─ embedQuery(query)              → dense: number[1024]   （智谱 API）
                └─ db.select().from(bm25Df)       → dfRows（全表）
② dfMap = new Map(dfRows.map(r => [r.word, r.df]))
③ qdrant.count(COLLECTION, { exact: true })      → totalDocs（N）
④ sparse = buildQuerySparse(tokenize(query), dfMap, totalDocs)
⑤ qdrant.query：prefetch[dense 20, sparse 20] + fusion rrf + limit topK
⑥ result.points.map(payload → RetrievedDoc)
```

①中两步并行（互不依赖）；③必须先于④（idf 需要 N）；⑤一次请求完成双路召回与融合。

## 对外接口

```ts
export async function hybridSearch(query: string, topK = 5): Promise<RetrievedDoc[]>
```

`RetrievedDoc` 定义于 `packages/shared/src/index.ts`，字段从 Qdrant payload 逐一映射：

| Qdrant payload | RetrievedDoc 字段 | 说明 |
|---|---|---|
| `chunkId` | `chunkId: string` | 业务侧 chunk 标识（SQLite `chunks.id`） |
| `documentId` | `documentId: string` | 所属文档 |
| `docTitle` | `docTitle: string` | 文档标题 |
| `sourceType` | `sourceType: "file" \| "url" \| "faq"` | 直接 as 断言 |
| `sourceRef` | `sourceRef: string` | 文件名 / URL / 空（FAQ） |
| `content` | `content: string` | chunk 原文 |
| （point score） | `score: number` | RRF 融合分，`p.score ?? 0` 兜底 |

payload 中入库时写入的 `seq` / `faqQ` / `faqA` 在此接口被丢弃（调用方不需要）。

## 数据依赖

每次查询需要两份全局统计，均在查询时实时获取：

1. **dfMap**：`db.select().from(bm25Df)` **全量加载** `bm25_df` 表 → `Map<word, df>`。df 由 ingest 侧维护（文档级频率，见 `docs/modules/ingest.md`）。
2. **totalDocs（idf 公式中的 N）**：`qdrant.count(COLLECTION, { exact: true })` 的精确点数。

然后 `buildQuerySparse(tokenize(query), dfMap, totalDocs)` 得查询稀疏向量：每个查询词权重 `idf = ln(1 + N/df)`，df 缺省按 0.5 平滑（词不在库中仍有限权重）。与 chunk 侧权重 `1 + ln(tf)` 点积即为 BM25 简化得分。

> 粒度说明：N 实际是 **chunk 总数**（Qdrant points 数），而 df 是**文档级**频率，两者粒度不一致——因 `N/df` 比值仍能反映词的稀缺度，教学级实现可接受。

## 实现细节与已知坑

- **embedding 实例为模块级单例**：`const embeddings = makeEmbeddings()` 在 import 时创建一次（对比：ingest 侧 `writeChunks` 每次新建，风格不一致但均无状态）。
- **sparse 向量直接传 `{ indices, values }`**：与 Qdrant 命名稀疏向量格式一致，无需转换；`indices` 为 FNV-1a 哈希的 u32，`values` 为 idf 权重。
- **`with_payload: true`**：必须开启，否则拿不到 content 等业务字段。
- **两路 prefetch 并发**：`embedQuery` 与 `bm25_df` 全表 select 用 `Promise.all` 并行；但 `qdrant.count` 串行在其后（count 结果才能构建 sparse 向量）。即外部交互共 4 次：1× embed API、1× SQLite select、1× Qdrant count、1× Qdrant query。
- **性能特征与优化方向**：`bm25_df` 全表 select 与 `count(exact)` 每次查询都执行，词表/数据量大时会成为瓶颈。优化方向：**dfMap 内存缓存**（ingest/delete 时同步维护）、**count 缓存或本地计数器**（Qdrant points 数可在写入/删除时自行累计）。
- **双存储一致性**：检索同时依赖 Qdrant（向量）与 SQLite（`bm25_df`）。ingest 侧"Qdrant upsert 成功但 SQLite 事务失败"会残留孤儿 points（df 未加），此时稀疏路可检索到该 chunk 但 idf 统计缺该文档贡献——影响的是打分精度而非正确性，教学级取舍。
- `p.score ?? 0`：Qdrant 类型定义中 score 可选，防御性兜底。

环境依赖（`apps/server/src/config.ts`）：`ZHIPU_API_KEY`（必需）、`ZHIPU_BASE_URL`（默认 `https://open.bigmodel.cn/api/paas/v4/`）、`EMBEDDING_MODEL`（默认 `embedding-3`）、`EMBEDDING_DIM`（默认 1024，必须与集合创建时一致，否则 Qdrant 报维度不匹配）、`QDRANT_URL`（默认 `http://localhost:6333`）、`DATABASE_URL`。集合由服务启动时 `ensureCollection()` 幂等创建（`apps/server/src/index.ts`）。

## 调用方

### 1. graph 检索节点（`apps/server/src/graph/nodes/retrieve.ts`）

对话主链路中的位置：router（闲聊/知识库分流）→ rewrite（查询改写）→ **retrieve** → rerank（DeepSeek 重排序，见下）→ grade（相关性打分，不相关可回到 rewrite 重写再检索）→ generate（带引用生成）。

多查询变体并发检索 + 合并去重：

```ts
const PER_QUERY_TOPK = 5;
const MAX_CANDIDATES = 10;

const perQuery = await Promise.all(state.queries.map((q) => hybridSearch(q, PER_QUERY_TOPK)));
// flat → 按 chunkId 去重 → slice(0, 10) → candidates
```

`state.queries` 来自上游 rewrite 节点的查询改写（多查询变体提升召回覆盖）；结果写入 `state.candidates` 并记录 graphStep（`{ node: "retrieve", data: { queries, candidates: 数量 } }`，供前端思考面板展示）。注意：去重后**不重排**——多查询的候选按 queries 顺序拼接，RRF 分数不参与跨查询排序；跨查询精排交由下游 rerank 节点完成。

### 2. graph 重排序节点（`apps/server/src/graph/nodes/rerank.ts`）

位于 retrieve 与 grade 之间：`rerankNode` 调用 `rerankDocs(state.question, state.candidates)`，将 DeepSeek 重排剪除后的结果覆盖写回 `state.candidates`，并记录 graphStep `{ node: "rerank", data: { total, kept } }`。细节：每条候选内容截前 300 字送 DeepSeek；候选为空直接短路不调 LLM；未返回 docId 的候选按 0 分处理（必被剪除）；无 try/catch 降级，DeepSeek 失败则图执行报错。

### 3. 检索效果测试 API（`apps/server/src/routes/retrieval-test.ts`）

挂载于 `POST /api/retrieval/test`（见 `apps/server/src/index.ts`）。请求体经 `RetrievalTestRequest`（zod）校验：`query` 非空、`topK` 整数 1~20 默认 5。返回命中摘要而非全文：

```ts
hits.map((h) => ({ chunkId, docTitle, score, preview: h.content.slice(0, 120) }))
```

用途：知识库管理界面单独调参（topK）观察检索命中，不进入对话链路。

## 测试与验证

`apps/server/src/retrieval/hybrid.test.ts` 为**集成测试**：`describe.skipIf(!hasKey)`——`ZHIPU_API_KEY` 缺失或为 `"sk-placeholder"` 时跳过；同时依赖运行中的 Qdrant 与已初始化的 SQLite。用例（60s 超时）：`hybridSearch("测试查询", 5)` 不抛错且每个命中含 `chunkId` / `score` / `docTitle` 字段。

`apps/server/src/retrieval/rerank.test.ts`：4 个 mock 单测（`vi.mock` factory——同分稳定降序重排 / 低于 `RERANK_MIN_SCORE` 剪除 / 未返回 docId 按 0 分被剪 / 空数组直接返回不调 LLM）+ 1 个真实 DeepSeek 集成用例（`describe.skipIf(!hasKey)`，`DEEPSEEK_API_KEY` 缺失或为占位值时跳过；60s 超时，断言相关文档排最前、无关被剪——用例内 `vi.doUnmock` + `resetModules` 解除 factory mock 拿真实实现）。

hybridSearch 无 mock 单测——模块逻辑薄（映射 + 一次 Qdrant 调用），核心算法（分词/稀疏向量构建）的测试在 `ingest/bm25.test.ts` 中覆盖。端到端效果验证另有 `pnpm --filter server eval`（`apps/server/scripts/eval.ts`，基线报告见 `docs/eval/2026-09-baseline.md`）。

```bash
# 无真实 key：hybrid 集成测试 skip，仅其余单测执行
pnpm --filter server test

# 有真实 key + 本地 Qdrant 运行中：集成测试执行
ZHIPU_API_KEY=<real-key> pnpm --filter server test

# 手动验证检索效果（需服务已启动）
curl -X POST http://localhost:3001/api/retrieval/test \
  -H "content-type: application/json" \
  -d '{"query": "退货政策", "topK": 5}'
```

## 已知限制与扩展点

- **无 score_threshold**：不做低分过滤，topK 内即使相关性弱也返回；graph 链路上由 rerank（LLM 打分剪除）与 grade 节点承担过滤职责。
- **retrieval-test API 未接 rerank**：rerank 仅在图内（rerank 节点）生效，`POST /api/retrieval/test` 返回的是 hybridSearch 的 RRF 原始排序——管理后台检索测试控制台看到的即原始排序，不含精排与剪除；graph 侧多查询合并去重后也不按 RRF 分数跨查询重排（见"调用方"）。
- **BM25 质量一般**：自实现分词 + 简化打分（无长度归一化、N 与 df 粒度混合）；RRF 下 dense 为主路，sparse 模块化可替换。
- **每次查询全量加载 df / count**：见上文性能优化方向。

扩展点（设计文档 `docs/superpowers/specs/2026-09-02-rag-customer-service-design.md` 预留）：

1. **Rerank 精排（已落地 LLM 版）**：图内已接入 DeepSeek LLM 打分式精排（`rerank.ts`，设计文档 §15 该扩展的提前落地）；后续可替换/叠加为交叉编码器 rerank API（Jina / Cohere）以获得更标准的精排质量；retrieval-test API 侧尚未接入 rerank；
2. **稀疏向量换模型**：`bm25.ts` 产出的 `{ indices, values }` 与 Qdrant 稀疏向量格式解耦，可平滑替换为 BGE-M3 等模型产出的学习型稀疏向量（设计文档风险表提及）；
3. **统计缓存**：`bm25_df` 与 count 的内存缓存，ingest/delete 时增量维护。

相关模块：入库侧（df 维护、sparse 向量构建、payload 结构）见 `docs/modules/ingest.md`。
