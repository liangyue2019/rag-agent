import { z } from "zod";

// ---- 实体 DTO ----
export const DocumentDto = z.object({
  id: z.string(),
  title: z.string(),
  sourceType: z.enum(["file", "url", "faq"]),
  sourceRef: z.string(),
  status: z.enum(["processing", "ready", "failed"]),
  error: z.string().nullable(),
  chunkCount: z.number(),
  createdAt: z.string(),
});
export type DocumentDto = z.infer<typeof DocumentDto>;

export const FaqInput = z.object({ question: z.string().min(1), answer: z.string().min(1) });
export type FaqInput = z.infer<typeof FaqInput>;

export const ChatRequest = z.object({
  conversationId: z.string().optional(),
  content: z.string().min(1),
});
export type ChatRequest = z.infer<typeof ChatRequest>;

export const UrlImportRequest = z.object({ url: z.string().url() });

export const RetrievalTestRequest = z.object({
  query: z.string().min(1),
  topK: z.number().int().min(1).max(20).default(5),
});

// ---- 检索/引用 ----
export interface RetrievedDoc {
  chunkId: string;
  documentId: string;
  docTitle: string;
  sourceType: "file" | "url" | "faq";
  sourceRef: string;
  content: string;
  score: number;
}

export interface Citation {
  n: number;
  chunkId: string;
  docTitle: string;
  sourceRef: string;
  preview: string;
}

// ---- graph-step（思考面板数据） ----
export type GraphStep =
  | { node: "router"; summary: string }
  | { node: "rewrite"; data: { queries: string[]; round: number } }
  | { node: "retrieve"; data: { queries: string[]; candidates: number } }
  | { node: "grade"; data: { relevant: number; irrelevant: number; feedback: string } }
  | { node: "generate"; data: { docs: number } }
  | { node: "fallback"; summary: string }
  | { node: "chatReply"; summary: string };

export interface ConversationDto {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  graphSteps: GraphStep[] | null;
  createdAt: string;
}
