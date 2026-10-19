import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const route = source("src/app/api/it-admin/v1/deletion-reviews/route.ts");
const consoleUi = source("src/components/it-admin/tenant-deletion-review-console.tsx");
const styles = source("src/components/it-admin/tenant-deletion-review-console.module.css");

describe("tenant deletion review: confirmation safety and table UX", () => {
  it("prevents direct API deletion without store-code confirmation and an audit reason", () => {
    expect(route).toContain('action === "delete" || action === "finalize"');
    expect(route).toContain('body?.confirmation_code');
    expect(route).toContain('tenantLookup.data.code !== confirmationCode');
    expect(route).toContain('"deletion_note_required"');
    expect(route).toContain('"invalid_store_confirmation"');
    expect(route).toContain('"deletion_review_not_ready"');
    expect(route).toContain('"deletion_retention_active"');
    expect(route).toContain("assertItSupportAction");
  });

  it("renders a searchable status-filtered table with separate review actions", () => {
    expect(consoleUi).toContain("<table");
    expect(consoleUi).toContain('type="search"');
    expect(consoleUi).toContain('value={filter}');
    expect(consoleUi).toContain('className={styles.detailsRow}');
    expect(consoleUi).toContain('openConfirmation(row, "delete")');
    expect(consoleUi).toContain('openConfirmation(row, "finalize")');
    expect(consoleUi).toContain('void act(row, "keep")');
    expect(consoleUi).toContain('void act(row, "release_mdm")');
    expect(styles).toContain("overflow-x:auto");
  });

  it("requires typed matching store code and a nonempty note for permanent deletion", () => {
    expect(consoleUi).toContain("typedCode.trim() === confirmation.row.store_code.trim()");
    expect(consoleUi).toContain("confirmationNote.trim().length > 0");
    expect(consoleUi).toContain('role="dialog"');
    expect(consoleUi).toContain('aria-modal="true"');
    expect(consoleUi).toContain('disabled={!isConfirmed || Boolean(busy)}');
    expect(consoleUi).toContain('confirmation_code: confirmationCode');
  });
  it("keeps committed deletion responses independent of a queue reload and bounds the UI wait", () => {
    expect(route).toContain('return ok({ decision, finalized });');
    expect(route).toContain('return ok({ finalized });');
    expect(route).not.toContain('return ok({ decision, finalized, ...(await loadRows(admin)) });');
    expect(consoleUi).toContain('signal: AbortSignal.timeout(35_000)');
    expect(consoleUi).toContain('signal: AbortSignal.timeout(20_000)');
    expect(consoleUi).toContain('verifyDeletionReceipt(row)');
    expect(consoleUi).toContain('void load()');
    expect(consoleUi).toContain('finalized?.deleted === true');
  });

});
