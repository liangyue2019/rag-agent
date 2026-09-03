import { hybridSearch } from "../../retrieval/hybrid.js";
import type { RagState } from "../state.js";

const PER_QUERY_TOPK = 5;
const MAX_CANDIDATES = 10;

/** 对每个查询变体检索并合并去重（设计文档 6.3） */
export async function retrieveNode(state: RagState): Promise<Partial<RagState>> {
  const perQuery = await Promise.all(state.queries.map((q) => hybridSearch(q, PER_QUERY_TOPK)));
  const seen = new Set<string>();
  const candidates = perQuery.flat().filter((d) => {
    if (seen.has(d.chunkId)) return false;
    seen.add(d.chunkId);
    return true;
  }).slice(0, MAX_CANDIDATES);
  return {
    candidates,
    graphSteps: [{ node: "retrieve", data: { queries: state.queries, candidates: candidates.length } }],
  };
}
