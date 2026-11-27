import { POS_SALES_MODE_KEYS, type PosSalesModeMap } from "./pos-sales-modes";

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Only an explicitly submitted true value may enable a mode.
 * Never turn all modes on when a partial admin payload is received. */
export function normalizeRequestedPosSalesModes(value: unknown): PosSalesModeMap {
  const record = asRecord(value);
  return Object.fromEntries(POS_SALES_MODE_KEYS.map((key) => [
    key, record[key] === true || (key === "takeaway" && record.takeaway === undefined && record.home === true)
  ])) as PosSalesModeMap;
}

export function getPackageSalesModeLimit(packageCode: unknown, metadata: unknown): number | null {
  if (String(packageCode ?? "").trim().toLowerCase() === "custom") return null;
  const limit = Number(asRecord(metadata).sales_mode_limit);
  if (Number.isFinite(limit) && Number.isInteger(limit) && limit > 0) {
    return Math.min(POS_SALES_MODE_KEYS.length, limit);
  }
  const canonical: Record<string, number> = { starter: 1, growth: 2, business: 3 };
  return canonical[String(packageCode ?? "").trim().toLowerCase()] ?? null;
}

export function getSelectedSalesModeCount(value: PosSalesModeMap): number {
  return POS_SALES_MODE_KEYS.filter((key) => value[key] === true && !(key === "general_sale" && value.retail_wholesale === true)).length;
}

export function getSalesModeSelectionError(
  modes: PosSalesModeMap,
  packageCode: unknown,
  packageMetadata: unknown
): string | null {
  if (modes.retail_wholesale === true) {
    if (String(packageCode ?? "").trim().toLowerCase() !== "custom") return "retail_wholesale_requires_custom";
    if (!modes.general_sale || modes.takeaway || modes.dine_in || modes.buffet_table ||
      modes.delivery || modes.optical_retail || modes.recycling) return "retail_wholesale_requires_isolated_sd_engine";
  }
  const selected = getSelectedSalesModeCount(modes);
  if (selected < 1) return "sales_mode_required";
  const limit = getPackageSalesModeLimit(packageCode, packageMetadata);
  if (limit !== null && selected > limit) return "sales_mode_limit_exceeded";
  if (String(packageCode ?? "").trim().toLowerCase() !== "custom" && modes.optical_retail) {
    return "optical_mode_requires_custom";
  }
  if (String(packageCode ?? "").trim().toLowerCase() !== "custom" && modes.recycling) {
    return "recycling_mode_requires_custom";
  }
  return null;
}
