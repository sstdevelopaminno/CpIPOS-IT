"use client";

import { useEffect, useMemo, useState } from "react";

type ApiResponse<T> = {
  data: {
    items: T[];
    pagination: {
      page: number;
      page_size: number;
      total: number;
      total_pages: number;
    };
  } | null;
  error: {
    code: string;
    message: string;
  } | null;
};

export function usePaginatedApi<T>(endpoint: string, query: Record<string, string | number | undefined>) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<T[]>([]);
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 10,
    total: 0,
    total_pages: 0
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value === undefined || value === "") {
        return;
      }
      params.set(key, String(value));
    });
    return params.toString();
  }, [query]);

  const requestUrl = useMemo(() => `${endpoint}?${queryString}`, [endpoint, queryString]);

  useEffect(() => {
    const CACHE_TTL_MS = 15000;
    type Pagination = {
      page: number;
      page_size: number;
      total: number;
      total_pages: number;
    };
    type CacheEntry = { at: number; items: T[]; pagination: Pagination };
    const cacheStore = ((globalThis as unknown as { __POS_PAGINATED_CACHE__?: Map<string, CacheEntry> }).__POS_PAGINATED_CACHE__ ??=
      new Map<string, CacheEntry>());

    const now = Date.now();
    const cached = cacheStore.get(requestUrl);
    const cacheFresh = Boolean(cached && now - cached.at <= CACHE_TTL_MS);

    const requestController = new AbortController();
    const timeoutId = window.setTimeout(() => requestController.abort(), 15000);
    let active = true;

    if (cacheFresh && cached) {
      queueMicrotask(() => {
        if (!active) return;
        setItems(cached.items);
        setPagination(cached.pagination);
        setLoading(false);
        setError(null);
      });
    } else {
      queueMicrotask(() => {
        if (!active) return;
        setLoading(true);
        setError(null);
      });
    }

    const fetchOnce = async () => {
      const response = await fetch(requestUrl, {
        method: "GET",
        signal: requestController.signal,
        cache: "no-store"
      });
      const body = (await response.json()) as ApiResponse<T>;
      if (!response.ok || body.error || !body.data) {
        throw new Error(body.error?.message ?? "Request failed");
      }
      return body.data;
    };

    const fetchWithSingleRetry = async () => {
      try {
        return await fetchOnce();
      } catch (error) {
        if (requestController.signal.aborted) {
          throw error;
        }
        return await fetchOnce();
      }
    };

    void fetchWithSingleRetry()
      .then((data) => {
        if (!active) return;
        setItems(data.items);
        setPagination(data.pagination);
        setError(null);
        cacheStore.set(requestUrl, {
          at: Date.now(),
          items: data.items,
          pagination: data.pagination
        });
      })
      .catch((fetchError) => {
        if (!active) return;
        if (fetchError instanceof Error && fetchError.name === "AbortError" && requestController.signal.aborted) {
          if (!cached) {
            setError("Request timeout. Please retry.");
          }
          return;
        }
        if (!cached) {
          setItems([]);
        }
        setError(fetchError instanceof Error ? fetchError.message : "Unknown error");
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      requestController.abort();
    };
  }, [requestUrl]);

  return {
    loading,
    error,
    items,
    pagination
  };
}
