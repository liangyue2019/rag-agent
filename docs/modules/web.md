# Web 前端（apps/web）

基于 Next.js App Router 的纯展示与交互层，包含两类界面：

- **聊天页**（`app/page.tsx`）：流式对话、回答引用溯源、Agent 思考过程可视化；
- **管理后台**（`app/admin/*`）：知识库文档、FAQ、会话历史的管理。

前端不承载业务逻辑，所有数据均通过 REST 与 SSE 调用 Express 服务端。

## 1. 技术栈

| 类别 | 选型（锁定版本来自 pnpm-lock.yaml） | 说明 |
|---|---|---|
| 框架 | next@16.3.4 | App Router；`next dev` 默认启用 Turbopack；**无 `src/` 目录**，页面与组件直接位于 `apps/web/app`、`apps/web/components` |
| UI 运行时 | react@19.2.8 / react-dom@19.2.8 | — |
| 样式 | tailwindcss@^4（`@tailwindcss/postcss`） | v4 通过 `app/globals.css` 的 `@import "tailwindcss"` 引入，无 tailwind.config 文件 |
| 聊天流式 | ai@5.0.251 + @ai-sdk/react@2.0.254 | `useChat` + `DefaultChatTransport` 消费服务端的 UIMessage Stream（SSE） |
| 服务端状态 | @tanstack/react-query@5.102.8 | 管理后台与侧栏的 CRUD / 轮询 |
| 类型 | typescript@^5 | `@/*` 别名映射到 `apps/web` 根（`tsconfig.json` 的 `paths: { "@/*": ["./*"] }`） |

### 1.1 @ai-sdk/react 版本线锁定原因

`package.json` 声明为 `"@ai-sdk/react": "^2.0.254"`、`"ai": "^5.0.251"`（锁文件解析为精确版本）。**不要升级到 @ai-sdk/react 4.x**：4.x 依赖 ai@7（AI SDK v7 协议线），而服务端 `apps/server` 使用 ai@5 的 `createUIMessageStream`（v5 UIMessage Stream 协议）。前后端必须处于同一 UIMessage 协议版本线，SSE 的 data part（`data-graph-step` / `data-citations`）与 text part 语义才能对齐，因此前端版本必须锁死在 2.0.254 + ai@5.0.251。

## 2. 目录结构

```
apps/web/
├─ app/
│  ├─ layout.tsx              # 根布局：字体 + Providers
│  ├─ providers.tsx           # React Query Provider
│  ├─ page.tsx                # 聊天页（核心）
│  ├─ globals.css             # Tailwind v4 入口
│  └─ admin/
│     ├─ layout.tsx           # 管理后台导航布局
│     ├─ documents/page.tsx           # 知识库列表（上传/导入/轮询）
│     ├─ documents/[id]/page.tsx      # 文档详情（分块预览 + 检索测试）
│     ├─ faqs/page.tsx                # FAQ 管理
│     └─ conversations/page.tsx       # 会话历史
├─ components/chat/
│  ├─ chat-message.tsx        # 单条消息渲染（引用 chip + 思考面板）
│  ├─ thinking-panel.tsx      # 可折叠的 GraphStep 时间线
│  └─ sidebar.tsx             # 会话列表侧栏
└─ .env.local                 # NEXT_PUBLIC_API_URL=http://localhost:3001
```

## 3. 全局骨架

- `app/layout.tsx`：加载 Geist / Geist Mono 字体变量，`<body>` 内用 `<Providers>` 包裹 `children`，纯服务端组件。
- `app/providers.tsx`：`"use client"`，用 `useState(() => new QueryClient({...}))` 惰性创建唯一 QueryClient 实例（避免每次渲染重建），默认选项 `queries: { refetchOnWindowFocus: false, retry: 1 }`——管理后台轮询依赖 `refetchInterval` 而非窗口聚焦刷新，重试一次足够暴露错误。

## 4. 聊天页（app/page.tsx）

聊天页同时使用了 `useChat`（流式）与 React Query（会话列表），核心难点是**两条状态线的协同**：会话 id 由 React state（`activeId`）持有，但发送请求由 useChat 内部的 Chat 实例执行。

### 4.1 transport 模块级单例

```ts
const transport = new DefaultChatTransport({
  api: `${API}/api/chat`,
  prepareSendMessagesRequest: ({ messages, body }) => ({
    body: {
      conversationId: body?.conversationId as string | undefined,
      content: messages.filter((m) => m.role === "user").at(-1)
        ?.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("") ?? "",
    },
  }),
});
```

