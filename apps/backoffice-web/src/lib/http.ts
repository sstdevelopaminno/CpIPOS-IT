import type { ApiErrorResponse, ApiResponse } from "@pos/shared-types";

export function ok<T>(data: T, status = 200): Response {
  const payload: ApiResponse<T> = { data, error: null };
  return Response.json(payload, { status });
}

export function fail(code: string, message: string, status = 400): Response {
  const payload: ApiErrorResponse = {
    data: null,
    error: { code, message }
  };

  return Response.json(payload, { status });
}

