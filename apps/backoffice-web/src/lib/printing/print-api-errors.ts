import { fail } from "@/lib/http";

type ErrorContext = Record<string, string | number | boolean | null | undefined>;

function errorSummary(error: unknown) {
  if (!(error instanceof Error)) return { name: "UnknownError", message: String(error) };
  return {
    name: error.name,
    message: error.message
  };
}

export function loggedPrintApiFail(
  scope: string,
  error: unknown,
  code: string,
  message: string,
  status = 500,
  context: ErrorContext = {}
) {
  const requestId = crypto.randomUUID();
  console.error(`[print-api] ${scope}`, {
    request_id: requestId,
    error: errorSummary(error),
    ...context
  });
  const response = fail(code, `${message} Reference: ${requestId}`, status);
  response.headers.set("x-request-id", requestId);
  return response;
}
