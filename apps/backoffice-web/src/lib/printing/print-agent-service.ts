import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase-admin";

type JsonRecord = Record<string, unknown>;

type PrintAgentRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  api_key_hash: string;
  status: "active" | "blocked" | "inactive";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: JsonRecord;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
};

export type SafePrintAgentRow = Omit<PrintAgentRow, "api_key_hash">;

type AgentJobRow = {
  id: string;
  tenant_id: string;
  branch_id: string;
  order_id: string | null;
  printer_id: string | null;
  printer_role: "receipt" | "kitchen" | "report";
  connection_type: string;
  status: "pending" | "printing" | "printed" | "failed" | "retrying";
  payload_text: string;
  payload_json: JsonRecord;
  retry_count: number;
  max_retry_count: number;
  last_error: string | null;
  metadata: JsonRecord;
  created_at: string;
  claimed_by_agent_id: string | null;
  claim_expires_at: string | null;
  printer_profiles:
    | null
    | {
    id: string;
    printer_name: string;
    printer_role: "receipt" | "kitchen" | "report";
    connection_type: string;
    ip_address: string | null;
    port: number | null;
    paper_width_mm: 58 | 80;
    enabled: boolean;
    metadata: JsonRecord;
  }
    | Array<{
        id: string;
        printer_name: string;
        printer_role: "receipt" | "kitchen" | "report";
        connection_type: string;
        ip_address: string | null;
        port: number | null;
        paper_width_mm: 58 | 80;
        enabled: boolean;
        metadata: JsonRecord;
      }>;
};

const AGENT_SELECT =
  "id,tenant_id,branch_id,device_id,device_code,agent_name,api_key_hash,status,last_seen_at,last_claim_at,app_version,metadata";

const AGENT_JOB_SELECT =
  "id,tenant_id,branch_id,order_id,printer_id,printer_role,connection_type,status,payload_text,payload_json,retry_count,max_retry_count,last_error,metadata,created_at,claimed_by_agent_id,claim_expires_at,printer_profiles(id,printer_name,printer_role,connection_type,ip_address,port,paper_width_mm,enabled,metadata)";

function hashAgentKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function ensureManagerOrOwner(auth: AuthContext) {
  if (auth.branchRole !== "manager" && auth.branchRole !== "owner") {
    throw new Error("forbidden_role");
  }
}

function toSafeAgent(row: PrintAgentRow): SafePrintAgentRow {
  const { api_key_hash: _apiKeyHash, ...safe } = row;
  return safe;
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function readBearer(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return null;
}

export function readAgentKey(req: Request) {
  return req.headers.get("x-print-agent-key")?.trim() || readBearer(req);
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readStringArray(value: unknown): string[] {
  if (typeof value === "string") return [value.trim()].filter(Boolean);
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function getPrinter(job: AgentJobRow) {
  return Array.isArray(job.printer_profiles) ? (job.printer_profiles[0] ?? null) : job.printer_profiles;
}

function printerMatchesAgent(job: AgentJobRow, agent: PrintAgentRow) {
  const printer = getPrinter(job);
  if (!printer?.enabled) return false;
  const metadata = asRecord(printer.metadata);
  const assignedAgentIds = readStringArray(metadata.assigned_agent_id ?? metadata.assigned_agent_ids ?? metadata.agent_id ?? metadata.agent_ids);
  const assignedDeviceCodes = readStringArray(
    metadata.agent_device_code ?? metadata.agent_device_codes ?? metadata.device_code ?? metadata.device_codes
  ).map((code) => code.toUpperCase());

  if (assignedAgentIds.length > 0) return assignedAgentIds.includes(agent.id);
  if (assignedDeviceCodes.length > 0) return assignedDeviceCodes.includes(agent.device_code.toUpperCase());
  return true;
}

export function agentAuthFail(error: unknown) {
  const message = error instanceof Error ? error.message : "print_agent_error";
  if (message === "agent_key_required") return fail("agent_key_required", "Print agent key is required.", 401);
  if (message === "agent_unauthorized") return fail("agent_unauthorized", "Print agent is not authorized.", 401);
  if (message === "agent_inactive") return fail("agent_inactive", "Print agent is inactive or blocked.", 403);
  return null;
}

export async function requirePrintAgent(req: Request): Promise<PrintAgentRow> {
  const rawKey = readAgentKey(req);
  if (!rawKey) throw new Error("agent_key_required");
  const keyHash = hashAgentKey(rawKey);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.from("print_agents").select(AGENT_SELECT).eq("api_key_hash", keyHash).maybeSingle();
  if (error) throw new Error(error.message);
  const agent = data as PrintAgentRow | null;
  if (!agent || !safeEqual(agent.api_key_hash, keyHash)) throw new Error("agent_unauthorized");
  if (agent.status !== "active") throw new Error("agent_inactive");
  return agent;
}

export async function listPrintAgents(auth: AuthContext): Promise<SafePrintAgentRow[]> {
  ensureManagerOrOwner(auth);
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as PrintAgentRow[]).map(toSafeAgent);
}

export async function createPrintAgent(
  auth: AuthContext,
  input: {
    agent_name: string;
    device_code: string;
    device_id?: string | null;
    app_version?: string | null;
    metadata?: JsonRecord | null;
  }
) {
  ensureManagerOrOwner(auth);
  const agentName = input.agent_name.trim();
  const deviceCode = input.device_code.trim().toUpperCase();
  if (!agentName) throw new Error("agent_name_required");
  if (!deviceCode) throw new Error("device_code_required");

  const rawKey = `cpi_pa_${randomBytes(32).toString("base64url")}`;
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .insert({
      tenant_id: auth.tenantId!,
      branch_id: auth.branchId!,
      device_id: input.device_id ?? null,
      device_code: deviceCode,
      agent_name: agentName,
      api_key_hash: hashAgentKey(rawKey),
      status: "active",
      app_version: input.app_version?.trim() || null,
      metadata: asRecord(input.metadata),
      created_by: auth.userId
    })
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .single();
  if (error) throw new Error(error.message);

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "create_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: {
      agent_name: agent.agent_name,
      device_code: agent.device_code
    }
  });

  return {
    agent: toSafeAgent(agent),
    agent_key: rawKey
  };
}

