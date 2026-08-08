"use client";

export class ClientFetchTimeoutError extends Error {
  constructor(message = "Request timed out.") {
    super(message);
    this.name = "ClientFetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<Response> {
  const timeoutController = new AbortController();
  const timeoutId = window.setTimeout(() => timeoutController.abort(), timeoutMs);
  const externalSignal = init.signal;

  if (externalSignal?.aborted) {
    window.clearTimeout(timeoutId);
    throw new DOMException("The operation was aborted.", "AbortError");
  }

  const abortFromExternalSignal = () => timeoutController.abort();
  externalSignal?.addEventListener("abort", abortFromExternalSignal, { once: true });

  try {
    return await fetch(input, {
      ...init,
      signal: timeoutController.signal
    });
  } catch (error) {
    if (timeoutController.signal.aborted && !externalSignal?.aborted) {
      throw new ClientFetchTimeoutError();
    }
    throw error;
  } finally {
    externalSignal?.removeEventListener("abort", abortFromExternalSignal);
    window.clearTimeout(timeoutId);
  }
}

export async function parseJsonResponse<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
