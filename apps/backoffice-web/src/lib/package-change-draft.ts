/**
 * Preserve the selected package during unrelated tenant control mutations.
 * Initial loads and submitted payment requests should use the saved package.
 */
export function resolvePackageChangeDraft(input: {
  availablePackageIds: readonly string[];
  currentPackageId: string | null | undefined;
  previousSelectedId: string;
  preservePrevious: boolean;
}): string {
  const { availablePackageIds, currentPackageId, previousSelectedId, preservePrevious } = input;
  if (preservePrevious && availablePackageIds.includes(previousSelectedId)) {
    return previousSelectedId;
  }
  if (currentPackageId && availablePackageIds.includes(currentPackageId)) {
    return currentPackageId;
  }
  return availablePackageIds[0] ?? "";
}
