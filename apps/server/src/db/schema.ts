import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import type { Citation, GraphStep } from "@rag/shared";

export const documents = sqliteTable("documents", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  sourceType: text("source_type").notNull(), // file | url | faq
  sourceRef: text("source_ref").notNull(),
  mime: text("mime"),
  sizeBytes: integer("size_bytes"),
  status: text("status").notNull().default("processing"),
  error: text("error"),
  chunkCount: integer("chunk_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
});

export const chunks = sqliteTable("chunks", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull()
    .references(() => documents.id, { onDelete: "cascade" }),
  seq: integer("seq").notNull(),
  content: text("content").notNull(),
  tokenCount: integer("token_count").notNull(),
  qdrantPointId: text("qdrant_point_id").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
});

export const conversations = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull().default("新会话"),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
});

export const messages = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  citations: text("citations", { mode: "json" }).$type<Citation[]>(),
  graphSteps: text("graph_steps", { mode: "json" }).$type<GraphStep[]>(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull().default(sql`(unixepoch() * 1000)`),
});

export const bm25Df = sqliteTable("bm25_df", {
  word: text("word").primaryKey(),
  df: integer("df").notNull().default(0),
});
