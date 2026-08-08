export type PendingQueueEntry = {
  idempotencyKey: string;
  queued_at: string;
  retry_count: number;
  last_error?: string | null;
};

export function enqueuePendingItem<TEntry extends PendingQueueEntry>(
  current: TEntry[],
  next: Omit<TEntry, "queued_at" | "retry_count" | "last_error"> & { last_error?: string | null },
  nowIso: string
): TEntry[] {
  if (current.some((entry) => entry.idempotencyKey === next.idempotencyKey)) {
    return current;
  }
  return [
    ...current,
    {
      ...next,
      queued_at: nowIso,
      retry_count: 0,
      last_error: next.last_error ?? null
    } as TEntry
  ];
}

export function dequeuePendingItem<TEntry extends PendingQueueEntry>(current: TEntry[], idempotencyKey: string): TEntry[] {
  return current.filter((entry) => entry.idempotencyKey !== idempotencyKey);
}

export function markPendingItemFailed<TEntry extends PendingQueueEntry>(
  current: TEntry[],
  idempotencyKey: string,
  errorMessage: string,
  nowIso: string
): TEntry[] {
  return current.map((entry) =>
    entry.idempotencyKey === idempotencyKey
      ? {
          ...entry,
          retry_count: entry.retry_count + 1,
          last_error: errorMessage,
          queued_at: nowIso
        }
      : entry
  );
}
