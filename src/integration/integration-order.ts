import type { AgentResult } from "../runtime/agent-result.js";
import { IntegrationCandidateSchema, type IntegrationCandidate } from "./integration-contracts.js";

const AGENT_ORDER = new Map<string, number>([
  ["spec-bdd", 0],
  ["api-contract", 1],
  ["design-ui", 2],
  ["integrator", 3],
]);

export function buildIntegrationCandidates(input: {
  agentResults: AgentResult[];
  approvedAgentResultIds: string[];
}): IntegrationCandidate[] {
  const approvedIds = new Set(input.approvedAgentResultIds);

  return input.agentResults
    .filter((result) => approvedIds.has(result.id))
    .filter((result) => result.kind === "implementation")
    .filter((result) => result.status === "passed")
    .map((result) => {
      if (result.kind !== "implementation") {
        throw new Error("Expected implementation result");
      }

      if (result.commitSha === undefined) {
        throw new Error(`Passed implementation result is missing commitSha: ${result.id}`);
      }

      const order = AGENT_ORDER.get(result.agent);

      if (order === undefined) {
        throw new Error(`Unsupported integration agent: ${result.agent}`);
      }

      return IntegrationCandidateSchema.parse({
        agentResultId: result.id,
        agent: result.agent,
        commitSha: result.commitSha,
        baseSha: result.baseSha,
        order,
        approvedByReviewCouncil: true,
        changedFiles: result.changedFiles,
      });
    })
    .sort((left, right) => {
      if (left.order !== right.order) {
        return left.order - right.order;
      }

      return left.commitSha.localeCompare(right.commitSha);
    });
}
