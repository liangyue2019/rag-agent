# 知识入库 Pipeline（ingest）

> 源码：`apps/server/src/ingest/`（parsers.ts / chunker.ts / bm25.ts / pipeline.ts / waitReady.ts）

## 职责与边界

把三类知识源统一转换为「Qdrant 向量 + SQLite 结构化记录」：

| 知识源 | 触发路由 | 解析方式 |
|---|---|---|
| 文件（pdf / docx / txt / md，≤ 20MB） | `POST /api/documents/upload` | `parseFile` |
| URL（HTML 网页） | `POST /api/documents/url` | `parseUrl` |
| FAQ（问答对） | `POST /api/documents/faqs` | 不解析，`question\nanswer` 拼为单 chunk |

处理链路：**解析 → 清洗 → 分块 → 双路向量化（dense + sparse）→ Qdrant upsert + SQLite 事务落库**。

边界：本模块不做检索（见 `docs/modules/retrieval.md`）、不做对话。文档元数据 CRUD 与分块预览在 `apps/server/src/routes/documents.ts`，本模块对外只暴露 `enqueueIngest` 与 `deleteDocumentFully` 两个入口。

整体流程（异步，HTTP 层与处理层解耦）：

```
HTTP 202                        p-queue (concurrency=2)
───────                         ─────────────────────────────────────────────
upload/url/faqs                 runIngest(job)
  ├─ insert documents ─┐          ├─ "buffer" in job → parseFile(buffer, mime)
  │   status=processing│          ├─ "url" in job    → parseUrl(url)
  ├─ enqueueIngest ────┼────────→ ├─ 否则            → ingestFaq(Q, A)
  └─ 202 {documentId}  │          │    ↓（任一步抛错 → status=failed + error）
                       │          ├─ chunkText → [chunk...]（空则抛错）
                       │          └─ writeChunks：
   前端轮询 GET /api/documents     │    ① embedDocuments（dense 批量）
   或 GET /:id/chunks 预览 ←──────┴──── ② tokenize → buildChunkSparse + computeDfDelta
                                        ③ Qdrant upsert（wait: true）
                                        ④ SQLite 事务：chunks + bm25_df + documents
                                           → status=ready, chunkCount
```

环境依赖（`apps/server/src/config.ts`，zod 校验）：`ZHIPU_API_KEY`（必需）、`EMBEDDING_MODEL`（默认 `embedding-3`）、`EMBEDDING_DIM`（默认 1024，须与 Qdrant 集合一致）、`QDRANT_URL`（默认 `http://localhost:6333`）、`DATABASE_URL`（默认 `file:./data/app.db`）。

## 组成（文件清单）

| 文件 | 职责 | 关键导出 |
|---|---|---|
| `parsers.ts` | 文件/URL → 纯文本 | `parseFile`、`parseUrl`、`ALLOWED_MIME`、`MAX_FILE_BYTES` |
| `chunker.ts` | 中文感知递归分块 | `chunkText`（async）、`Chunk` |
| `bm25.ts` | 分词、词 ID、稀疏向量、df 维护 | `tokenize`、`wordId`、`buildChunkSparse`、`buildQuerySparse`、`computeDfDelta`、`applyDelta`、`rollbackDf`、`DfDelta` |
| `pipeline.ts` | 异步队列编排与落库/删除 | `enqueueIngest`、`deleteDocumentFully`、三个 Input 接口 |
| `waitReady.ts` | 轮询文档状态 | `waitReady` |

数据落点：

- **Qdrant** 集合 `kb_chunks`（`apps/server/src/qdrant/client.ts` 的 `ensureCollection` 幂等创建）：命名向量 `dense`（size=EMBEDDING_DIM，默认 1024，Cosine）+ 稀疏向量 `sparse`。
- **SQLite** 三张表（`apps/server/src/db/schema.ts`，drizzle-orm）：

| 表 | 关键字段 | 说明 |
|---|---|---|
| `documents` | `id`(PK)、`title`、`sourceType`(file/url/faq)、`sourceRef`、`mime`、`sizeBytes`、`status`、`error`、`chunkCount`、`createdAt/updatedAt` | 状态机载体，默认 `status="processing"` |
| `chunks` | `id`(PK=chunkId)、`documentId`(FK, cascade)、`seq`、`content`、`tokenCount`、`qdrantPointId` | 与 Qdrant point 一一对应 |
| `bm25_df` | `word`(PK)、`df` | 全局词 → 文档频率，检索侧 idf 的数据源 |

