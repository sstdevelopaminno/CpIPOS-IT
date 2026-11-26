import { describe, expect, it } from "vitest";
import { observedAgeMs, windowsPrintReadiness } from "../../src/lib/windows-print-health";
const now=Date.parse("2026-11-26T08:00:00Z");
const ago=(ms:number)=>new Date(now-ms).toISOString();
const ready={status:"active",agentSeenAt:ago(5000),deviceSeenAt:ago(120000),printerValid:true,now};
describe("Windows print readiness",()=>{
  it("does not mistake active registration for live print agent",()=>{
    expect(windowsPrintReadiness({...ready,agentSeenAt:ago(88000)}).state).toBe("agent_stale");
    expect(windowsPrintReadiness({...ready,agentSeenAt:null}).state).toBe("agent_stale");
  });
  it("distinguishes the print API's independent 180-second health gate",()=>{
    expect(windowsPrintReadiness({...ready,deviceSeenAt:ago(261000)}).state).toBe("device_health_stale");
    expect(windowsPrintReadiness(ready).state).toBe("ready");
  });
  it("requires verified printer and active enrollment",()=>{
    expect(windowsPrintReadiness({...ready,printerValid:null}).state).toBe("printer_unverified");
    expect(windowsPrintReadiness({...ready,status:"blocked"}).state).toBe("inactive");
  });
  it("treats invalid and future timestamps as unknown",()=>{
    expect(observedAgeMs("bad",now)).toBeNull();
    expect(observedAgeMs(ago(-1),now)).toBeNull();
    expect(observedAgeMs(ago(250),now)).toBe(250);
  });
});
