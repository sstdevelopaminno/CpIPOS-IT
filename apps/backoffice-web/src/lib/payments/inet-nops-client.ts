import "server-only";

export type InetEnvironment = "uat" | "production";

type InetCreateQrArgs = {
  environment: InetEnvironment;
  providerOrderId: string;
  orderDesc: string;
  amount: number;
};

export type InetCreateQrResult = {
  providerOrderId: string;
  qrCode: string;
  ref1: string | null;
  ref2: string | null;
  rawCreateResponse: Record<string, unknown>;
};

export type InetNopsConnectionTestResult = {
  providerOrderId: string;
  environment: InetEnvironment;
};

type JsonObject = Record<string, unknown>;

const INET_TIMEOUT_MS = 12000;

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`missing_env:${name}`);
  }
  return value;
}

function resolveEnvName(base: string, environment: InetEnvironment): string {
  return `${base}_${environment === "production" ? "PROD" : "UAT"}`;
}

function parseHttpsUrl(value: string, errorCode: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(errorCode);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error(errorCode);
  }
  return parsed;
}

function normalizeHostname(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function readAdditionalPaymentHosts(environment: InetEnvironment): Set<string> {
  const raw = process.env[resolveEnvName("INET_NOPS_ALLOWED_PAYMENT_HOSTS", environment)] ?? "";
  return new Set(
    raw
      .split(",")
      .map(normalizeHostname)
      .filter(Boolean)
  );
}

function assertTrustedPaymentLink(
  value: string,
  environment: InetEnvironment,
  trustedEndpointUrls: string[]
): string {
  const paymentUrl = parseHttpsUrl(value, "inet_nops_untrusted_payment_url");
  const allowedHosts = readAdditionalPaymentHosts(environment);

  for (const endpoint of trustedEndpointUrls) {
    const endpointUrl = parseHttpsUrl(endpoint, "inet_nops_invalid_provider_endpoint");
    allowedHosts.add(normalizeHostname(endpointUrl.hostname));
  }

  if (!allowedHosts.has(normalizeHostname(paymentUrl.hostname))) {
    throw new Error("inet_nops_untrusted_payment_host");
  }

  return paymentUrl.toString();
}

function buildConnectionProbeOrderId() {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(2, 14);
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 14).toUpperCase();
  return `TST${timestamp}${random}`;
}

export function resolveInetNopsEnvironment(value: unknown): InetEnvironment {
  return value === "production" ? "production" : "uat";
}

export function resolveInetNopsMerchantId(environment: InetEnvironment, configuredMerchantId?: string | null): string | null {
  return configuredMerchantId?.trim() || process.env[resolveEnvName("INET_NOPS_MERCHANT_ID", environment)]?.trim() || null;
}

export function allowsInetNopsUatWithoutMerchantId(environment: InetEnvironment): boolean {
  return environment === "uat" && process.env.INET_NOPS_ALLOW_MISSING_MERCHANT_ID_UAT === "true";
}

