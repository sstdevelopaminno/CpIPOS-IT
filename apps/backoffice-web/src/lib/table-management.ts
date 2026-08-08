import type { BranchRole, FloorPlanObjectType, TableShape, TableStatus } from "@pos/shared-types";

export const tableStatuses: TableStatus[] = [
  "available",
  "occupied",
  "ordering",
  "pending_payment",
  "reserved",
  "disabled"
];

export const tableShapes: TableShape[] = ["square", "rectangle", "circle"];
export const floorObjectTypes: FloorPlanObjectType[] = ["counter", "cashier", "partition", "plant", "entrance", "service_station"];

export const tableStatusColorMap: Record<TableStatus, string> = {
  available: "#16a34a",
  occupied: "#f97316",
  ordering: "#2563eb",
  pending_payment: "#dc2626",
  reserved: "#7c3aed",
  disabled: "#6b7280"
};

export const floorObjectDefaults: Record<FloorPlanObjectType, { name: string; color: string; width: number; height: number }> = {
  counter: { name: "Counter", color: "#475569", width: 140, height: 68 },
  cashier: { name: "Cashier", color: "#0369a1", width: 120, height: 64 },
  partition: { name: "Partition", color: "#7c2d12", width: 160, height: 22 },
  plant: { name: "Plant", color: "#166534", width: 56, height: 56 },
  entrance: { name: "Entrance", color: "#7c3aed", width: 120, height: 46 },
  service_station: { name: "Service", color: "#b45309", width: 108, height: 62 }
};

export function canManageTables(role: BranchRole | null): boolean {
  return role === "owner" || role === "manager";
}

function splitNatural(value: string): Array<string | number> {
  return value
    .toUpperCase()
    .match(/[A-Z]+|\d+/g)
    ?.map((part) => (/^\d+$/.test(part) ? Number(part) : part)) ?? [value.toUpperCase()];
}

export function naturalCompareTableCode(aCode: string, bCode: string): number {
  const a = splitNatural(aCode);
  const b = splitNatural(bCode);
  const max = Math.max(a.length, b.length);

  for (let index = 0; index < max; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === undefined) return -1;
    if (right === undefined) return 1;

    if (typeof left === "number" && typeof right === "number") {
      if (left !== right) return left - right;
      continue;
    }

    const leftValue = String(left);
    const rightValue = String(right);
    const cmp = leftValue.localeCompare(rightValue, "en", { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp;
  }

  return 0;
}

export function getEffectiveTableStatus(args: {
  isActive: boolean;
  baseStatus: TableStatus;
  sessionStatus?: string | null;
}): TableStatus {
  if (!args.isActive || args.baseStatus === "disabled") {
    return "disabled";
  }

  if (args.sessionStatus === "open") return "occupied";
  if (args.sessionStatus === "ordering") return "ordering";
  if (args.sessionStatus === "pending_payment") return "pending_payment";

  return args.baseStatus;
}
