import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import type { SupportMailMessage, SupportMailThreadSummary } from "@/lib/services/it-admin/support-mail-service";

const INTERNAL_EMAILS = new Set([
  "cuttingpointtech.support@gmail.com",
  "cuttingpointtech@gmail.com"
]);

export type SupportMailStoreContext = {
  matched: boolean;
  ambiguous: boolean;
  match_source: "store_code" | "account_email" | "registration_email" | "provisioning_email" | null;
  matched_email: string | null;
  candidates: number;
  tenant_id: string | null;
  branch_id: string | null;
  store_code: string | null;
  store_name: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  package_name: string | null;
  is_active: boolean | null;
  open_incident_count: number;
  linked_incident: {
    id: string;
    title: string;
    status: string;
    severity: string;
    detected_at: string;
  } | null;
};

const EMPTY_CONTEXT: SupportMailStoreContext = {
  matched: false,
  ambiguous: false,
  match_source: null,
  matched_email: null,
  candidates: 0,
  tenant_id: null,
  branch_id: null,
  store_code: null,
  store_name: null,
  owner_name: null,
  owner_phone: null,
  owner_email: null,
  package_name: null,
  is_active: null,
  open_incident_count: 0,
  linked_incident: null
};

function extractEmails(thread: SupportMailThreadSummary, messages: SupportMailMessage[]) {
  const text = [
    thread.from,
    thread.to,
    ...messages.flatMap((message) => [message.from, message.to, message.cc])
  ].join("\n").toLowerCase();

  const matches = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  return Array.from(new Set(matches.map((email) => email.trim())))
    .filter((email) => !INTERNAL_EMAILS.has(email))
    .slice(0, 8);
}

