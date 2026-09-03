# 服务端基础设施（config / logger / db / qdrant / llm）

> 源码：
> - `apps/server/src/config.ts`、`apps/server/src/logger.ts`
> - `apps/server/src/db/schema.ts`、`apps/server/src/db/client.ts`、`apps/server/drizzle.config.ts`
> - `apps/server/src/qdrant/client.ts`
> - `apps/server/src/llm/factory.ts`、`apps/server/scripts/smoke-llm.ts`

## 职责与边界

为业务层（路由、摄取管线、LangGraph 编排）提供五个无业务语义的基础件：环境配置、结构化日志、SQLite 持久化、Qdrant 客户端、LLM 工厂。它们只被依赖、不依赖业务模块，是依赖图的底座。启动入口 `apps/server/src/index.ts` 按"config → 中间件 → 路由 → `await ensureCollection()` → listen"的顺序组装。

## config：环境变量校验

`apps/server/src/config.ts` 用 zod 定义 `Env` schema 并在**模块加载时**执行 `Env.parse(process.env)`——任何变量缺失或不合法，进程在 import 阶段即抛错退出，绝不带错配置进入业务运行。例如缺 key 时直接报 `缺少 ZHIPU_API_KEY`。环境文件由入口侧 `import "dotenv/config"` 加载（`src/index.ts:1` 与 `scripts/smoke-llm.ts:1`），config.ts 自身不读 `.env`，只读 `process.env`。

| 变量 | 类型/校验 | 默认值 | 说明 |
|---|---|---|---|
| `ZHIPU_API_KEY` | `string().min(1)` | **必填** | 智谱 API key，唯一无默认值的变量 |
| `ZHIPU_BASE_URL` | string | `https://open.bigmodel.cn/api/paas/v4/` | 智谱 OpenAI 兼容端点 |
| `CHAT_MODEL` | string | `glm-4-flash` | 对话模型 |
| `EMBEDDING_MODEL` | string | `embedding-3` | 向量模型 |
| `EMBEDDING_DIM` | `coerce.number()` | `1024` | 向量维度（见下） |
| `QDRANT_URL` | string | `http://localhost:6333` | Qdrant 地址 |
| `DATABASE_URL` | string | `file:./data/app.db` | SQLite 连接串（`file:` 前缀） |
| `PORT` | `coerce.number()` | `3001` | HTTP 端口 |
| `WEB_URL` | string | `http://localhost:3000` | CORS 白名单 origin |
| `LANGSMITH_TRACING` | string | `false` | LangSmith 链路追踪开关 |

**EMBEDDING_DIM=1024 的来源**：设计文档（`docs/superpowers/specs/2026-09-02-rag-customer-service-design.md` 7.2 节）约定 kb_chunks 的 dense 向量为 "embedding-3, 1024 维, Cosine"。智谱 embedding-3 **默认输出 2048 维**，本项目选定 1024 作为存储维度以兼顾检索效果与内存/索引开销；该值同时被 Qdrant 建集合（dense size）与 `makeEmbeddings` 的 `dimensions` 参数消费，改它必须两端同步。

## logger：pino + pino-pretty

```ts
import pino from "pino";
export const logger = pino({ transport: { target: "pino-pretty" } });
```

生产结构化日志（pino ^9）+ 开发期可读输出（pino-pretty ^11，devDependency）。

**为何独立成 3 行的模块而不是放在 index.ts 里**：消费方包括 `src/ingest/pipeline.ts`（`import { logger } from "../logger.js"`）等深层模块。若 logger 定义在 `index.ts`，pipeline → index 的 import 会形成**循环依赖**（index → routes → pipeline → index），在 ESM 下可能拿到未初始化的绑定。单独成叶子模块后，任何层都可安全引用。

## db：SQLite + drizzle-orm

### 表结构（`apps/server/src/db/schema.ts`，共 5 张表）

| 表 | 关键列 | 要点 |
|---|---|---|
| `documents` | id(PK)、source_type、status、chunk_count | status 默认 `'processing'`；chunk_count 默认 0 |
| `chunks` | document_id → documents.id **onDelete: cascade**、qdrant_point_id | 删文档时块级联删除 |
| `conversations` | id、title | title 默认 `'新会话'` |
| `messages` | conversation_id → conversations.id **cascade**、citations、graph_steps | 两列 `text(..., { mode: "json" }).$type<Citation[]>()` / `$type<GraphStep[]>()`，类型来自 `@rag/shared`，drizzle 自动 JSON 序列化/反序列化 |
| `bm25_df` | word(PK)、df | BM25 词文档频率，默认 0 |

所有表的时间列统一为 `integer(..., { mode: "timestamp_ms" }).notNull().default(sql\`(unixepoch() * 1000)\`)`——**默认值在 SQLite 侧计算**而非 JS 侧，裸 SQL 插入也能拿到时间戳；`timestamp_ms` 模式让 drizzle 在 Date ↔ 毫秒整数间自动转换。

### 驱动与初始化（`apps/server/src/db/client.ts`）

```ts
const file = env.DATABASE_URL.replace(/^file:/, "");
mkdirSync(dirname(file), { recursive: true });
export const sqlite = new Database(file);
sqlite.pragma("foreign_keys = ON");
export const db = drizzle(sqlite, { schema });
```

