# @rag/shared 共享类型包

> 源码：`packages/shared/src/index.ts`

## 职责与边界

前后端契约的**单一事实来源**（single source of truth）。同一个符号同时提供两层保障：

- **运行时校验**：导出的 zod schema 在服务端路由入口对请求体做 `parse`，非法输入在进入业务逻辑前即被拒绝；
- **编译时约束**：通过 `z.infer` 从 schema 推导 TS 类型，编码期即可获得字段提示与类型检查，杜绝"手写两份类型各自漂移"。

边界上它是纯类型包：零副作用、零业务依赖，运行时依赖仅 `zod`（^3.23.0）。**无构建产物**——`package.json` 的 `main` 直接指向 `src/index.ts`，消费方（server 经 tsx）直接编译 TS 源码，省去 build 步骤，代价是引用方工具链必须能处理 TS。

## 组成（文件清单）

| 文件 | 说明 |
|---|---|
| `packages/shared/src/index.ts` | 全部 schema 与类型导出（75 行） |
| `packages/shared/src/index.test.ts` | vitest 校验用例（3 个） |
| `packages/shared/package.json` | `main: "src/index.ts"`；依赖 zod ^3.23.0 |
| `packages/shared/tsconfig.json` | ES2022 / ESNext / Bundler resolution / strict / noEmit，仅类型检查 |

## 核心设计

**schema 与类型同源**：每个实体先声明 zod schema，再用 `z.infer<typeof X>` 推导出同名类型导出。改 schema 时类型自动跟随，无需同步维护两份定义：

```ts
export const ChatRequest = z.object({ conversationId: z.string().optional(), content: z.string().min(1) });
export type ChatRequest = z.infer<typeof ChatRequest>;
```

**`default` 的语义**：`RetrievalTestRequest.topK` 声明为 `z.number().int().min(1).max(20).default(5)`——请求体省略 `topK` 时 `parse` 结果自动补 5，路由层直接解构使用、无需手写 fallback（见 `apps/server/src/routes/retrieval-test.ts:9` 的 `const { query, topK } = RetrievalTestRequest.parse(req.body)`）。注意 `default` 会让 schema 的**输入类型**（`z.input`，topK 可选）与**输出类型**（`z.output`，topK 必有）不再相同，`z.infer` 取的是后者——消费方拿到的 topK 永远是 `number` 而非 `number | undefined`。

**判别式联合（discriminated union）**：`GraphStep` 以 `node` 字段为判别式，负载分两种形状——带 `summary`（router/fallback/chatReply）与带 `data`（rewrite/retrieve/grade/generate）。TS 可通过 `step.node === "router"` 自动窄化出 `summary` 字段，前端 `NODE_LABEL: Record<GraphStep["node"], string>` 也依赖判别式穷举七个节点。

## 对外接口（导出的函数/类型）

### 实体 DTO（zod schema）

| 导出 | 类型推导 | 字段与校验要点 |
|---|---|---|
| `DocumentDto` | ✅ `z.infer` | id/title/sourceType（`file\|url\|faq` 枚举）/sourceRef/status（`processing\|ready\|failed`）/error（可空）/chunkCount/createdAt |
| `FaqInput` | ✅ `z.infer` | question、answer 均 `min(1)` 非空 |
| `ChatRequest` | ✅ `z.infer` | conversationId 可选；content `min(1)` 非空 |
| `UrlImportRequest` | ❌ 仅 schema | `url` 需通过 `z.string().url()` 格式校验 |
| `RetrievalTestRequest` | ❌ 仅 schema | query `min(1)`；topK 整数 1~20，默认 5 |

> `UrlImportRequest` / `RetrievalTestRequest` 未导出配套 `z.infer` 类型，调用方只 `parse` 解构使用（现状如此，如需类型可按同模式补一行推导）。

### 检索类型（纯 TS interface）

- `RetrievedDoc`：chunkId / documentId / docTitle / sourceType / sourceRef / content / score。检索管线（Qdrant 命中）到生成节点之间的中间结构。
- `Citation`：n（引用编号，对应回答文本中的 `[n]` 标记）/ chunkId / docTitle / sourceRef / preview。落库到 `messages.citations`，前端据此渲染悬停 chip。

