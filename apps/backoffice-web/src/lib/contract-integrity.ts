/**
 * Detect multiple simultaneously effective subscription contracts without choosing a
 * winner or mutating any financial/subscription history.
 *
 * This is an IT control-plane preflight only, NOT the source of POS entitlements.
 * When contract history is ambiguous, financial reconciliation is required.
 */
export type ContractIntegrityCandidate = {
  id: string;
  status: string | null;
  ended_at: string | null;
};

export function isCurrentSubscriptionContract(
  contract: ContractIntegrityCandidate,
  nowMs: number = Date.now()
): boolean {
  if (contract.status !== "active" && contract.status !== "trial") return false;
  if (!contract.ended_at) return true;
  const endMs = Date.parse(contract.ended_at);
  // Invalid contract dates must not accidentally mask an integrity problem.
  return !Number.isFinite(endMs) || endMs > nowMs;
}

export function summarizeContractIntegrity(
  contracts: readonly ContractIntegrityCandidate[],
  nowMs: number = Date.now()
) {
  const currentContractIds = contracts
    .filter((contract) => isCurrentSubscriptionContract(contract, nowMs))
    .map((contract) => contract.id);
  return {
    effective_contract_count: currentContractIds.length,
    has_conflict: currentContractIds.length > 1,
  };
}
