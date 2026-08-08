import "server-only";

import crypto from "node:crypto";
import type { NextResponse } from "next/server";
import { readRequiredEnv } from "@/lib/env";

export type PreEntryStage = "store_verified" | "branch_selected" | "employee_verified";
export type EmployeeAuthMethod = "employee_code";

export type PreEntryFlowState = {
  stage: PreEntryStage;
  tenantId: string;
  storeCode: string;
  tenantName: string;
  branchId?: string | null;
  branchCode?: string | null;
  branchName?: string | null;
  userId?: string | null;
  userRole?: "owner" | "manager" | "staff" | "accountant" | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  employeeAuthMethod?: EmployeeAuthMethod | null;
  permissions?: string[] | null;
  iat: number;
  exp: number;
};

type SignedFlowPayload = {
  v: 1;
  data: PreEntryFlowState;
};

const DEFAULT_TTL_SECONDS = 20 * 60;

function getFlowCookieName() {
  return String(process.env.POS_PREENTRY_FLOW_COOKIE_NAME ?? "ipos_login_flow").trim() || "ipos_login_flow";
}

function resolveFlowTtlSeconds() {
  const raw = Number(process.env.POS_PREENTRY_FLOW_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(raw)) return DEFAULT_TTL_SECONDS;
  const normalized = Math.trunc(raw);
  if (normalized < 120 || normalized > 3600) return DEFAULT_TTL_SECONDS;
  return normalized;
}

function resolveCookieSecurity() {
  const secureEnv = String(process.env.POS_SESSION_COOKIE_SECURE ?? "").trim().toLowerCase();
  if (!secureEnv) return process.env.NODE_ENV === "production";
  return secureEnv === "1" || secureEnv === "true";
}

function resolveCookieDomain() {
  return String(process.env.POS_SESSION_COOKIE_DOMAIN ?? "").trim() || undefined;
}

function flowSecret() {
  const custom = String(process.env.POS_PREENTRY_FLOW_SECRET ?? "").trim();
  if (custom) return custom;
  return readRequiredEnv("POS_SESSION_HANDOFF_SECRET");
}

function sign(payloadEncoded: string) {
  return crypto.createHmac("sha256", flowSecret()).update(payloadEncoded).digest("base64url");
}

function secureEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function encodePayload(payload: SignedFlowPayload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(raw: string): SignedFlowPayload | null {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as SignedFlowPayload;
    if (!parsed || typeof parsed !== "object" || parsed.v !== 1 || !parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseToken(token: string): PreEntryFlowState | null {
  const normalized = String(token ?? "").trim();
  if (!normalized) return null;
  const [encoded, signature] = normalized.split(".");
  if (!encoded || !signature) return null;
  if (!secureEquals(signature, sign(encoded))) return null;
  const payload = decodePayload(encoded);
  if (!payload) return null;
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(payload.data.exp) || payload.data.exp <= now) return null;
  return payload.data;
}

function createToken(state: PreEntryFlowState) {
  const encoded = encodePayload({ v: 1, data: state });
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

export function createFlowState(input: Omit<PreEntryFlowState, "iat" | "exp">): PreEntryFlowState {
  const now = Math.floor(Date.now() / 1000);
  return {
    ...input,
    iat: now,
    exp: now + resolveFlowTtlSeconds()
  };
}

type CookieReader = {
  get: (name: string) => { value: string } | undefined;
};

export function readPreEntryFlowState(cookieStore: CookieReader): PreEntryFlowState | null {
  const token = cookieStore.get(getFlowCookieName())?.value ?? "";
  return parseToken(token);
}

export function writePreEntryFlowState(response: NextResponse, state: PreEntryFlowState) {
  response.cookies.set({
    name: getFlowCookieName(),
    value: createToken(state),
    httpOnly: true,
    secure: resolveCookieSecurity(),
    sameSite: "lax",
    domain: resolveCookieDomain(),
    path: "/",
    maxAge: resolveFlowTtlSeconds()
  });
}

export function clearPreEntryFlowState(response: NextResponse) {
  response.cookies.set({
    name: getFlowCookieName(),
    value: "",
    httpOnly: true,
    secure: resolveCookieSecurity(),
    sameSite: "lax",
    domain: resolveCookieDomain(),
    path: "/",
    maxAge: 0
  });
}

export function hasFlowStage(state: PreEntryFlowState | null, allowed: PreEntryStage[]) {
  if (!state) return false;
  return allowed.includes(state.stage);
}
