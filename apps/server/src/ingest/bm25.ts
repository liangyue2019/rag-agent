import { Jieba } from "@node-rs/jieba";
import { dict } from "@node-rs/jieba/dict";

export interface SparseVector { indices: number[]; values: number[] }

// jieba 2.x 为类实例 API：模块级单例，首次 import 加载词典
const jieba = Jieba.withDict(dict);

/** 中文分词（HMM 开启），小写化，去空白 */
export function tokenize(text: string): string[] {
  return jieba.cut(text.toLowerCase(), true)
    .map((w) => w.trim())
    .filter((w) => w.length > 0);
}

/** FNV-1a 32bit：word → 稳定 u32 下标 */
export function wordId(word: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function termFreq(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/** 入库侧：chunk 的稀疏向量，权重 tf' = 1 + ln(tf) */
export function buildChunkSparse(tokens: string[]): SparseVector {
  const tf = termFreq(tokens);
  const indices: number[] = [];
  const values: number[] = [];
  for (const [word, n] of tf) {
    indices.push(wordId(word));
    values.push(1 + Math.log(n));
  }
  return { indices, values };
}

/** 查询侧：BM25 idf 加权 idf = ln(1 + N/df)（df 缺省按 0.5 平滑） */
export function buildQuerySparse(
  tokens: string[],
  df: Map<string, number>,
  totalDocs: number,
): SparseVector {
  const tf = termFreq(tokens);
  const indices: number[] = [];
  const values: number[] = [];
  for (const [word] of tf) {
    const d = df.get(word) ?? 0.5;
    indices.push(wordId(word));
    values.push(Math.log(1 + totalDocs / d));
  }
  return { indices, values };
}

export type DfDelta = Array<[word: string, chunksContaining: number]>;

/** 入库前计算：该文档对 df 的增量（一个词在该文档的 chunk 中出现 → df+1） */
export function computeDfDelta(chunkTokenLists: string[][]): DfDelta {
  const wordsPerDoc = new Set<string>();
  for (const tokens of chunkTokenLists) for (const t of tokens) wordsPerDoc.add(t);
  return [...wordsPerDoc].map((w) => [w, 1] as [string, number]);
}

export function applyDelta(df: Map<string, number>, delta: DfDelta) {
  for (const [w, d] of delta) df.set(w, (df.get(w) ?? 0) + d);
}

/** 删除文档时回退 df（每词 df-1，减到 0 删除键） */
export function rollbackDf(df: Map<string, number>, delta: DfDelta) {
  for (const [w, d] of delta) {
    const next = (df.get(w) ?? 0) - d;
    if (next > 0) df.set(w, next);
    else df.delete(w);
  }
}
