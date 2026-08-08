"use client";

export function PaginationControls({
  page,
  totalPages,
  onPageChange
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "flex-end" }}>
      <button
        type="button"
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        style={{ minHeight: 40, padding: "0 12px" }}
      >
        Previous
      </button>
      <span>
        Page {page} / {Math.max(totalPages, 1)}
      </span>
      <button
        type="button"
        onClick={() => onPageChange(Math.min(totalPages || 1, page + 1))}
        disabled={page >= totalPages}
        style={{ minHeight: 40, padding: "0 12px" }}
      >
        Next
      </button>
    </div>
  );
}
