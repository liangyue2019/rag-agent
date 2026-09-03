import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

export interface Chunk { seq: number; content: string; tokenCount: number }

const DEFAULT = { size: 600, overlap: 100 };

/** 中文感知分块：默认 600 字符 / overlap 100（设计文档 5.3） */
export async function chunkText(
  text: string,
  opts: { size?: number; overlap?: number } = {},
): Promise<Chunk[]> {
  const { size, overlap } = { ...DEFAULT, ...opts };
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: size,
    chunkOverlap: overlap,
    separators: ["\n\n", "\n", "。", "！", "？", "；", ",", " ", ""],
  });
  const pieces = await splitter.splitText(text);
  return pieces
    .map((content, seq) => ({ seq, content, tokenCount: content.length }))
    .filter((c) => c.content.trim().length > 0);
}