function extractExplicitStoreCodes(thread: SupportMailThreadSummary, messages: SupportMailMessage[]) {
  const text = [
    thread.subject,
    ...messages.map((message) => message.subject),
    ...messages.map((message) => message.body)
  ].join("\n");

  const codes = new Set<string>();
  const patterns = [
    /(?:store\s*code|storecode|รหัสร้านค้า|รหัสร้าน|รหัสเจ้าของร้าน)\s*[:#\-]?\s*(\d{6})(?!\d)/gi,
    /(?:ร้าน|store)\s*[#:：\-]?\s*(\d{6})(?!\d)/gi
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text))) {
      if (match[1]) codes.add(match[1]);
      if (codes.size >= 6) break;
    }
  }
  return Array.from(codes);
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export async function resolveSupportMailStoreContext(input: {
  threadId: string;
  thread: SupportMailThreadSummary;
  messages: SupportMailMessage[];
}): Promise<SupportMailStoreContext> {
  const db = getSupabaseServiceClient();
  const emails = extractEmails(input.thread, input.messages);
  const storeCodes = extractExplicitStoreCodes(input.thread, input.messages);

  const [codeRowsResult, profilesResult, registrationsResult, provisioningResult] = await Promise.all([
    storeCodes.length
      ? db.from("pos_login_contexts")
          .select("tenant_id,branch_id,store_code,created_at")
          .in("store_code", storeCodes)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    emails.length
      ? db.from("users_profiles")
          .select("id,email")
          .in("email", emails)
          .eq("is_active", true)
          .is("archived_at", null)
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    emails.length
      ? db.from("store_registration_requests")
          .select("tenant_id,store_name,owner_name,owner_email,owner_phone,status,created_at")
          .in("owner_email", emails)
          .not("tenant_id", "is", null)
          .neq("status", "deleted")
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null }),
    emails.length
      ? db.from("it_store_provisioning_requests")
          .select("tenant_id,branch_id,owner_email,status,result,created_at")
          .in("owner_email", emails)
          .not("tenant_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(30)
      : Promise.resolve({ data: [], error: null })
  ]);

  for (const result of [codeRowsResult, profilesResult, registrationsResult, provisioningResult]) {
    if (result.error) return EMPTY_CONTEXT;
  }

  const profiles = (profilesResult.data ?? []) as Array<{ id: string; email: string | null }>;
  const userIds = profiles.map((row) => row.id);
  const roleResult = userIds.length
    ? await db.from("user_branch_roles")
        .select("user_id,tenant_id,branch_id,role")
        .in("user_id", userIds)
        .limit(80)
    : { data: [], error: null };
  if (roleResult.error) return EMPTY_CONTEXT;

  const codeRows = (codeRowsResult.data ?? []) as Array<{ tenant_id: string; branch_id: string | null; store_code: string; created_at: string }>;
  const roles = (roleResult.data ?? []) as Array<{ user_id: string; tenant_id: string; branch_id: string | null; role: string }>;
  const registrations = (registrationsResult.data ?? []) as Array<{
    tenant_id: string;
    store_name: string;
    owner_name: string;
    owner_email: string;
    owner_phone: string;
    status: string;
    created_at: string;
  }>;
  const provisionings = (provisioningResult.data ?? []) as Array<{
    tenant_id: string;
    branch_id: string | null;
    owner_email: string;
    status: string;
    result: Record<string, unknown> | null;
    created_at: string;
  }>;

  const profileEmailById = new Map(profiles.map((row) => [row.id, String(row.email ?? "").toLowerCase()]));
  const sourceGroups = [
    {
      source: "store_code" as const,
      tenantIds: unique(codeRows.map((row) => row.tenant_id))
    },
    {
      source: "account_email" as const,
      tenantIds: unique(roles.map((row) => row.tenant_id))
    },
    {
      source: "registration_email" as const,
      tenantIds: unique(registrations.map((row) => row.tenant_id))
    },
    {
      source: "provisioning_email" as const,
      tenantIds: unique(provisionings.map((row) => row.tenant_id))
    }
  ];

  const allTenantIds = unique(sourceGroups.flatMap((group) => group.tenantIds));
  if (!allTenantIds.length) return EMPTY_CONTEXT;

  let chosenTenantId: string | null = allTenantIds.length === 1 ? allTenantIds[0] : null;
  let matchSource: SupportMailStoreContext["match_source"] = null;

  if (!chosenTenantId) {
    const decisive = sourceGroups.find((group) => group.tenantIds.length === 1);
    if (decisive) {
      chosenTenantId = decisive.tenantIds[0];
      matchSource = decisive.source;
    }
  } else {
    matchSource = sourceGroups.find((group) => group.tenantIds.includes(chosenTenantId!))?.source ?? null;
  }

  if (!chosenTenantId) {
    return {
      ...EMPTY_CONTEXT,
      ambiguous: true,
      candidates: allTenantIds.length
    };
  }

  const codeMatch = codeRows.find((row) => row.tenant_id === chosenTenantId);
  const roleMatches = roles.filter((row) => row.tenant_id === chosenTenantId);
  const branchIds = unique([
    codeMatch?.branch_id,
    ...roleMatches.map((row) => row.branch_id)
  ]);
  const branchId = branchIds.length === 1 ? branchIds[0] : null;

  const matchedProfile = roleMatches
    .map((role) => profileEmailById.get(role.user_id) ?? "")
    .find((email) => emails.includes(email));
  const matchedRegistration = registrations.find((row) => row.tenant_id === chosenTenantId);
  const matchedProvisioning = provisionings.find((row) => row.tenant_id === chosenTenantId);

  const [tenantResult, loginResult, registrationResult, completedProvisioningResult, incidentsResult] = await Promise.all([
    db.from("tenants")
      .select("id,name,display_name,owner_name,owner_phone,package_id,is_active")
      .eq("id", chosenTenantId)
      .maybeSingle(),
    db.from("pos_login_contexts")
      .select("store_code,created_at")
      .eq("tenant_id", chosenTenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("store_registration_requests")
      .select("owner_name,owner_email,owner_phone,created_at")
      .eq("tenant_id", chosenTenantId)
      .neq("status", "deleted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("it_store_provisioning_requests")
      .select("owner_email,result,created_at")
      .eq("tenant_id", chosenTenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("it_manual_incidents")
      .select("id,title,status,severity,code,message,detected_at")
      .eq("tenant_id", chosenTenantId)
      .neq("status", "resolved")
      .order("detected_at", { ascending: false })
      .limit(30)
  ]);

  if (tenantResult.error || loginResult.error || registrationResult.error || completedProvisioningResult.error || incidentsResult.error) {
    return EMPTY_CONTEXT;
  }

  const tenant = tenantResult.data as {
    id: string;
    name: string;
    display_name: string | null;
    owner_name: string | null;
    owner_phone: string | null;
    package_id: string | null;
    is_active: boolean;
  } | null;
  if (!tenant) return EMPTY_CONTEXT;

  const packageResult = tenant.package_id
    ? await db.from("subscription_packages").select("name,code").eq("id", tenant.package_id).maybeSingle()
    : { data: null, error: null };

  const latestProvisioning = completedProvisioningResult.data as {
    owner_email: string | null;
    result: Record<string, unknown> | null;
  } | null;
  const provisioningStoreCode = String(latestProvisioning?.result?.store_code ?? "").trim();
  const storeCode = String(
    codeMatch?.store_code ||
    (loginResult.data as { store_code?: string } | null)?.store_code ||
    (/^\d{6}$/.test(provisioningStoreCode) ? provisioningStoreCode : "")
  ).trim() || null;

  const latestRegistration = registrationResult.data as {
    owner_name: string | null;
    owner_email: string | null;
    owner_phone: string | null;
  } | null;
  const incidents = (incidentsResult.data ?? []) as Array<{
    id: string;
    title: string;
    status: string;
    severity: string;
    code: string;
    message: string;
    detected_at: string;
  }>;
  const linkedIncident = incidents.find((row) =>
    row.code === "SUPPORT_MAIL" &&
    String(row.message ?? "").includes(`Support Mail Thread: ${input.threadId}`)
  ) ?? null;

  const matchedEmail =
    matchedProfile ||
    matchedRegistration?.owner_email?.toLowerCase() ||
    matchedProvisioning?.owner_email?.toLowerCase() ||
    emails.find((email) => email === latestRegistration?.owner_email?.toLowerCase()) ||
    null;

  return {
    matched: true,
    ambiguous: false,
    match_source: matchSource,
    matched_email: matchedEmail,
    candidates: 1,
    tenant_id: chosenTenantId,
    branch_id: branchId,
    store_code: storeCode,
    store_name: tenant.display_name || tenant.name || matchedRegistration?.store_name || null,
    owner_name: latestRegistration?.owner_name || tenant.owner_name || null,
    owner_phone: latestRegistration?.owner_phone || tenant.owner_phone || null,
    owner_email: latestRegistration?.owner_email || latestProvisioning?.owner_email || null,
    package_name: String((packageResult.data as { name?: string } | null)?.name ?? "") || null,
    is_active: Boolean(tenant.is_active),
    open_incident_count: incidents.length,
    linked_incident: linkedIncident ? {
      id: linkedIncident.id,
      title: linkedIncident.title,
      status: linkedIncident.status,
      severity: linkedIncident.severity,
      detected_at: linkedIncident.detected_at
    } : null
  };
}
