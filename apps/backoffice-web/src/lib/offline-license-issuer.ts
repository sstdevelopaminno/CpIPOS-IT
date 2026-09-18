import { createECDH, createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

export const CPIPOS_LICENSE_PRODUCT = "CPIPOS-DESKTOP";
export const CPIPOS_LICENSE_ISSUER = "CUTTING-POINT-TECH-IT";
export const CPIPOS_DEVICE_CODE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
export const CPIPOS_LICENSE_ID_PATTERN = /^CP-\d{8}-[A-F0-9]{8}$/;
export const CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEIagxxGZeSGgXhE0/CBZcjTOGoROhwdIrtu+PjG24XkAZ98WpxF2quymaZbzGrzyO7+bvBnN5n3Lpg2AUK3EjQA==";
export const CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT = "4DF3:AB73:4E41:1F54:4E17:A082:851A:597F:BA08:331D:A7AF:7EAD:1D51:7970:635D:5295";

export type OfflineLicensePayload = {
  v: 1;
  product: typeof CPIPOS_LICENSE_PRODUCT;
  issuer: typeof CPIPOS_LICENSE_ISSUER;
  licenseId: string;
  customer: string;
  plan: string;
  issuedAt: string;
  notBefore: string;
  expiresAt: string | null;
  maxDevices: 1 | 2;
  devices: string[];
  features: string[];
};

export type IssueOfflineLicenseInput = {
  customer: string;
  plan: string;
  devices: string[];
  notBefore?: string | null;
  expiresAt?: string | null;
  validDays?: number | null;
  features?: string[];
  licenseId?: string | null;
};

export type IssuedOfflineLicense = {
  token: string;
  payload: OfflineLicensePayload;
  publicKeyFingerprint: string;
};

export type OfflineLicenseSignerStatus = {
  configured: boolean;
  keyMatchesDesktop: boolean;
  publicKeyFingerprint: string | null;
  expectedPublicKeyFingerprint: string;
  source: "environment" | "supabase_vault" | "missing" | "invalid";
};

function normalizePrivateKeyPem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function privateKeyPemFromVaultValue(value: string) {
  const normalized = normalizePrivateKeyPem(value.trim());
  if (normalized.startsWith("-----BEGIN")) return normalized;

  const seed = Buffer.from(normalized, "base64");
  if (seed.length !== 32) throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_INVALID");

  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(seed);
  const publicKey = ecdh.getPublicKey(undefined, "uncompressed");
  if (publicKey.length !== 65) throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_INVALID");

  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: publicKey.subarray(1, 33).toString("base64url"),
    y: publicKey.subarray(33, 65).toString("base64url"),
    d: seed.toString("base64url")
  };
  return createPrivateKey({ key: jwk, format: "jwk" }).export({ type: "pkcs8", format: "pem" }).toString();
}

function readPrivateKeyPem() {
  const direct = process.env.CPIPOS_LICENSE_PRIVATE_KEY_PEM?.trim();
  if (direct) return normalizePrivateKeyPem(direct);

  const base64 = process.env.CPIPOS_LICENSE_PRIVATE_KEY_BASE64?.trim();
  if (base64) return Buffer.from(base64, "base64").toString("utf8");

  throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED");
}

async function readPrivateKeyPemServer() {
  try {
    return { pem: readPrivateKeyPem(), source: "environment" as const };
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED") throw error;
  }

  try {
    const { getPrimarySupabaseServiceClient } = await import("@/lib/supabase-admin");
    const supabase = getPrimarySupabaseServiceClient();
    const { data, error } = await supabase.rpc("get_cpipos_license_signing_key");
    if (error) throw error;
    const value = typeof data === "string" ? data.trim() : "";
    if (value) return { pem: privateKeyPemFromVaultValue(value), source: "supabase_vault" as const };
  } catch {
    // Fail closed below. Never fall back to a browser-provided key.
  }

  throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED");
}

function derivePublicKeyDer(privateKeyPem: string) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" }) as Buffer;
}

function desktopPublicKey() {
  return createPublicKey({
    key: Buffer.from(CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64, "base64"),
    type: "spki",
    format: "der"
  });
}

function fingerprintPublicDer(publicDer: Buffer) {
  return createHash("sha256").update(publicDer).digest("hex").toUpperCase().match(/.{1,4}/g)?.join(":") ?? "";
}