- **为什么是模块级常量**：`useChat` 内部用 `useRef` 仅在首次渲染构造 Chat 实例并永久持有 transport，组件内重建/传入新的 transport 会被忽略。因此 transport 不能依赖任何会变化的 props/state。
- 后端 `/api/chat` 契约为 `{ content }`（而非 AI SDK 默认的 `{ id, messages, trigger }`），所以在 `prepareSendMessagesRequest` 里把最后一条用户消息的所有 text part 拼接为 `content`。
- **conversationId 贯通方案**：每次调用 `sendMessage({ text }, { body: { conversationId: activeId } })` 时，per-call 的 `options.body` 会合并进 `prepareSendMessagesRequest` 的入参 `body`，从中读取当前会话 id。这样 transport 保持单例即可随请求携带最新会话 id；无激活会话时为 `undefined`，`JSON.stringify` 会省略该字段，后端据此新建会话。

### 4.2 一轮对话的生命周期

```ts
onSubmit: 清空输入 + clearError()
  → await sendMessage({ text }, { body: { conversationId: activeId } })
  → await refreshAfterTurn()
```

- `sendMessage` 返回的 promise 在**整轮流结束**（成功 / 出错 / 中止）后 resolve，因此可以安全地在后面衔接刷新逻辑。
- `refreshAfterTurn`：`qc.fetchQuery({ queryKey: ["conversations"], ... })` 与侧栏的 `useQuery` 共享同一缓存，顺带驱动侧栏更新；随后 `setActiveId((prev) => prev ?? convs[0]?.id)`——若无激活会话（首条消息刚让后端新建了会话），按 `updatedAt` 倒序认领第一条。函数式 setState 读取 await 之后的最新值，避免闭包过期。
- **错误处理**：`status` 停在 `error` 后按钮不锁死——按钮仅在 `status === "submitted" || status === "streaming"` 时 `disabled`，出错后可继续发送；提交前 `clearError()` 清除上一轮的错误条。`status === "submitted"` 时显示"思考中…"占位。

### 4.3 历史会话加载与新建

- `selectConversation(id)`：`GET /api/conversations/:id` → 把 `MessageDto` 映射为 UIMessage（`parts: [{ type: "text", text: m.content }]`）后 `setMessages`，并 `setActiveId(id)`。
- `newConversation()`：`setActiveId(undefined)` + `setMessages([])`，下一条消息即开新会话。

## 5. 消息组件（components/chat/）

### 5.1 chat-message.tsx

从 `UIMessage.parts` 收集三类数据后渲染：

- **text**：所有 text part 拼接为回答文本；
- **data-citations**：取第一个该类型 part 的 `data` 作为 `Citation[]`；
- **data-graph-step**：过滤出全部该类型 part，每个 `data` 收集为 `GraphStep`，交给 `ThinkingPanel`。

`renderWithCitationChips(text, citations)` 的正则分段渲染：

```ts
text.split(/(\[\d+\])/g).map((seg, i) => {
  const m = seg.match(/^\[(\d+)\]$/);
  // 命中引用编号 → 上标 chip（title 悬停显示 docTitle: preview），否则原样文本
});
```

引用列表渲染在消息底部：`[n] docTitle（sourceRef）` 以顿号连接。

### 5.2 thinking-panel.tsx

可折叠的步骤时间线：`useState(open)` 控制，收起时显示 `▸ 思考过程（N 步）`，展开为带左侧竖线的 `<ol>`。每个 step 按 `NODE_LABEL` 映射为中文标签：

| node | 标签 | 附加展示 |
|---|---|---|
| router | 意图识别 | `summary` |
| rewrite | 查询改写 | 查询：`queries.join(" / ")` |
| retrieve | 混合检索 | 候选 N 条 |
| grade | 相关性评分 | 相关 N / 无关 N |
| generate | 生成回答 | — |
| fallback | 拒答 | `summary` |
| chatReply | 直接回复 | `summary` |

该文件同时导出前端本地的 `GraphStep` 判别联合类型（见第 8 节）。

### 5.3 sidebar.tsx

会话 CRUD 侧栏：

- 读：`useQuery({ queryKey: ["conversations"] })` → `GET /api/conversations`；
- 删：`DELETE /api/conversations/:id` 后 `qc.invalidateQueries`；若删除的是当前会话则回调 `onNew()` 重置聊天区；
- 当前 `activeId` 的条目以 `bg-gray-100 font-medium` 高亮；删除按钮仅在行 hover 时显示。

## 6. 管理后台（app/admin/）

### 6.1 布局（admin/layout.tsx）

顶部导航：知识库（`/admin/documents`）/ FAQ（`/admin/faqs`）/ 会话（`/admin/conversations`），右侧"← 聊天"回到 `/"`。内容区限宽 `max-w-4xl`。

### 6.2 知识库（admin/documents/page.tsx）

