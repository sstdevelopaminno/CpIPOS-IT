import "server-only";

type DeviceSessionAccessInput = {
  activeSessionUserId?: string | null;
  employeeUserId: string;
  employeePermissions: string[];
};

export type DeviceSessionAccessDecision =
  | {
      ok: true;
      shouldRevokeExistingSession: boolean;
      overrideApplied: boolean;
    }
  | {
      ok: false;
      code: "device_in_use";
      status: 409;
      message: string;
    };

export function canOverrideInUseDevice(permissions: string[]) {
  return permissions.includes("pos.device.override_in_use");
}

export function resolveDeviceSessionAccess(input: DeviceSessionAccessInput): DeviceSessionAccessDecision {
  const activeSessionUserId = String(input.activeSessionUserId ?? "").trim();
  if (!activeSessionUserId) {
    return { ok: true, shouldRevokeExistingSession: false, overrideApplied: false };
  }

  if (activeSessionUserId === input.employeeUserId) {
    return { ok: true, shouldRevokeExistingSession: false, overrideApplied: false };
  }

  if (!canOverrideInUseDevice(input.employeePermissions)) {
    return {
      ok: false,
      code: "device_in_use",
      status: 409,
      message: "เครื่องนี้ยังมีผู้ใช้งานค้างอยู่ พนักงานขายต้องเลือกเครื่องอื่น หรือให้ผู้จัดการ/เจ้าของร้านเข้าแทน"
    };
  }

  const overrideApplied = activeSessionUserId !== input.employeeUserId;
  return {
    ok: true,
    shouldRevokeExistingSession: overrideApplied,
    overrideApplied
  };
}
