import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT printer control",()=>{
 const page=src("src/app/(it-admin)/it-admin/[module]/page.tsx");
 const ui=src("src/components/it-admin/it-admin-printer-console.tsx");
 const api=src("src/app/api/it-admin/v1/printer-control/route.ts");

 it("uses the dedicated localized printer console and surfaces POS runtimes for support",()=>{
  expect(page).toContain('module === "printer"');
  expect(page).toContain("ItAdminPrinterConsole");
  expect(ui).toContain('title:"เครื่องพิมพ์ / Print Agent"');
  expect(ui).toContain('title:"Printer / Print Agent"');
  expect(ui).toContain('runtimes:"POS Runtime"');
  expect(ui).toContain("discover(row?:Row)");
  expect(ui).toContain('action:"discover"');
 });

 it("supports search, remote diagnostics, test, edit and delete from one support surface",()=>{
  expect(ui).toContain("setQuery");
  expect(ui).toContain("row.tenant_id");
  expect(ui).toContain("row.runtime_device_code");
  expect(ui).toContain("row.remote_device_name");
  expect(ui).toContain("row.connection");
  expect(ui).toContain('value="runtime"');
  expect(api).toContain('resource_type:"runtime" as const');
  expect(api).toContain('command_type:"request_diagnostics"');
  expect(api).toContain('command_type:"test_printer"');
  expect(api).toContain('resourceType!=="runtime"');
  expect(api).toContain("export async function PATCH");
  expect(api).toContain("export async function DELETE");
  expect(api).toContain('namespace:"it_printer_control_write"');
  expect(api).toContain('namespace:"it_printer_control_delete"');
  expect(api).toContain('.eq("is_active",true).neq("status","disabled")');
  expect(ui).toContain("removeFromSnapshot(row)");
 });

 it("keeps support tables visible and moves printer health into a diagnostics popup",()=>{
  expect(ui).toContain('overview:"ภาพรวม / Diagnostics"');
  expect(ui).toContain("diagnosticsOpen");
  expect(ui).toContain("setDiagnosticsOpen(true)");
  expect(ui).toContain('role="dialog"');
  expect(ui).toContain("data?.print_health.p95_total_ms");
  expect(ui).toContain("rows.map(row=>");
 });

 it("reports queue health and latency with explicit millisecond/second units",()=>{
  expect(api).toContain("p95_queue_to_claim_ms");
  expect(api).toContain("p95_claim_to_print_ms");
  expect(api).toContain("p95_total_ms");
  expect(api).toContain("telemetry_stale");
  expect(api).toContain("top_failures");
  expect(api).toContain("stale_claims");
  expect(api).toContain("retried_24h");
  expect(api).toContain("slow_queue_24h");
  expect(api).toContain("slow_transport_24h");
  expect(api).toContain("transport_failures");
  expect(ui).toContain('return `\${Math.round(value)} ms`');
  expect(ui).toContain('return `\${(value/1000).toFixed');
  expect(ui).toContain("data?.print_health.p95_total_ms");
  expect(ui).toContain("data?.print_health.p95_queue_to_claim_ms");
  expect(ui).toContain("data?.print_health.p95_claim_to_print_ms");
  expect(ui).toContain("data?.print_health.stale_claims");
  expect(ui).toContain("Telemetry งานพิมพ์ไม่สด");
 });

 it("preserves print history when removing a printer and safely releases agent claims",()=>{
  expect(api).toContain('is_active:false,status:"disabled"');
  expect(api).toContain("PRINTER_DB_STATUSES");
  expect(api).toContain("normalizePrinterStatus");
  expect(api).not.toContain('is_active:false,status:"inactive"');
  expect(api).toContain("claimed_by_agent_id:null");
  expect(api).toContain("it_printer_removed");
  expect(api).toContain("it_print_agent_deleted");
  expect(api).toContain('metadata:{display_name:current.data.display_name,recoverable:true}');
 });
});
