import { Annotation, MessagesAnnotation } from "@langchain/langgraph";
import type { Citation, GraphStep, RetrievedDoc } from "@rag/shared";

export const RagState = Annotation.Root({
  ...MessagesAnnotation.spec,
  question: Annotation<string>({ reducer: (_a, b) => b }),
  route: Annotation<"chat" | "rag">({ reducer: (_a, b) => b }),
  queries: Annotation<string[]>({ reducer: (_a, b) => b, default: () => [] }),
  candidates: Annotation<RetrievedDoc[]>({ reducer: (_a, b) => b, default: () => [] }),
  relevantDocs: Annotation<RetrievedDoc[]>({ reducer: (_a, b) => b, default: () => [] }),
  retrievalCount: Annotation<number>({ reducer: (a, b) => b ?? a, default: () => 0 }),
  rewriteFeedback: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  answer: Annotation<string>({ reducer: (_a, b) => b, default: () => "" }),
  citations: Annotation<Citation[]>({ reducer: (_a, b) => b, default: () => [] }),
  graphSteps: Annotation<GraphStep[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),
});

export type RagState = typeof RagState.State;
