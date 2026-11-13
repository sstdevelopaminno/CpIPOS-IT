import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const migration=readFileSync(resolve(process.cwd(),"../../supabase/migrations/20261114085000_paid_suspension_notice_requires_actual_lock.sql"),"utf8");
describe("subscription suspension notification requires actual lock",()=>{
  it("checks the authoritative lifecycle before announcing suspension",()=>{
    expect(migration).toContain("l.access_locked as actual_access_locked");
    expect(migration).toContain("l.lifecycle_status as actual_lifecycle_status");
    expect(migration).toContain("actual_access_locked=true and actual_lifecycle_status='expired'");
    expect(migration).toContain("paid_suspended_notice");
  });
});
