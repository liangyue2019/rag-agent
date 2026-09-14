import { rerankDocs } from "../../retrieval/rerank.js";
import type { RagState } from "../state.js";

/** DeepSeek 重排序节点（retrieve 之后、grade 之前） */
export async function rerankNode(state: RagState): Promise<Partial<RagState>> {
  const total = state.candidates.length;
  const candidates = await rerankDocs(state.question, state.candidates);
  return {
    candidates,
    graphSteps: [{ node: "rerank", data: { total, kept: candidates.length } }],
  };
}