export async function revokePrintAgent(auth: AuthContext, agentId: string, status: "blocked" | "inactive" = "inactive") {
  ensureManagerOrOwner(auth);
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error("agent_id_required");
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("print_agents")
    .update({
      status,
      updated_at: new Date().toISOString()
    })
    .eq("id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("agent_not_found");

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "revoke_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: {
      agent_name: agent.agent_name,
      device_code: agent.device_code,
      status
    }
  });

  return toSafeAgent(agent);
}

export async function deletePrintAgent(auth: AuthContext, agentId: string) {
  ensureManagerOrOwner(auth);
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error("agent_id_required");
  const supabase = getSupabaseServiceClient();

  await supabase
    .from("print_jobs")
    .update({ claimed_by_agent_id: null, claim_expires_at: null, updated_at: new Date().toISOString() })
    .eq("claimed_by_agent_id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!);

  const { data, error } = await supabase
    .from("print_agents")
    .delete()
    .eq("id", normalizedAgentId)
    .eq("tenant_id", auth.tenantId!)
    .eq("branch_id", auth.branchId!)
    .select(`${AGENT_SELECT},created_by,created_at,updated_at`)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("agent_not_found");

  const agent = data as PrintAgentRow;
  await appendAuditLog({
    tenantId: auth.tenantId!,
    branchId: auth.branchId!,
    actorUserId: auth.userId,
    actorRole: auth.branchRole ?? "staff",
    action: "delete_print_agent",
    targetTable: "print_agents",
    targetId: agent.id,
    metadata: {
      agent_name: agent.agent_name,
      device_code: agent.device_code,
      status: agent.status
    }
  });

  return toSafeAgent(agent);
}

export async function touchPrintAgent(agent: PrintAgentRow, input: { appVersion?: string | null; metadata?: JsonRecord | null } = {}) {
  const supabase = getSupabaseServiceClient();
  const now = new Date().toISOString();
  const metadata = {
    ...asRecord(agent.metadata),
    ...asRecord(input.metadata),
    last_heartbeat_at: now
  };
  const { data, error } = await supabase
    .from("print_agents")
    .update({
      last_seen_at: now,
      app_version: input.appVersion ?? agent.app_version,
      metadata
    })
    .eq("id", agent.id)
    .select(AGENT_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as PrintAgentRow;
}

function leaseSeconds(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 45;
  return Math.min(300, Math.max(15, Math.trunc(parsed)));
}

function claimLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5;
  return Math.min(10, Math.max(1, Math.trunc(parsed)));
}

export async function claimPrintJobs(agent: PrintAgentRow, input: { limit?: unknown; lease_seconds?: unknown; app_version?: string | null }) {
  const supabase = getSupabaseServiceClient();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(now.getTime() + leaseSeconds(input.lease_seconds) * 1000).toISOString();
  const maxJobs = claimLimit(input.limit);

  await supabase
    .from("print_agents")
    .update({ last_seen_at: nowIso, last_claim_at: nowIso, app_version: input.app_version ?? agent.app_version })
    .eq("id", agent.id);

  const { data, error } = await supabase
    .from("print_jobs")
    .select(AGENT_JOB_SELECT)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .in("status", ["pending", "retrying", "printing"])
    .order("created_at", { ascending: true })
    .limit(30);
  if (error) throw new Error(error.message);

  const claimed: AgentJobRow[] = [];
  for (const row of ((data ?? []) as unknown as AgentJobRow[])) {
    if (claimed.length >= maxJobs) break;
    const expiredClaim = row.status === "printing" && (!row.claim_expires_at || row.claim_expires_at < nowIso);
    if (row.status === "printing" && !expiredClaim) continue;
    if (!printerMatchesAgent(row, agent)) continue;

    let updateQuery = supabase
      .from("print_jobs")
      .update({
        status: "printing",
        claimed_by_agent_id: agent.id,
        claimed_at: nowIso,
        claim_expires_at: expiresAt,
        agent_attempt_id: `${agent.id}:${row.id}:${now.getTime()}`,
        last_error: null,
        failed_at: null,
        updated_at: nowIso
      })
      .eq("id", row.id)
      .eq("tenant_id", agent.tenant_id)
      .eq("branch_id", agent.branch_id);

    updateQuery =
      row.status === "printing"
        ? updateQuery.eq("status", "printing").lt("claim_expires_at", nowIso)
        : updateQuery.in("status", ["pending", "retrying"]);

    const { data: updated, error: updateError } = await updateQuery.select(AGENT_JOB_SELECT).maybeSingle();
    if (updateError) throw new Error(updateError.message);
    if (updated) claimed.push(updated as unknown as AgentJobRow);
  }
  return claimed;
}

export async function acknowledgePrintJob(agent: PrintAgentRow, jobId: string, input: { provider_job_id?: string | null; bytes_sent?: number | null; metadata?: JsonRecord | null }) {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: current, error: currentError } = await supabase
    .from("print_jobs")
    .select("id,tenant_id,branch_id,status,metadata,claimed_by_agent_id")
    .eq("id", jobId)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current) throw new Error("print_job_not_found");
  if ((current as { claimed_by_agent_id?: string | null }).claimed_by_agent_id !== agent.id) throw new Error("print_job_not_claimed_by_agent");

  const metadata = {
    ...asRecord((current as { metadata?: unknown }).metadata),
    ...asRecord(input.metadata),
    agent_id: agent.id,
    agent_device_code: agent.device_code,
    provider_job_id: input.provider_job_id ?? null,
    bytes_sent: input.bytes_sent ?? null
  };
  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      status: "printed",
      printed_at: nowIso,
      failed_at: null,
      last_error: null,
      claim_expires_at: null,
      metadata,
      updated_at: nowIso
    })
    .eq("id", jobId)
    .eq("claimed_by_agent_id", agent.id)
    .select(AGENT_JOB_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as AgentJobRow;
}