function publicKeyFingerprint(privateKeyPem: string) {
  return fingerprintPublicDer(derivePublicKeyDer(privateKeyPem));
}

function privateKeyMatchesDesktop(privateKeyPem: string) {
  const publicDer = derivePublicKeyDer(privateKeyPem);
  return publicDer.toString("base64") === CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64;
}

export function getOfflineLicenseSignerStatus(): OfflineLicenseSignerStatus {
  const hasConfiguredSecret = Boolean(
    process.env.CPIPOS_LICENSE_PRIVATE_KEY_PEM?.trim() ||
      process.env.CPIPOS_LICENSE_PRIVATE_KEY_BASE64?.trim()
  );

  if (!hasConfiguredSecret) {
    return {
      configured: false,
      keyMatchesDesktop: false,
      publicKeyFingerprint: null,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      source: "missing"
    };
  }

  try {
    const privateKeyPem = readPrivateKeyPem();
    const fingerprint = publicKeyFingerprint(privateKeyPem);
    const keyMatchesDesktop = privateKeyMatchesDesktop(privateKeyPem);
    return {
      configured: keyMatchesDesktop,
      keyMatchesDesktop,
      publicKeyFingerprint: fingerprint,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      source: "environment"
    };
  } catch {
    return {
      configured: false,
      keyMatchesDesktop: false,
      publicKeyFingerprint: null,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      source: "invalid"
    };
  }
}

export async function getOfflineLicenseSignerStatusServer(): Promise<OfflineLicenseSignerStatus> {
  try {
    const resolved = await readPrivateKeyPemServer();
    const fingerprint = publicKeyFingerprint(resolved.pem);
    const keyMatchesDesktop = privateKeyMatchesDesktop(resolved.pem);
    return {
      configured: keyMatchesDesktop,
      keyMatchesDesktop,
      publicKeyFingerprint: fingerprint,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      source: keyMatchesDesktop ? resolved.source : "invalid"
    };
  } catch {
    return {
      configured: false,
      keyMatchesDesktop: false,
      publicKeyFingerprint: null,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT,
      source: "missing"
    };
  }
}

export function isOfflineLicenseSignerConfigured() {
  return getOfflineLicenseSignerStatus().configured;
}

function normalizeDeviceCodes(values: string[]) {
  const devices = values.map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (devices.length < 1 || devices.length > 2) throw new Error("LICENSE_DEVICE_COUNT_INVALID");
  if (new Set(devices).size !== devices.length) throw new Error("LICENSE_DEVICE_DUPLICATE");
  if (devices.some((value) => !CPIPOS_DEVICE_CODE_PATTERN.test(value))) throw new Error("LICENSE_DEVICE_CODE_INVALID");
  return devices;
}

function normalizeFeatures(values?: string[]) {
  const features = [...new Set((values ?? ["offline-pos"]).map((value) => value.trim().toLowerCase()).filter(Boolean))];
  if (!features.includes("offline-pos")) features.unshift("offline-pos");
  if (features.length > 16 || features.some((value) => !/^[a-z0-9][a-z0-9-]{1,47}$/.test(value))) {
    throw new Error("LICENSE_FEATURES_INVALID");
  }
  return features;
}

function parseIso(value: string, field: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field}_INVALID`);
  return new Date(timestamp).toISOString();
}

function createLicenseId(now: Date) {
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  return `CP-${date}-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function validatePayloadShape(payload: OfflineLicensePayload) {
  if (payload.v !== 1 || payload.product !== CPIPOS_LICENSE_PRODUCT || payload.issuer !== CPIPOS_LICENSE_ISSUER) {
    throw new Error("LICENSE_PRODUCT_INVALID");
  }
  if (!CPIPOS_LICENSE_ID_PATTERN.test(String(payload.licenseId ?? ""))) throw new Error("LICENSE_ID_INVALID");
  if (!payload.customer || !payload.plan) throw new Error("LICENSE_PAYLOAD_INVALID");
  const devices = normalizeDeviceCodes(Array.isArray(payload.devices) ? payload.devices : []);
  if (payload.maxDevices !== devices.length || ![1, 2].includes(payload.maxDevices)) throw new Error("LICENSE_DEVICE_COUNT_INVALID");
  normalizeFeatures(payload.features);
  const notBefore = Date.parse(payload.notBefore || payload.issuedAt);
  if (!Number.isFinite(notBefore)) throw new Error("LICENSE_NOT_BEFORE_INVALID");
  if (payload.expiresAt) {
    const expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(expires) || expires <= notBefore) throw new Error("LICENSE_EXPIRES_AT_INVALID");
  }
}