- **上传**：隐藏 `<input type="file" accept=".pdf,.docx,.txt,.md">` 由按钮触发，`FormData` `POST /api/documents/upload`；
- **URL 导入**：`POST /api/documents/url`，body `{ url }`；
- **删除**：`DELETE /api/documents/:id`；
- 以上操作后均 `invalidateQueries(["documents"])` 立即刷新；
- **状态轮询**：`refetchInterval: (query) => query.state.data?.some((d) => d.status === "processing") ? 2000 : false`——回调形式按当前数据动态决策：列表中存在 `processing` 文档时每 2s 轮询，全部就绪/失败后返回 `false` 停止轮询；
- 状态列渲染：`processing` → `⏳ 处理中`；`failed` → `❌ {error}`；其余 → `✅ ready`。

### 6.3 文档详情（admin/documents/[id]/page.tsx）

两块区域：

- **分块预览**：`useQuery({ queryKey: ["chunks", id], enabled: !!id })` → `GET /api/documents/:id/chunks`，每块显示 `#seq · tokenCount 字` 与内容；
- **检索测试控制台**：
  ```ts
  const { data: hits, refetch, isFetching } = useQuery<Hit[]>({
    queryKey: ["retrieval-test", query, id],
    enabled: false,
    queryFn: () => fetch(`${API}/api/retrieval/test`, { method: "POST", body: JSON.stringify({ query, topK: 5 }) }),
  });
  ```
  `enabled: false` 的关键语义：**v5 中 disabled 查询不会随 queryKey 变化自动 fetch**（这里 key 含 `query`，随输入实时变化），只在点击"测试"按钮调用 `refetch()` 时以当前 key 手动执行一次——正好实现"控制台"式的手动触发。按钮 `disabled={!query || isFetching}`。结果按 `score.toFixed(4)` 排序展示 `docTitle` + `preview`。

### 6.4 FAQ 管理（admin/faqs/page.tsx）

- 列表：`GET /api/documents/faqs`（queryKey `["faqs"]`）；
- 创建：表单（question / answer）`POST /api/documents/faqs`，成功后清空表单 + `invalidateQueries`；
- 删除：`DELETE /api/documents/:id`（FAQ 复用文档删除路由，后端将 FAQ 落为 sourceType=faq 的文档记录）；
- 状态列：`failed` → `❌` + `error.slice(0, 30)`；`processing` → `⏳ 处理中`；否则 `✅ ready`。

### 6.5 会话历史（admin/conversations/page.tsx）

- 会话列表 `useQuery(["conversations"])`；
- 点击标题展开：`useQuery({ queryKey: ["conversation", openId], enabled: !!openId })` 拉取详情 `GET /api/conversations/:id`；再次点击同一行则收起（`setOpenId(undefined)`）；
- 消息按角色分色（user 灰底），每条消息下方若存在 `graphSteps` 则渲染步骤链：`s.node).join(" → ")`，如 `router → retrieve → generate`。

## 7. 与后端的契约

- **环境变量**：`apps/web/.env.local` 仅一个 `NEXT_PUBLIC_API_URL=http://localhost:3001`（NEXT_PUBLIC_ 前缀使其在浏览器端可用）。
- **SSE 事件消费**：服务端 `apps/server/src/graph/stream.ts` 用 `createUIMessageStream` 写出事件序列，`useChat` 自动解析为 UIMessage parts：

| writer.write 事件 | 前端落点 |
|---|---|
| `data-graph-step`（每个图节点结束时逐条写出） | `chat-message.tsx` 收集为 `GraphStep[]` → `ThinkingPanel` 时间线 |
| `text-start` / `text-delta` / `text-end`（generate/chatReply 的 token 流；fallback 静态文案整段写出） | 追加为 text part，聊天区流式渲染 |
| `data-citations`（收尾时写出最终引用） | `chat-message.tsx` 读取后渲染引用 chip 与引用列表 |

## 8. 已知限制与设计取舍

- **历史消息不重放 citations / graphSteps**：`selectConversation` 加载历史时仅构造 text part（`MessageDto` 只有 `content`），思考过程与引用 chip 只在当轮流式过程中可见；持久化的 graphSteps 仅在管理后台会话页以纯文本步骤链展示。
- **本地类型副本**：`Citation`（chat-message.tsx）与 `GraphStep`（thinking-panel.tsx）是前端本地声明的接口/联合类型，与 `@rag/shared` 保持一致但未直接依赖该包——避免为两个类型引入跨包引用配置；后端字段变更时需手动同步。
- `prepareSendMessagesRequest` 只发送最后一条用户消息文本与 conversationId，多轮历史由服务端从数据库补齐（前端不随请求回传全量 messages）。