export async function failPrintJob(agent: PrintAgentRow, jobId: string, input: { error_message?: string | null; error_code?: string | null; retryable?: boolean | null; metadata?: JsonRecord | null }) {
  const supabase = getSupabaseServiceClient();
  const nowIso = new Date().toISOString();
  const { data: current, error: currentError } = await supabase
    .from("print_jobs")
    .select("id,tenant_id,branch_id,status,retry_count,max_retry_count,metadata,claimed_by_agent_id")
    .eq("id", jobId)
    .eq("tenant_id", agent.tenant_id)
    .eq("branch_id", agent.branch_id)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);
  const row = current as null | { retry_count: number; max_retry_count: number; metadata?: unknown; claimed_by_agent_id?: string | null };
  if (!row) throw new Error("print_job_not_found");
  if (row.claimed_by_agent_id !== agent.id) throw new Error("print_job_not_claimed_by_agent");

  const nextRetryCount = Number(row.retry_count ?? 0) + 1;
  const canRetry = input.retryable !== false && nextRetryCount < Number(row.max_retry_count ?? 0);
  const metadata = {
    ...asRecord(row.metadata),
    ...asRecord(input.metadata),
    agent_id: agent.id,
    agent_device_code: agent.device_code
  };

  const { data, error } = await supabase
    .from("print_jobs")
    .update({
      status: canRetry ? "retrying" : "failed",
      retry_count: nextRetryCount,
      claimed_by_agent_id: null,
      claim_expires_at: null,
      last_error: input.error_message ?? input.error_code ?? "agent_print_failed",
      agent_error_code: input.error_code ?? null,
      failed_at: canRetry ? null : nowIso,
      metadata,
      updated_at: nowIso
    })
    .eq("id", jobId)
    .eq("claimed_by_agent_id", agent.id)
    .select(AGENT_JOB_SELECT)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as AgentJobRow;
}
