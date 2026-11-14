/**
 * Read-only aggregation of the existing POS heartbeat table for the IT dashboard.
 * A store is online if ANY active registered device has last_seen_at within
 * the same five-minute window used by the dashboard's summary counters.
 */
export type StorePresenceTenant = {
  id: string;
  code: string | null;
  name: string | null;
  display_name?: string | null;
  is_active: boolean;
};

export type StorePresenceDevice = {
  tenant_id: string | null;
  last_seen_at: string | null;
};

export type StorePresenceRow = {
  tenant_id: string;
  code: string;
  name: string;
  is_active: boolean;
  total_devices: number;
  online_devices: number;
  latest_seen_at: string | null;
};

export function summarizeStorePresence(
  tenants: StorePresenceTenant[],
  activeDevices: StorePresenceDevice[],
  onlineSince: string
): StorePresenceRow[] {
  const cutoff = Date.parse(onlineSince);
  if (!Number.isFinite(cutoff)) throw new Error("invalid_presence_cutoff");

  const stores = new Map<string, StorePresenceRow>();
  const latestTime = new Map<string, number>();
  for (const tenant of tenants) {
    if (!tenant.id || stores.has(tenant.id)) continue;
    stores.set(tenant.id, {
      tenant_id: tenant.id,
      code: tenant.code ?? "",
      name: (tenant.display_name || tenant.name || tenant.code || tenant.id).trim(),
      is_active: tenant.is_active,
      total_devices: 0,
      online_devices: 0,
      latest_seen_at: null
    });
  }

  for (const device of activeDevices) {
    if (!device.tenant_id) continue;
    const store = stores.get(device.tenant_id);
    if (!store) continue;
    store.total_devices += 1;
    const lastSeen = Date.parse(device.last_seen_at ?? "");
    if (!Number.isFinite(lastSeen)) continue;
    if (lastSeen >= cutoff) store.online_devices += 1;
    if (lastSeen > (latestTime.get(device.tenant_id) ?? -Infinity)) {
      latestTime.set(device.tenant_id, lastSeen);
      store.latest_seen_at = new Date(lastSeen).toISOString();
    }
  }

  return [...stores.values()].sort((a, b) =>
    b.online_devices - a.online_devices ||
    (latestTime.get(b.tenant_id) ?? -Infinity) - (latestTime.get(a.tenant_id) ?? -Infinity) ||
    a.name.localeCompare(b.name, "th")
  );
}
