export type TrialPackageRevisionState = {
  contractStatus: string | null | undefined;
  currentPackageId: string | null | undefined;
  requestedPackageId: string | null | undefined;
  adminReason: string | null | undefined;
  hasOpenPaymentRequest: boolean;
  prepaidActivationPending: boolean;
  hasSettledTrialPayment: boolean;
  hasContractConflict: boolean;
};

export type TrialPackageRevisionDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/** Trial plan revisions never activate paid service, settle invoices or rewrite
 * financial evidence. Same-tenant/current-contract validation is server-owned.
 */
export function decideTrialPackageRevision(state: TrialPackageRevisionState): TrialPackageRevisionDecision {
  if (state.contractStatus !== "trial") {
    return { allowed: false, code: "trial_only", message: "แก้แพ็กเกจทดลองได้เฉพาะสัญญาที่ยังมีสถานะ Trial เท่านั้น แพ็กเกจชำระเงินจริงต้องผ่านขั้นตอนตรวจรับชำระ" };
  }
  if (state.hasContractConflict) {
    return { allowed: false, code: "contract_integrity_conflict", message: "พบสัญญาทับซ้อน กรุณาตรวจสอบประวัติสัญญาก่อนเปลี่ยนแพ็กเกจ" };
  }
  if (state.prepaidActivationPending || state.hasSettledTrialPayment) {
    return { allowed: false, code: "trial_payment_protected", message: "มีสิทธิ์ชำระล่วงหน้าหรือหลักฐานรับเงินแล้ว กรุณาตรวจสอบรอบชำระก่อนเปลี่ยนแพ็กเกจ" };
  }
  if (state.hasOpenPaymentRequest) {
    return { allowed: false, code: "open_payment_request_exists", message: "มีรายการชำระรอตรวจสอบอยู่ กรุณาจัดการรายการเดิมก่อนเปลี่ยนแพ็กเกจทดลอง" };
  }
  if (!state.requestedPackageId || state.requestedPackageId === state.currentPackageId) {
    return { allowed: false, code: "choose_another_package", message: "กรุณาเลือกแพ็กเกจใหม่ที่แตกต่างจากแพ็กเกจเดิม" };
  }
  if ((state.adminReason ?? "").trim().length < 4) {
    return { allowed: false, code: "it_reason_required", message: "กรุณาระบุเหตุผลการเปลี่ยนแพ็กเกจอย่างน้อย 4 ตัวอักษรเพื่อบันทึก Audit" };
  }
  return { allowed: true };
}
