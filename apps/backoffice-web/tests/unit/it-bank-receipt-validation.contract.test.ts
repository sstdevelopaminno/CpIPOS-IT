import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const ui=readFileSync(resolve(process.cwd(),"src/components/it-admin/subscription-payment-history.tsx"),"utf8");
const api=readFileSync(resolve(process.cwd(),"src/app/api/it-admin/v1/subscription-payments/settle/[requestId]/route.ts"),"utf8");
describe("IT subscription bank approval timestamp",()=>{
 it("asks IT for separate real bank date and time, never trusts uploaded customer timestamp",()=>{
   expect(ui).toContain("bank_received_date");
   expect(ui).toContain("bank_received_time");
   expect(ui).toContain('type="date" aria-label="วันที่เงินเข้าจริง"');
   expect(ui).toContain('type="time" aria-label="เวลาเงินเข้าจริง"');
   expect(ui).toContain('bank_received_date: ""');
   expect(ui).toContain('bank_received_time: ""');
   expect(ui).not.toContain('type="datetime-local" value={draft.bank_received_at}');
   expect(ui).not.toContain('new Date(draft.bank_received_at).toISOString()');
 });
 it("rejects missing or impossible bank timestamps before network and keeps errors visible",()=>{
  expect(ui).toContain("parseBankReceivedAt(draft.bank_received_date,draft.bank_received_time)");
  expect(ui).toContain('!/^\\d{2}:\\d{2}$/.test(time)');
  expect(ui).toContain('role="alert" className="rounded-lg border border-rose-200');
  expect(ui).toContain('setSettlementErrors((prev)=>({...prev,[row.id]:msg}))');
  expect(ui).toContain('bank_received_at: actualReceivedAt');
  expect(ui).toContain('confirmed_bank_receipt: true');
 });
 it("IT API settles only confirmed bank credit and never auto-approves a slip",()=>{
  expect(api).toContain("body?.confirmed_bank_receipt !== true");
  expect(api).toContain('supabase.rpc("settle_subscription_payment"');
  expect(api).toContain('new Date(parsedReceivedAt).toISOString()');
 });
});
