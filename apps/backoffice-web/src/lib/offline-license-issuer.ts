import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from "node:crypto";

export const CPIPOS_LICENSE_PRODUCT = "CPIPOS-DESKTOP";
export const CPIPOS_LICENSE_ISSUER = "CUTTING-POINT-TECH-IT";
export const CPIPOS_DEVICE_CODE_PATTERN = /^CP-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}-[A-F0-9]{5}$/;
export const CPIPOS_DESKTOP_PUBLIC_KEY_SPKI_BASE64 = "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEs9PUGIOQlWxNNFA23/Rfcqk1yRCZN2Jq09f3qL8633xktajPKMpOY580I1MwxW5ocb826zeuthot/7FcXJASVQ==";
export const CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT = "6FE9:A194:5785:B79A:13FB:C27B:316A:A7F2:F963:443B:BD2B:4482:CF31:86CA:EAF3:8018";

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
};

function normalizePrivateKeyPem(value: string) {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function readPrivateKeyPem() {
  const direct = process.env.CPIPOS_LICENSE_PRIVATE_KEY_PEM?.trim();
  if (direct) return normalizePrivateKeyPem(direct);

  const base64 = process.env.CPIPOS_LICENSE_PRIVATE_KEY_BASE64?.trim();
  if (base64) return Buffer.from(base64, "base64").toString("utf8");

  throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_NOT_CONFIGURED");
}

function derivePublicKeyDer(privateKeyPem: string) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ type: "spki", format: "der" }) as Buffer;
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
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT
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
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT
    };
  } catch {
    return {
      configured: false,
      keyMatchesDesktop: false,
      publicKeyFingerprint: null,
      expectedPublicKeyFingerprint: CPIPOS_DESKTOP_PUBLIC_KEY_FINGERPRINT
    };
  }
}

export function isOfflineLicenseSignerConfigured() {
  return getOfflineLicenseSignerStatus().configured;
}

function normalizeDeviceCodes(values: string[]) {
  const devices = values.map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (devices.length < 1 || devices.length > 2) {
    throw new Error("LICENSE_DEVICE_COUNT_INVALID");
  }
  if (new Set(devices).size !== devices.length) {
    throw new Error("LICENSE_DEVICE_DUPLICATE");
  }
  if (devices.some((value) => !CPIPOS_DEVICE_CODE_PATTERN.test(value))) {
    throw new Error("LICENSE_DEVICE_CODE_INVALID");
  }
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

export function issueOfflineLicense(input: IssueOfflineLicenseInput): IssuedOfflineLicense {
  const customer = input.customer.trim();
  const plan = input.plan.trim();
  if (!customer || customer.length > 120) throw new Error("LICENSE_CUSTOMER_INVALID");
  if (!plan || plan.length > 80) throw new Error("LICENSE_PLAN_INVALID");

  const devices = normalizeDeviceCodes(input.devices);
  const features = normalizeFeatures(input.features);
  const privateKeyPem = readPrivateKeyPem();
  if (!privateKeyMatchesDesktop(privateKeyPem)) {
    throw new Error("CPIPOS_LICENSE_PRIVATE_KEY_MISMATCH");
  }
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
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 3650) {
      throw new Error("LICENSE_VALID_DAYS_INVALID");
    }
    expiresAt = new Date(Date.parse(notBefore) + validDays * 24 * 60 * 60 * 1000).toISOString();
  }
  if (expiresAt && Date.parse(expiresAt) <= Date.parse(notBefore)) {
    throw new Error("LICENSE_EXPIRY_BEFORE_START");
  }

  const payload: OfflineLicensePayload = {
    v: 1,
    product: CPIPOS_LICENSE_PRODUCT,
    issuer: CPIPOS_LICENSE_ISSUER,
    licenseId: createLicenseId(now),
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