- **better-sqlite3 ^12.0.0**：升级到 v12 是为了拿到 **Node 24 的 prebuilt 二进制**，避免 node-gyp 现场编译。根 `pnpm-workspace.yaml` 中 `allowBuilds: better-sqlite3: true` 授权其安装期构建脚本，prebuilt 下载失败时才会回退本地编译。
- **消费方式**：server 的 tsconfig 用 `moduleResolution: "Bundler"`，`@rag/shared`（`workspace:*`，main 指向 TS 源码）与 `.js` 后缀相对导入均按该策略解析；运行时由 tsx 即时转译。
- **`foreign_keys = ON` pragma 必须显式执行**：SQLite 默认关闭外键约束，不加这一行则 `onDelete: "cascade"` 形同虚设——删 documents 时 chunks 会成为孤儿数据。better-sqlite3 不会自动开启。
- **data 目录自动创建（双保险）**：`client.ts` 与 `drizzle.config.ts` 各自 `mkdirSync(dirname(url), { recursive: true })`。后者存在的原因是 `drizzle-kit push` 不经过 client.ts，若只有运行时建目录，首次 push 时 SQLite 会因父目录不存在而报错。
- **版本组合**：drizzle-orm ^0.36.4 + drizzle-kit ^0.28.1。升到该组合是因旧版 drizzle-kit 的 `push` 与 better-sqlite3 驱动存在兼容性问题（详见项目实施记录）。表结构变更流程：改 `schema.ts` → `corepack pnpm --filter server db:push`。

## qdrant：kb_chunks 集合

`apps/server/src/qdrant/client.ts` 导出 `COLLECTION = "kb_chunks"`、客户端单例 `qdrant`，以及幂等建集合函数：

```ts
export async function ensureCollection() {
  const exists = await qdrant.collectionExists(COLLECTION);
  if (exists.exists) return;
  await qdrant.createCollection(COLLECTION, {
    vectors: { dense: { size: env.EMBEDDING_DIM, distance: "Cosine" } },
    sparse_vectors: { sparse: {} },
  });
}
```

- **结构**：命名向量 `dense`（尺寸 = EMBEDDING_DIM = 1024，Cosine 距离）+ 稀疏向量 `sparse`（供 BM25 混合检索），命名与设计文档 7.2 一致。
- **幂等**：先 `collectionExists` 再创建，重复调用无副作用。
- **调用时机**：`src/index.ts` 在 `listen` 之前 `await ensureCollection()`，保证服务对外可访问时集合一定就绪。

## llm：模型工厂

`apps/server/src/llm/factory.ts` 导出两个无参工厂，均读取 `env` 配置：

- `makeChatModel()`：`ChatOpenAI`，`model: env.CHAT_MODEL`（默认 glm-4-flash）、`temperature: 0.2`（客服场景偏保守）、`maxRetries: 2`（429/5xx 自动重试）、`configuration.baseURL: env.ZHIPU_BASE_URL` 走智谱 OpenAI 兼容端点，不依赖任何智谱私有 SDK。
- `makeEmbeddings()`：`OpenAIEmbeddings`，**`dimensions: env.EMBEDDING_DIM` 必须显式指定**——智谱 embedding-3 默认 2048 维，若省略该参数，写入的向量维度将与 Qdrant 集合的 dense size（1024）冲突，upsert 直接报维度不匹配错误。

**消费方**（均在模块级创建一次实例）：`makeChatModel` 被 5 个图节点消费——`src/graph/nodes/router.ts`、`rewrite.ts`、`grade.ts`（各自 `withStructuredOutput` 绑定路由/改写/评分的输出 schema）与 `generate.ts`、`chat-reply.ts`；另有 `scripts/eval.ts`（裁判模型）与冒烟脚本。`makeEmbeddings` 只有两处：`src/ingest/pipeline.ts:61`（写入向量化）与 `src/retrieval/hybrid.ts:8`（查询向量化），两侧共用同一 EMBEDDING_DIM，天然维度一致。

### 冒烟脚本（`apps/server/scripts/smoke-llm.ts`）

用法：`corepack pnpm --filter server exec tsx scripts/smoke-llm.ts`

- key 未配置或为占位值 `sk-placeholder` 时打印 `[SKIP]` 并 `exit(0)`——CI 无真实 key 也不会红；
- 否则依次验证：`withStructuredOutput(z.object({ ok: z.boolean() }))` 结构化输出 → `embedQuery` 返回向量 → 维度必须等于 `EMBEDDING_DIM`，不符即抛 `维度不符` 错误。这一步正是拦截"embedding 维度与集合不一致"的最后防线。

## 实现细节与已知坑

1. **同步驱动，事务必须同步回调**：better-sqlite3 是同步 API，`db.transaction((tx) => { ... })` 的回调**不能是 async**，且内部语句须立即 `.run()` 执行（`pipeline.ts:87` 的代码注释即此教训的沉淀）。参考实现见 `src/ingest/pipeline.ts:88-104`：chunks 批量插入、bm25_df 增量 upsert、documents 状态更新在同一个纯同步回调里原子提交。
2. **Qdrant 与 SQLite 是双写、无分布式事务**：pipeline 先 upsert Qdrant（`wait: true`）再提交 SQLite 事务，删除则先 SQLite 后 Qdrant filter 删。中途崩溃可能留下两侧不一致，靠文档状态字段（`status`/`error`）与幂等设计兜底。
3. **config 在 import 时即校验**：任何单元测试只要 import 链上碰到 config.ts 就要求 `ZHIPU_API_KEY` 存在——本地开发需 `.env` 提供（哪怕是占位值，只有冒烟脚本会校验真伪）。
4. **`express.json({ limit: "2mb" })`**（`src/index.ts:13`）：为文档上传预留的请求体上限，默认 100kb 会拒绝 FAQ/URL 导入之外的稍大 payload。
