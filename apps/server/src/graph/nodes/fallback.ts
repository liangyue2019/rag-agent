import type { RagState } from "../state.js";

const FALLBACK_TEXT =
  "抱歉，知识库中暂时没有足够的信息来回答这个问题。您可以尝试换一种问法，或联系人工客服获得帮助。";

export async function fallbackNode(_state: RagState): Promise<Partial<RagState>> {
  return {
    answer: FALLBACK_TEXT,
    citations: [],
    graphSteps: [{ node: "fallback", summary: "检索穷尽，诚实拒答" }],
  };
}
