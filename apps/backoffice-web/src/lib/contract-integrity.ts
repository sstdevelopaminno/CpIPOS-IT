/**
 * Read-only IT preflight: never guess which active subscription wins.
 * Contract history/finance must be reconciled by an authorized operator.
 */
export type ContractIntegrityCandidate = {
  id: string;
  status: string | null;
  started_at: string | null;
  ended_at: string | null;
};

function invalidDate(value: string | null) {
  return value !== null && !Number.isFinite(Date.parse(value));
}

export function isCurrentSubscriptionContract(
  row: ContractIntegrityCandidate,
  atMs: number = Date.now(),
): boolean {
  if (row.status !== "active" && row.status !== "trial") return false;
  // Bad dates must not be used to silently discard a potentially active grant.
  if (invalidDate(row.started_at) || invalidDate(row.ended_at)) return true;
  return (!row.started_at || Date.parse(row.started_at) <= atMs) &&
    (!row.ended_at || Date.parse(row.ended_at) > atMs);
}

export function summarizeContractIntegrity(
  rows: readonly ContractIntegrityCandidate[],
  atMs: number = Date.now(),
) {
  const current = rows.filter(row => isCurrentSubscriptionContract(row, atMs));
  const has_invalid_dates = current.some(row =>
    invalidDate(row.started_at) || invalidDate(row.ended_at));
  return {
    effective_contract_count: current.length,
    has_conflict: current.length > 1,
    has_invalid_dates
  };
}
