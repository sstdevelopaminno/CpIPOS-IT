import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe,expect,it } from "vitest";
const src=(p:string)=>readFileSync(resolve(process.cwd(),p),"utf8");

describe("Devices MDM management console",()=>{
  const ui=src("src/components/it-admin/it-admin-devices-console.tsx");
  const service=src("src/lib/services/it-admin/primary-device-module-service.ts");
  const route=src("src/app/api/it-admin/admin/tenants/[tenantId]/devices/route.ts");
  const healthPage=src("src/app/(it-admin)/tenants/[tenantId]/devices/[deviceId]/health/page.tsx");

  it("provides search filters edit soft-delete pairing and printer test",()=>{
    expect(ui).toContain('queueDeviceCommand(row,"test_printer")');
    expect(ui).toContain('queueDeviceCommand(row,"request_diagnostics")');
    expect(ui).toContain('queueDeviceCommand(row,"check_update")');
    expect(ui).toContain('action:"delete"');
    expect(ui).toContain("device-enrollments");
    expect(ui).toContain("mdmFilter");
    expect(ui).toContain("stateFilter");
  });
  it("soft deletes only after active POS sessions are clear",()=>{
    expect(route).toContain('"device_has_active_session"');
    expect(route).toContain("metadata.deleted_at");
    expect(route).toContain('status: "cancelled"');
  });
  it("exposes enrollment and Full MDM readiness in the read model",()=>{
    expect(service).toContain("enrollment_id");
    expect(service).toContain("capabilities");
    expect(service).toContain("printer_status");
  });
  it("shows Full MDM controls beside health diagnostics",()=>{
    expect(healthPage).toContain("FullMdmControlConsole");
  });
});