## 核心设计

### 异步队列与状态机

上传路由先插入 `documents` 行（`status` 默认 `"processing"`），调用 `enqueueIngest()` 后**立即返回 202 + `{ documentId }`**，HTTP 响应不被解析/向量化阻塞：

```ts
const queue = new PQueue({ concurrency: 2 }); // p-queue，并发 2

export function enqueueIngest(job: IngestFileInput | IngestUrlInput | IngestFaqInput) {
  queue.add(() => runIngest(job).catch((e) => logger.error({ err: e }, "ingest failed")));
}
```

- **job 类型判别**：字段探测——`"buffer" in job` → 文件；`"url" in job` → 网页；否则 FAQ。三类输入共用一个队列。
- **状态机**：`processing → ready | failed`。成功路径在 `writeChunks` 事务内 `set({ status: "ready", chunkCount })`；任何异常由 `runIngest` 的 catch 兜底，`set({ status: "failed", error })`（error 为异常 message）。外层 `.catch` 只负责日志（防止队列任务 reject）。
- **队列语义**：p-queue 无界（不限 backlog）、无重试——任务失败即终态 `failed`，需用户重新上传；并发 2 同时限制了对智谱 embed API 与 Qdrant 的写入压力。

### writeChunks 全流程（pipeline.ts）

文件/网页与 FAQ 最终都收敛到 `writeChunks(documentId, contents, faq?)`：

1. 读 `documents` 行（不存在则抛 `document ${documentId} 不存在`），取 title/sourceType/sourceRef。
2. **dense 向量**：`makeEmbeddings().embedDocuments(contents)` 一次性批量（智谱 `embedding-3`，OpenAI 兼容协议，`dimensions` 显式 1024 与 Qdrant 集合对齐，见 `apps/server/src/llm/factory.ts`）。
3. **sparse 向量 + df 增量**：`contents.map(tokenize)` → `tokenLists`；逐 chunk `buildChunkSparse`；`computeDfDelta(tokenLists)` 计算文档级 df 增量。
4. **Qdrant upsert**（`wait: true`）：每个 chunk 一个 point：
   - `id`：`uuid()`（point id）
   - `vector`：`{ dense: dense[i], sparse: sparse[i] }`（sparse 直接传 `{ indices, values }`）
   - `payload`：`chunkId`（另一个 uuid，SQLite 侧主键）、`documentId`、`docTitle`、`sourceType`、`sourceRef`、`seq`、`content`，FAQ 时额外展开 `faqQ` / `faqA`
5. **SQLite 事务落库**（同步回调，见下文坑 1）：批量 insert `chunks`（含 `qdrantPointId = String(point.id)`）；逐词 upsert `bm25_df`（`onConflictDoUpdate` 使 `df = df + d`）；`documents` 置 `ready` + `chunkCount`。

> 注意 point id 与 chunkId 是两个不同 uuid：point id 是 Qdrant 侧标识（存 `chunks.qdrantPointId`），chunkId 是业务侧标识（检索结果引用）。

### deleteDocumentFully（对称删除）

1. 从 SQLite 读该文档全部 `chunks`；
2. **全量**加载 `bm25_df` 构建 dfMap；
3. 对 chunk 内容重新 `tokenize` → `computeDfDelta` → `rollbackDf`（每词 df-1，减到 0 删键）；
4. SQLite 事务：逐词将回退后的 df 写回（`update` 或 `delete`），删除 `documents` 行（`chunks` 经外键 `onDelete: "cascade"` 级联删除）；
5. Qdrant 按 filter 删 points：`{ must: [{ key: "documentId", match: { value: documentId } }] }`，`wait: true`。

顺序为 **先 SQLite 后 Qdrant**；若中途失败可能残留 Qdrant 孤儿 points（无补偿机制，教学级取舍）。FAQ 编辑（`PUT /api/documents/faqs/:id`）即"删除重建"：`deleteDocumentFully` 旧 id + 插入新行重新入队。

## 对外接口

