/** Bound actual incoming bytes: Content-Length may be absent or false. */
export class JsonRequestError extends Error {
  constructor(public readonly code: "json_body_too_large" | "invalid_json_body", message: string, public readonly status: 400 | 413) {
    super(message); this.name = "JsonRequestError";
  }
}
export async function readBoundedJson<T = unknown>(request: Request, maxBytes = 32_768): Promise<T> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) throw new Error("Invalid JSON body limit.");
  const sizeHeader = request.headers.get("content-length");
  if (sizeHeader && /^\d+$/.test(sizeHeader) && Number(sizeHeader) > maxBytes) {
    throw new JsonRequestError("json_body_too_large", "Request body exceeds the allowed size.", 413);
  }
  if (!request.body) throw new JsonRequestError("invalid_json_body", "A JSON request body is required.", 400);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new JsonRequestError("json_body_too_large", "Request body exceeds the allowed size.", 413);
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let index = 0;
  for (const chunk of chunks) { bytes.set(chunk, index); index += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as T; }
  catch { throw new JsonRequestError("invalid_json_body", "Request body must contain valid JSON.", 400); }
}
