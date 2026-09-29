import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("IT printer control",()=>{
 const page=src("src/app/(it-admin)/it-admin/[module]/page.tsx");
 const ui=src("src/components/it-admin/it-admin-printer-console.tsx");
 const api=src("src/app/api/it-admin/v1/printer-control/route.ts");

 it("uses the dedicated localized printer console without duplicating MDM discovery",()=>{
  expect(page).toContain('module === "printer"');
  expect(page).toContain("ItAdminPrinterConsole");
  expect(ui).toContain('title:"เครื่องพิมพ์ / Print Agent"');
  expect(ui).toContain('title:"Printer / Print Agent"');
  expect(ui).not.toContain("remoteTargetsTitle");
  expect(ui).not.toContain("discoverHere");
  expect(ui).not.toContain("remoteDiscovery(target)");
 });

 it("supports search, edit, test and delete while MDM discovery stays outside this page",()=>{
  expect(ui).toContain("setQuery");
  expect(api).toContain('command_type:"request_diagnostics"');
  expect(api).toContain('command_type:"test_printer"');
  expect(api).toContain("export async function PATCH");
  expect(api).toContain("export async function DELETE");
  expect(api).toContain('namespace:"it_printer_control_write"');
  expect(api).toContain('namespace:"it_printer_control_delete"');
  expect(api).toContain('.eq("is_active",true).neq("status","disabled")');
  expect(ui).toContain("removeFromSnapshot(row)");
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
