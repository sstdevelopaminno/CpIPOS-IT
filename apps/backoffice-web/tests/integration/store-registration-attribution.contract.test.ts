import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("CpiPOS public registration UTM persistence contract", () => {
  const route = read("src/app/api/store-registration/route.ts");
  const migration = read("../../supabase/migrations/20261121010000_store_registration_marketing_attribution.sql");

  it("validates untrusted tags and writes only to marketing_attribution", () => {
    expect(route).toContain("sanitizeMarketingAttribution(body.marketing_attribution)");
    expect(route).toContain("marketing_attribution_supported: true");
    expect(route).toContain("marketing_attribution: marketingAttribution");
    expect(route).toContain('source: isCustom ? "cpipos_website_custom" : "cpipos_website"');
    expect(route).toContain('status: "pending"');
    expect(route).not.toContain("source: body.source");
    expect(route).not.toContain("tenant_id: body.tenant_id");
  });

  it("keeps historical applications unknown and the schema additive", () => {
    expect(migration).toContain("add column if not exists marketing_attribution jsonb not null default '{}'::jsonb");
    expect(migration).toContain("jsonb_typeof(marketing_attribution) = 'object'");
    expect(migration).not.toContain("update public.store_registration_requests");
    expect(migration).not.toContain("insert into public.store_registration_requests");
    expect(migration).not.toContain("grant all");
  });
});