export function verifyOfflineLicenseToken(token: string): OfflineLicensePayload {
  const parts = token.trim().split(".");
  if (parts.length !== 3 || parts[0] !== "CP1") throw new Error("LICENSE_FORMAT_INVALID");
  let payload: OfflineLicensePayload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as OfflineLicensePayload;
  } catch {
    throw new Error("LICENSE_PAYLOAD_INVALID");
  }
  const signature = Buffer.from(parts[2], "base64url");
  const valid = verify(
    "sha256",
    Buffer.from(parts[1], "utf8"),
    { key: desktopPublicKey(), dsaEncoding: "ieee-p1363" },
    signature
  );
  if (!valid) throw new Error("LICENSE_SIGNATURE_INVALID");
  validatePayloadShape(payload);
  return payload;
}

function issueOfflineLicenseWithPrivateKey(input: IssueOfflineLicenseInput, privateKeyPem: string): IssuedOfflineLicense {
  const customer = input.customer.trim();
  const plan = input.plan.trim();
  if (!customer || customer.length > 120) throw new Error("LICENSE_CUSTOMER_INVALID");
  if (!plan || plan.length > 80) throw new Error("LICENSE_PLAN_INVALID");

  const devices = normalizeDeviceCodes(input.devices);
  const features = normalizeFeatures(input.features);
  if (!privateKeyMatchesDesktop(privateKeyPem)) throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_MISMATCH");
  const privateKey = createPrivateKey(privateKeyPem);
  const publicKey = createPublicKey(privateKey);
  const now = new Date();
  const issuedAt = now.toISOString();
  const notBefore = input.notBefore ? parseIso(input.notBefore, "LICENSE_NOT_BEFORE") : issuedAt;

  let expiresAt: string | null = null;
  if (input.expiresAt) {
    expiresAt = parseIso(input.expiresAt, "LICENSE_EXPIRES_AT");
  } else if (input.validDays != null) {
    const validDays = Number(input.validDays);
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650) throw new Error("LICENSE_VALID_DAYS_INVALID");
    expiresAt = new Date(Date.parse(notBefore) + validDays * 24 * 60 * 60 * 1000).toISOString();
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(notBefore)) throw new Error("LICENSE_EXPIRY_BEFORE_START");

  const requestedId = String(input.licenseId ?? "").trim().toUpperCase();
  if (requestedId && !CPIPOS_LICENSE_ID_PATTERN.test(requestedId)) throw new Error("LICENSE_ID_INVALID");

  const payload: OfflineLicensePayload = {
    v: 1,
    product: CPIPOS_LICENSE_PRODUCT,
    issuer: CPIPOS_LICENSE_ISSUER,
    licenseId: requestedId || createLicenseId(now),
    customer,
    plan,
    issuedAt,
    notBefore,
    expiresAt,
    maxDevices: devices.length as 1 | 2,
    devices,
    features
  };

  const payloadPart = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign("sha256", Buffer.from(payloadPart, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363"
  });
  const signaturePart = signature.toString("base64url");

  const verified = verify(
    "sha256",
    Buffer.from(payloadPart, "utf8"),
    { key: publicKey, dsaEncoding: "ieee-p1363" },
    signature
  );
  if (!verified) throw new Error("LICENSE_SELF_VERIFY_FAILED");

  return {
    token: `CP1.${payloadPart}.${signaturePart}`,
    payload,
    publicKeyFingerprint: publicKeyFingerprint(privateKeyPem)
  };
}

export function issueOfflineLicense(input: IssueOfflineLicenseInput): IssuedOfflineLicense {
  return issueOfflineLicenseWithPrivateKey(input, readPrivateKeyPem());
}

export async function issueOfflineLicenseServer(input: IssueOfflineLicenseInput): Promise<IssuedOfflineLicense> {
  const resolved = await readPrivateKeyPemServer();
  return issueOfflineLicenseWithPrivateKey(input, resolved.pem);
}