### 图类型

`GraphStep` 联合类型共 7 个变体（见上文判别式设计）：

| node | 负载 | 语义 |
|---|---|---|
| `router` | `summary: string` | 意图识别结论 |
| `rewrite` | `data: { queries: string[]; round: number }` | 查询改写轮次 |
| `retrieve` | `data: { queries: string[]; candidates: number }` | 混合检索候选数 |
| `grade` | `data: { relevant: number; irrelevant: number; feedback: string }` | 相关性评分 |
| `generate` | `data: { docs: number }` | 参与生成的文档数 |
| `fallback` | `summary: string` | 拒答原因 |
| `chatReply` | `summary: string` | 闲聊直接回复 |

### 会话类型

- `ConversationDto`：id / title / createdAt / updatedAt（均为 string，ISO 时间）。
- `MessageDto`：id / role（`user | assistant`）/ content / citations（`Citation[] | null`）/ graphSteps（`GraphStep[] | null`）/ createdAt。可空字段与数据库 `messages` 表的 json 列语义一一对应。

## 实现细节与已知坑

**server 消费方式**（`"@rag/shared": "workspace:*"`）：

- 路由校验：`routes/chat.ts`（ChatRequest）、`routes/documents.ts`（FaqInput、UrlImportRequest）、`routes/retrieval-test.ts`（RetrievalTestRequest）均以 `Schema.parse(req.body)` 形式在 handler 入口校验；
- 类型引用：`routes/conversations.ts` 导入 `ConversationDto` / `MessageDto` / `Citation` / `GraphStep`；
- **schema 列类型**：`apps/server/src/db/schema.ts` 中 `messages.citations` / `messages.graphSteps` 用 `text(..., { mode: "json" }).$type<Citation[]>()` / `$type<GraphStep[]>()`，让 drizzle 的 json 序列化列获得精确类型，写库与读库均类型安全。

**web 目前使用本地声明副本**（`apps/web/package.json` 未依赖 @rag/shared）：

- `apps/web/components/chat/thinking-panel.tsx:6` 本地声明 `GraphStep`；
- `apps/web/components/chat/chat-message.tsx:5` 本地声明 `Citation`；
- `apps/web/app/page.tsx:34` 内联 `type Conv = { id: string; title: string; updatedAt: string }`（ConversationDto 的部分字段副本）。

原因（代码注释原话）："避免跨包类型引用配置"——Next.js 侧引入 workspace TS 源码包需要额外的 transpilePackages 等配置，当前以"复制声明 + 注释锚定"的最低成本方案过渡。**演进方向**：给 web 添加 `"@rag/shared": "workspace:*"` 依赖并在 `next.config` 中转译该包，删除三处本地副本，彻底消除双份定义漂移风险。在此之前，修改 `Citation` / `GraphStep` / `ConversationDto` 时必须同步检查 web 侧副本。

**校验失败返回 500（现状）**：路由里 `parse` 抛出的 `ZodError` 会被 Express 5 转交给默认错误处理器，返回 **500** 而非语义更准确的 400（`src/index.ts` 未注册自定义错误中间件）。校验本身有效——非法输入确实进不了业务逻辑——但错误码语义是一个已知的待改进点。

## 配置项

无环境变量、无配置文件。唯一的"构建约定"是消费方需将包当作 TS 源码处理（tsx / Bundler moduleResolution），不产出 dist。

## 测试与验证

`packages/shared/src/index.test.ts` 共 3 个用例（vitest）：

1. **ChatRequest 校验合法输入**：`parse({ content: "退货政策？" })` 后 content 原样保留、conversationId 为 undefined（验证 optional 行为）；
2. **ChatRequest 拒绝空内容**：`parse({ content: "" })` 抛异常（验证 `min(1)`）；
3. **DocumentDto 解析完整对象**：含全部 9 个字段的对象解析后 status 为 "ready"（验证枚举与可空 error: null 的解析）。

运行：`corepack pnpm --filter @rag/shared test`。