```ts
// 三种 job（字段探测判别，联合类型）
interface IngestFileInput { documentId: string; buffer: Buffer; mime: string; title: string }
interface IngestUrlInput  { documentId: string; url: string }
interface IngestFaqInput  { documentId: string; question: string; answer: string }

enqueueIngest(job): void          // 立即入队，不阻塞
deleteDocumentFully(id): Promise<void>
waitReady(id, timeoutMs = 60_000): Promise<void>  // 500ms 间隔轮询
```

`waitReady`：`ready` 返回；`failed` 抛 `ingest failed: ${doc.error}`；超时抛 `waitReady 超时`。供测试与需要同步语义的调用方使用。

## 实现细节与已知坑

### parsers.ts

- **MIME 白名单**：`application/pdf`、docx（`application/vnd.openxmlformats-officedocument.wordprocessingml.document`）、`text/plain`、`text/markdown`；docx 判定用 `mime.includes("wordprocessingml")`。
- **20MB 上限**：常量 `MAX_FILE_BYTES` 定义在此文件，但**实际执行在路由层**（`routes/documents.ts` 的 multer `limits: { fileSize }`）；`parseFile` 本身只校验 MIME，不校验大小。路由层与 `parseFile` 各校验一次 MIME（双保险）。
- **PDF**：unpdf 的 `getDocumentProxy(new Uint8Array(buffer))` + `extractText(pdf, { mergePages: true })`（无 Node 原生依赖的轻量方案）。
- **docx**：`mammoth.extractRawText({ buffer })` 取纯文本。
- **txt / md**：`buffer.toString("utf-8")` 直读，md 不做语法处理（分块阶段按分隔符处理）。
- **URL 抓取**：`fetch` + `AbortSignal.timeout(15_000)`；UA 固定 `rag-agent/0.1 (+knowledge-import)`；非 2xx 抛 `抓取失败 HTTP ${status}`；`content-type` 不含 `text/html` 拒绝（即不支持 PDF 直链等）。
- **5MB 后置检查**：`await res.text()` **先完整读入**，再 `Buffer.byteLength(html, "utf8") > 5MB` 才报错。原因：fetch API 没有内建的"响应体大小上限"，无法在读取前限制；流式读取+中断需要手写 ReadableStream 消费逻辑，此处选择简单后置检查（代价是超大页面会先占内存再报错）。
- **HTML 清洗**（cheerio）：移除 `script, style, nav, aside, footer, header, noscript, iframe`；取 `$("body").text()` 后做空白规范化——`/[ \t]+/g → " "`、`/\n{3,}/g → "\n\n"`、`trim()`。

### chunker.ts

- **`chunkText` 是 async**：`@langchain/textsplitters` 的 `splitText` 返回 Promise（内部可能异步），调用方必须 `await`。
- **默认参数**：`size: 600, overlap: 100`（可通过 opts 覆盖）。
- **中文感知分隔符**（按优先级递归尝试）：`["\n\n", "\n", "。", "！", "？", "；", ",", " ", ""]`——段落 → 换行 → 中文句读 → 半角逗号 → 空格。
- **`""` 兜底必须存在**：若去掉末尾空串，当某段文本不含任何分隔符且超过 `size` 时，`RecursiveCharacterTextSplitter` 无更低级别可退，整块透传，块长将超过上限（实测发现并修复；现有测试断言 `content.length <= 700` 即 600+100 上界防回归）。
- **overlap 粒度坑**：overlap 以 split 片段为粒度回退，若片段本身长于 overlap 则无字符级重叠；只有触发 `""` 逐字切分时才有真正的字符级 overlap（测试注释已说明）。
- **tokenCount 语义**：`content.length`（UTF-16 字符数）而非真实 LLM token 数，仅作粗略计量/展示用。
- 空块过滤：`content.trim().length > 0`。

### bm25.ts（自实现教学模块）

公式速查（`tf` = 词频、`df` = 含该词的文档数、`N` = 总文档数）：

| 侧 | 权重 | 公式 |
|---|---|---|
| 入库（chunk 稀疏向量） | `tf'` | `1 + ln(tf)` |
| 查询（查询稀疏向量） | `idf` | `ln(1 + N/df)`，df 缺省 0.5 |
| 相似度 | 两向量点积 | `Σ idf(q) · (1 + ln(tf))` |

