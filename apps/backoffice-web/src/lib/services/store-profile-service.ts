import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";

export type ReceiptStoreProfile = {
  tenant_id: string;
  code: string;
  name: string;
  display_name: string;
  logo_url: string;
  company_address: string;
  contact_phone: string;
};

type TenantStoreProfileRow = {
  id: string;
  code: string | null;
  name: string | null;
  display_name?: string | null;
  logo_url?: string | null;
  company_address?: string | null;
  contact_phone?: string | null;
  owner_phone?: string | null;
};

function trimText(value: unknown) {
  return String(value ?? "").trim();
}

export function mapReceiptStoreProfile(row: TenantStoreProfileRow): ReceiptStoreProfile {
  const name = trimText(row.name);
  return {
    tenant_id: row.id,
    code: trimText(row.code),
    name,
    display_name: trimText(row.display_name) || name,
    logo_url: trimText(row.logo_url),
    company_address: trimText(row.company_address),
    contact_phone: trimText(row.contact_phone) || trimText(row.owner_phone)
  };
}

export async function loadReceiptStoreProfile(tenantId: string): Promise<ReceiptStoreProfile | null> {
  const normalizedTenantId = trimText(tenantId);
  if (!normalizedTenantId) return null;
  try {
    const supabase = getSupabaseServiceClient();
    const { data, error } = await supabase
      .from("tenants")
      .select("id,code,name,display_name,logo_url,company_address,contact_phone,owner_phone")
      .eq("id", normalizedTenantId)
      .maybeSingle<TenantStoreProfileRow>();
    if (error) return null;
    return data ? mapReceiptStoreProfile(data) : null;
  } catch {
    return null;
  }
}
