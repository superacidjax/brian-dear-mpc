import type { BrainFactItem } from "./brainStore.js";
import { listBrainFacts } from "./brainStore.js";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(/[^a-z0-9+#.-]+/)
      .filter((token) => token.length > 3),
  );
}

export async function getRelevantBrainFacts(
  question: string,
  limit = 5,
): Promise<BrainFactItem[]> {
  const facts = (await listBrainFacts()).filter(
    (fact) => fact.status === "approved",
  );
  const questionTokens = tokenSet(question);

  return facts
    .map((fact) => {
      const factTokens = tokenSet(
        `${fact.topic} ${fact.question} ${fact.answer}`,
      );
      const score = [...questionTokens].filter((token) =>
        factTokens.has(token),
      ).length;
      return { fact, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.fact.createdAt.localeCompare(a.fact.createdAt),
    )
    .slice(0, limit)
    .map((entry) => entry.fact);
}