- **tokenize**：`@node-rs/jieba` **2.x 类实例 API**——`import { Jieba } from "@node-rs/jieba"; import { dict } from "@node-rs/jieba/dict"`，模块级单例 `Jieba.withDict(dict)`（首次 import 加载词典），调用 `jieba.cut(text.toLowerCase(), true)`（HMM 开启）。**不是** 1.x 的顶层 `cut` 函数。先小写化再分词，词项 trim 后过滤空串。
- **wordId**：FNV-1a 32bit 哈希（基准 `0x811c9dc5`、质数 `0x01000193`、`Math.imul` 32 位乘、`>>> 0` 归一为 u32）。词 → 维度下标的映射完全确定、无词典依赖；代价是 32bit 空间下不同词可能碰撞（共享维度），词表规模有限时概率可忽略。
- **buildChunkSparse（入库侧）**：权重 `tf' = 1 + ln(tf)`（对数饱和，替代 BM25 的 k1 饱和项）。
- **buildQuerySparse（查询侧）**：权重 `idf = ln(1 + N/df)`，其中 df 缺省按 **0.5 平滑**（词从未入过库时仍有有限权重）；`N = totalDocs` 由调用方传入（检索侧取 Qdrant count，见 retrieval 文档）。
- **打分语义**：最终得分是查询/ chunk 两个稀疏向量的点积 ≈ `Σ idf(q) · (1 + ln(tf))`——**BM25 的简化版，无文档长度归一化（无 k1/b 项）**，教学级实现。
- **df 语义（重要）**：`DfDelta = Array<[word, chunksContaining]>` 的第二元素**恒为 1**——`computeDfDelta` 把整篇文档所有 chunk 的词合并成一个 Set，即 **df 按"词在文档中出现"计数（文档频率），而非 chunk 频次**。类型名 `chunksContaining` 有误导性，实际是文档级增量。`applyDelta` 加、`rollbackDf` 对称减（减到 0 删键），保证入库/删除可逆。

### pipeline.ts

- **坑 1（better-sqlite3）**：`db.transaction(cb)` 的回调**必须同步**——better-sqlite3 是同步驱动，异步回调（内含 await）会直接抛错。事务内所有语句用 `.run()` 立即执行。
- **坑 2**：`makeEmbeddings()` 在每次 `writeChunks` 内新建实例（检索侧 hybrid.ts 则是模块级单例）——OpenAIEmbeddings 实例无状态、无实际开销，但风格不统一。
- **FAQ 单 chunk 特殊性**：`ingestFaq` 把 `` `${question}\n${answer}` `` 作为唯一 chunk（`seq=0`、`chunkCount=1`），payload 额外带 `faqQ`/`faqA`；不做 chunkText（Q/A 天然是最小检索单元）。
- **Qdrant upsert 与 SQLite 落库非原子**：跨两个存储，upsert 成功但事务失败时会残留 Qdrant points（无回滚删除），教学级取舍。
- `deleteDocumentFully` 中 df 全表加载（`db.select().from(bm25Df)`）在大词表下是 O(全表) 操作。

## 测试与验证

单测 11 例 + 集成 1 例（vitest）：

| 文件 | 用例数 | 覆盖点 |
|---|---|---|
| `parsers.test.ts` | 3 | txt 解析（fixtures/sample.txt，断言"签收后七天"）、md 解析（sample.md，断言"7 天无理由退货"）、拒绝非法 MIME |
| `chunker.test.ts` | 3 | 短文本单块、长文本按分隔符切分且 `length ≤ 700`、超长无分隔片段触发逐字切分验证字符级 overlap |
| `bm25.test.ts` | 5 | 分词+小写化（"退货Policy退货"→`["退货","policy","退货"]`）、wordId 确定性/u32 范围、tf 权重 `= 1+ln(tf)`、idf 单调性（df 大权重低）、delta 加减对称 |
| `pipeline.test.ts` | 1（集成） | FAQ 全流程：processing→ready（`chunkCount=1`）→Qdrant scroll 可检索→`deleteDocumentFully` 后 0 points |

集成测试 `describe.skipIf(!hasKey)`：`ZHIPU_API_KEY` 缺失或为 `"sk-placeholder"` 时跳过——依赖真实智谱 key、运行中的 Qdrant 与 SQLite；超时 90s。fixtures 位于 `apps/server/tests/fixtures/`（sample.txt / sample.md），路径经 `import.meta.dirname` 拼接。

```bash
pnpm --filter server test          # 无 key 时仅跑 11 个单测
ZHIPU_API_KEY=<real-key> pnpm --filter server test   # 含集成
```