function resolveInetNopsConfig(environment: InetEnvironment) {
  const oauthUrl = requireEnv(resolveEnvName("INET_NOPS_OAUTH_URL", environment));
  const accessTokenUrl = requireEnv(resolveEnvName("INET_NOPS_ACCESS_TOKEN_URL", environment));
  parseHttpsUrl(oauthUrl, "inet_nops_invalid_oauth_url");
  parseHttpsUrl(accessTokenUrl, "inet_nops_invalid_access_token_url");

  return {
    merchantKey: requireEnv(resolveEnvName("INET_NOPS_MERCHANT_KEY", environment)),
    oauthUrl,
    accessTokenUrl,
    apUrl: requireEnv(resolveEnvName("INET_NOPS_AP_URL", environment))
  };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findString(value: unknown, keys: string[]): string | null {
  if (!isJsonObject(value)) return null;
  for (const key of keys) {
    const next = value[key];
    if (typeof next === "string" && next.trim()) return next.trim();
  }
  for (const next of Object.values(value)) {
    const nested = findString(next, keys);
    if (nested) return nested;
  }
  return null;
}

function findNumber(value: unknown, keys: string[]): number | null {
  if (!isJsonObject(value)) return null;
  for (const key of keys) {
    const next = value[key];
    if (typeof next === "number" && Number.isFinite(next)) return next;
  }
  return null;
}

function findInetErrorMessage(value: JsonObject): string | null {
  const errors = value.errors;
  if (Array.isArray(errors)) {
    for (const entry of errors) {
      const message = findString(entry, ["message"]);
      if (message) return message;
    }
  }
  return findString(value, ["message"]);
}

function requireInetSuccessCode(stage: "oauth" | "access_token" | "create_payment", payload: JsonObject, expectedCode: number) {
  const code = findNumber(payload, ["code"]);
  if (code === expectedCode) return;
  const detail = findInetErrorMessage(payload) ?? "unexpected_response";
  throw new Error(`inet_nops_${stage}_failed:${code ?? "missing_code"}:${detail}`);
}

async function postJson(stage: "oauth" | "access_token" | "create_payment", url: string, body: JsonObject, headers: HeadersInit = {}): Promise<JsonObject> {
  const safeUrl = parseHttpsUrl(url, `inet_nops_${stage}_invalid_url`).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INET_TIMEOUT_MS);
  try {
    const response = await fetch(safeUrl, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store"
    });
    const rawText = await response.text();
    let parsed: unknown = {};
    if (rawText) {
      try {
        parsed = JSON.parse(rawText) as unknown;
      } catch {
        const kind = rawText.trimStart().startsWith("<") ? "html_response" : "non_json_response";
        if (!response.ok) {
          throw new Error(`inet_nops_${stage}_http_${response.status}:${kind}`);
        }
        throw new Error(`inet_nops_${stage}_invalid_response:${kind}`);
      }
    }
    if (!response.ok) {
      throw new Error(`inet_nops_http_${response.status}:${rawText.slice(0, 240)}`);
    }
    if (!isJsonObject(parsed)) {
      throw new Error(`inet_nops_${stage}_invalid_response`);
    }
    return parsed;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("inet_nops_request_timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createInetNopsQrPayment(args: InetCreateQrArgs): Promise<InetCreateQrResult> {
  const config = resolveInetNopsConfig(args.environment);
  const amount = Number(args.amount.toFixed(2));
  if (!args.providerOrderId.trim() || args.providerOrderId.length > 30) {
    throw new Error("inet_nops_invalid_order_id");
  }
  if (!Number.isFinite(amount) || amount <= 0.01) {
    throw new Error("inet_nops_amount_must_be_greater_than_0_01");
  }

  const oauthResponse = await postJson("oauth", config.oauthUrl, {
    key: config.merchantKey,
    orderId: args.providerOrderId
  });
  requireInetSuccessCode("oauth", oauthResponse, 201);
  const oauthToken = findString(oauthResponse, ["token", "access_token", "oauthToken", "oauth_token"]);
  if (!oauthToken) {
    throw new Error("inet_nops_oauth_token_missing");
  }

  const accessTokenResponse = await postJson(
    "access_token",
    config.accessTokenUrl,
    {
      key: config.merchantKey,
      orderId: args.providerOrderId,
      orderDesc: args.orderDesc,
      amount,
      apUrl: config.apUrl,
      payType: "QR",
      regRef: ""
    },
    {
      Authorization: `Bearer ${oauthToken}`
    }
  );
  requireInetSuccessCode("access_token", accessTokenResponse, 201);
  const accessToken = findString(accessTokenResponse, ["accessToken", "access_token"]);
  const createPaymentLink = findString(accessTokenResponse, ["link", "paymentUrl", "payment_url"]);
  if (!accessToken || !createPaymentLink) {
    throw new Error("inet_nops_access_token_response_invalid");
  }

  const trustedPaymentLink = assertTrustedPaymentLink(createPaymentLink, args.environment, [
    config.oauthUrl,
    config.accessTokenUrl
  ]);
  const createResponse = await postJson("create_payment", trustedPaymentLink, { accessToken });
  requireInetSuccessCode("create_payment", createResponse, 200);
  const qrCode = findString(createResponse, ["qrCode", "qr_code", "qrcode", "qr"]);
  if (!qrCode) {
    throw new Error("inet_nops_qr_code_missing");
  }

  return {
    providerOrderId: args.providerOrderId,
    qrCode,
    ref1: findString(createResponse, ["ref1", "reference1", "reference_no_1"]),
    ref2: findString(createResponse, ["ref2", "reference2", "reference_no_2"]),
    rawCreateResponse: createResponse
  };
}

export async function testInetNopsConnection(environment: InetEnvironment): Promise<InetNopsConnectionTestResult> {
  const config = resolveInetNopsConfig(environment);
  const providerOrderId = buildConnectionProbeOrderId();
  const oauthResponse = await postJson("oauth", config.oauthUrl, {
    key: config.merchantKey,
    orderId: providerOrderId
  });
  requireInetSuccessCode("oauth", oauthResponse, 201);
  const oauthToken = findString(oauthResponse, ["token", "access_token", "oauthToken", "oauth_token"]);
  if (!oauthToken) {
    throw new Error("inet_nops_oauth_token_missing");
  }
  return { providerOrderId, environment };
}