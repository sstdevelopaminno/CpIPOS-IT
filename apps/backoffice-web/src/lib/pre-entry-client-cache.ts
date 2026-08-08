"use client";

export type CachedBranch = {
  id: string;
  code: string | null;
  name: string | null;
  address: string | null;
};

type BranchCache = {
  savedAt: number;
  selectedBranchId: string | null;
  branches: CachedBranch[];
};

type SelectedBranchCache = {
  savedAt: number;
  branch: CachedBranch;
};

const BRANCH_CACHE_KEY = "ipos:login:branches";
const SELECTED_BRANCH_CACHE_KEY = "ipos:login:selected-branch";
const CACHE_TTL_MS = 5 * 60 * 1000;
function readCache<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function isFresh(savedAt: number) {
  return Number.isFinite(savedAt) && Date.now() - savedAt <= CACHE_TTL_MS;
}

export function cacheBranches(branches: CachedBranch[], selectedBranchId: string | null = null) {
  if (typeof window === "undefined") return;
  try {
    const value: BranchCache = { savedAt: Date.now(), selectedBranchId, branches };
    window.sessionStorage.setItem(BRANCH_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Login must continue when storage is unavailable or full.
  }
}

export function readCachedBranches(): BranchCache | null {
  const value = readCache<BranchCache>(BRANCH_CACHE_KEY);
  if (!value || !isFresh(value.savedAt) || !Array.isArray(value.branches)) return null;
  return value;
}

export function cacheSelectedBranch(branch: CachedBranch) {
  if (typeof window === "undefined") return;
  try {
    const value: SelectedBranchCache = { savedAt: Date.now(), branch };
    window.sessionStorage.setItem(SELECTED_BRANCH_CACHE_KEY, JSON.stringify(value));
  } catch {
    // Login must continue when storage is unavailable or full.
  }
}

export function readCachedSelectedBranch(): CachedBranch | null {
  const value = readCache<SelectedBranchCache>(SELECTED_BRANCH_CACHE_KEY);
  if (!value || !isFresh(value.savedAt) || !value.branch?.id) return null;
  return value.branch;
}

export function clearPreEntryClientCache() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(BRANCH_CACHE_KEY);
    window.sessionStorage.removeItem(SELECTED_BRANCH_CACHE_KEY);
  } catch {
    // Storage cleanup is best-effort.
  }
}

export function warmRoute(router: { prefetch: (href: string) => void }, href: string) {
  if (process.env.NODE_ENV === "development") return;

  router.prefetch(href);
}
