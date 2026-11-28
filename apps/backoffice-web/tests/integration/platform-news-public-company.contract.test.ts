import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const read = (path: string) => readFileSync(resolve(process.cwd(),path),"utf8");
describe("company news publication", () => {
  it("requires opt-in and refuses tenant-specific public news", () => {
    const source = read("src/lib/platform-news-admin.ts");
    expect(source).toContain("body.publish_company_web === true");
    expect(source).toContain("publishCompanyWeb && target");
    expect(source).toContain("public_news_tenant_conflict");
  });
  it("keeps public toggle off initially and clears it for selected tenants", () => {
    const source = read("src/components/it-admin/platform-news-console.tsx");
    expect(source).toContain("publish_company_web: false");
    expect(source).toContain("publish_company_web: event.target.value ? false");
    expect(source).toContain("disabled={Boolean(form.target_tenant_id)}");
  });
});
