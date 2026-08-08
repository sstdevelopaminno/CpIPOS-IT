export type PaginationInput = {
  page: number;
  pageSize: number;
};

export function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function parsePagination(searchParams: URLSearchParams, defaultPageSize = 10): PaginationInput {
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSize = Math.min(100, parsePositiveInt(searchParams.get("page_size"), defaultPageSize));

  return { page, pageSize };
}

export function parseBool(value: string | null): boolean | null {
  if (value === null) {
    return null;
  }

  if (["1", "true", "yes"].includes(value.toLowerCase())) {
    return true;
  }

  if (["0", "false", "no"].includes(value.toLowerCase())) {
    return false;
  }

  return null;
}

export function sanitizeSearchTerm(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const sanitized = value.replace(/[,%()]/g, " ").trim().replace(/\s+/g, " ");
  return sanitized || null;
}

export function buildPaginationMeta(page: number, pageSize: number, total: number | null) {
  const safeTotal = total ?? 0;
  const totalPages = safeTotal === 0 ? 0 : Math.ceil(safeTotal / pageSize);

  return {
    page,
    page_size: pageSize,
    total: safeTotal,
    total_pages: totalPages
  };
}
