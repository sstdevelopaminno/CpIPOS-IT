export type OfflineSaleQueueStatus = "queued" | "syncing" | "synced" | "failed" | "voided";

export type OfflineSalePaymentMethod = "cash";

export type OfflineSaleCartItem = {
  product_id: string;
  sku?: string | null;
  name: string;
  category?: string | null;
  quantity: number;
  unit_price: number;
  line_total: number;
  notes?: string | null;
  tax_lines?: Array<{ id: string; label: string; amount: number }>;
};

export type OfflineSaleTotals = {
  subtotal: number;
  discount_amount: number;
  tax_total: number;
  total_amount: number;
  cash_received: number;
  change_amount: number;
};

export type OfflineCashSaleInput = {
  tenant_id: string;
  branch_id: string;
  shift_id: string | null;
  user_id: string;
  device_id?: string | null;
  device_code: string;
  branch_code?: string | null;
  seller_name?: string | null;
  order_no?: string | null;
  order_type: "takeaway" | "dine_in" | "delivery" | string;
  table_id?: string | null;
  items: OfflineSaleCartItem[];
  totals: OfflineSaleTotals;
  receipt_html?: string | null;
  metadata?: Record<string, unknown>;
};

export type OfflineSaleQueueEntry = OfflineCashSaleInput & {
  id: string;
  order_no: string;
  local_sequence: number;
  local_business_date: string;
  payment_method: OfflineSalePaymentMethod;
  status: OfflineSaleQueueStatus;
  created_at: string;
  updated_at: string;
  sync_attempts: number;
  last_sync_attempt_at: string | null;
  last_sync_error: string | null;
  server_order_id: string | null;
  synced_at: string | null;
  void_reason: string | null;
};

export type OfflineCatalogSnapshot = {
  id: string;
  tenant_id: string;
  branch_id: string;
  branch_code?: string | null;
  device_code?: string | null;
  saved_at: string;
  version: number;
  products: Array<Record<string, unknown>>;
  categories: string[];
  tables?: Array<Record<string, unknown>>;
  tax_rules?: Array<Record<string, unknown>>;
  promotions?: Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
};

export type OfflineSaleSummary = {
  queued: number;
  syncing: number;
  synced: number;
  failed: number;
  voided: number;
  total_unsynced_amount: number;
};

type OfflineMetaRecord = {
  key: string;
  value: unknown;
  updated_at: string;
};

const OFFLINE_DB_NAME = "cpipos-offline-sale";
const OFFLINE_DB_VERSION = 1;
const STORE_META = "meta";
const STORE_CATALOG = "catalog_snapshots";
const STORE_SALES = "offline_sales";
const RECEIPT_COUNTER_PREFIX = "cpipos_offline_receipt_counter_v1";

let databasePromise: Promise<IDBDatabase> | null = null;

function assertIndexedDbAvailable() {
  if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
    throw new Error("cpipos_offline_indexeddb_unavailable");
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("cpipos_indexeddb_request_failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("cpipos_indexeddb_transaction_aborted"));
    transaction.onerror = () => reject(transaction.error ?? new Error("cpipos_indexeddb_transaction_failed"));
  });
}

function createStoreIfMissing(database: IDBDatabase, name: string, options: IDBObjectStoreParameters) {
  if (!database.objectStoreNames.contains(name)) {
    return database.createObjectStore(name, options);
  }
  return null;
}

function createIndexIfMissing(store: IDBObjectStore, name: string, keyPath: string | string[], options?: IDBIndexParameters) {
  if (!store.indexNames.contains(name)) {
    store.createIndex(name, keyPath, options);
  }
}

export function openOfflineSaleDatabase(): Promise<IDBDatabase> {
  assertIndexedDbAvailable();
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      const metaStore = createStoreIfMissing(database, STORE_META, { keyPath: "key" });
      const catalogStore = createStoreIfMissing(database, STORE_CATALOG, { keyPath: "id" });
      const salesStore = createStoreIfMissing(database, STORE_SALES, { keyPath: "id" });

      if (metaStore) {
        createIndexIfMissing(metaStore, "updated_at", "updated_at");
      }
      if (catalogStore) {
        createIndexIfMissing(catalogStore, "tenant_branch", ["tenant_id", "branch_id"]);
        createIndexIfMissing(catalogStore, "saved_at", "saved_at");
      }
      if (salesStore) {
        createIndexIfMissing(salesStore, "status", "status");
        createIndexIfMissing(salesStore, "created_at", "created_at");
        createIndexIfMissing(salesStore, "order_no", "order_no", { unique: true });
        createIndexIfMissing(salesStore, "device_code", "device_code");
        createIndexIfMissing(salesStore, "tenant_branch_status", ["tenant_id", "branch_id", "status"]);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        databasePromise = null;
      };
      resolve(database);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("cpipos_offline_database_open_failed"));
    };
    request.onblocked = () => {
      databasePromise = null;
      reject(new Error("cpipos_offline_database_upgrade_blocked"));
    };
  });

  return databasePromise;
}

async function getStore(storeName: string, mode: IDBTransactionMode) {
  const database = await openOfflineSaleDatabase();
  const transaction = database.transaction(storeName, mode);
  return { store: transaction.objectStore(storeName), transaction };
}

function localBusinessDate(now = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(now);
}

function safeDeviceCode(deviceCode: string) {
  return deviceCode.trim().replace(/[^a-z0-9_-]+/giu, "-").replace(/^-+|-+$/gu, "").toUpperCase() || "DEVICE";
}

function randomId(prefix: string) {
  const randomPart = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`;
}

function readLocalReceiptCounter(key: string) {
  if (typeof window === "undefined") return 0;
  const value = Number(window.localStorage.getItem(key) ?? "0");
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function writeLocalReceiptCounter(key: string, value: number) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, String(Math.max(0, Math.trunc(value))));
}

export function createOfflineReceiptNumber(args: { device_code: string; branch_code?: string | null; now?: Date }) {
  const businessDate = localBusinessDate(args.now);
  const compactDate = businessDate.replace(/-/gu, "");
  const deviceCode = safeDeviceCode(args.device_code);
  const branchCode = args.branch_code ? `${safeDeviceCode(args.branch_code)}-` : "";
  const counterKey = `${RECEIPT_COUNTER_PREFIX}:${branchCode}${deviceCode}:${compactDate}`;
  const nextSequence = readLocalReceiptCounter(counterKey) + 1;
  writeLocalReceiptCounter(counterKey, nextSequence);

  return {
    order_no: `OFF-${branchCode}${deviceCode}-${compactDate}-${String(nextSequence).padStart(6, "0")}`,
    local_sequence: nextSequence,
    local_business_date: businessDate
  };
}

async function putRecord<T>(storeName: string, record: T): Promise<T> {
  const { store, transaction } = await getStore(storeName, "readwrite");
  store.put(record);
  await transactionDone(transaction);
  return record;
}

async function getRecord<T>(storeName: string, key: IDBValidKey): Promise<T | null> {
  const { store } = await getStore(storeName, "readonly");
  const result = await requestToPromise<T | undefined>(store.get(key));
  return result ?? null;
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const { store } = await getStore(storeName, "readonly");
  return requestToPromise<T[]>(store.getAll());
}

export async function setOfflineMeta(key: string, value: unknown): Promise<OfflineMetaRecord> {
  return putRecord<OfflineMetaRecord>(STORE_META, {
    key,
    value,
    updated_at: new Date().toISOString()
  });
}

export async function getOfflineMeta<T = unknown>(key: string): Promise<T | null> {
  const record = await getRecord<OfflineMetaRecord>(STORE_META, key);
  return (record?.value as T | undefined) ?? null;
}

export async function saveOfflineCatalogSnapshot(input: Omit<OfflineCatalogSnapshot, "id" | "saved_at" | "version"> & { id?: string; saved_at?: string; version?: number }) {
  const snapshot: OfflineCatalogSnapshot = {
    ...input,
    id: input.id ?? randomId("catalog"),
    saved_at: input.saved_at ?? new Date().toISOString(),
    version: input.version ?? 1
  };
  return putRecord<OfflineCatalogSnapshot>(STORE_CATALOG, snapshot);
}

export async function getLatestOfflineCatalogSnapshot(args: { tenant_id: string; branch_id: string }): Promise<OfflineCatalogSnapshot | null> {
  const snapshots = await getAllRecords<OfflineCatalogSnapshot>(STORE_CATALOG);
  return snapshots
    .filter((snapshot) => snapshot.tenant_id === args.tenant_id && snapshot.branch_id === args.branch_id)
    .sort((left, right) => right.saved_at.localeCompare(left.saved_at))[0] ?? null;
}

export async function enqueueOfflineCashSale(input: OfflineCashSaleInput): Promise<OfflineSaleQueueEntry> {
  const now = new Date();
  const receipt = input.order_no
    ? { order_no: input.order_no, local_sequence: 0, local_business_date: localBusinessDate(now) }
    : createOfflineReceiptNumber({ device_code: input.device_code, branch_code: input.branch_code, now });

  const entry: OfflineSaleQueueEntry = {
    ...input,
    id: randomId("offline_sale"),
    order_no: receipt.order_no,
    local_sequence: receipt.local_sequence,
    local_business_date: receipt.local_business_date,
    payment_method: "cash",
    status: "queued",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    sync_attempts: 0,
    last_sync_attempt_at: null,
    last_sync_error: null,
    server_order_id: null,
    synced_at: null,
    void_reason: null
  };

  return putRecord<OfflineSaleQueueEntry>(STORE_SALES, entry);
}

export async function getOfflineSaleById(id: string): Promise<OfflineSaleQueueEntry | null> {
  return getRecord<OfflineSaleQueueEntry>(STORE_SALES, id);
}

export async function listOfflineSales(filter: { status?: OfflineSaleQueueStatus; tenant_id?: string; branch_id?: string } = {}): Promise<OfflineSaleQueueEntry[]> {
  const entries = await getAllRecords<OfflineSaleQueueEntry>(STORE_SALES);
  return entries
    .filter((entry) => !filter.status || entry.status === filter.status)
    .filter((entry) => !filter.tenant_id || entry.tenant_id === filter.tenant_id)
    .filter((entry) => !filter.branch_id || entry.branch_id === filter.branch_id)
    .sort((left, right) => left.created_at.localeCompare(right.created_at));
}

export async function listPendingOfflineSales(args: { tenant_id?: string; branch_id?: string } = {}): Promise<OfflineSaleQueueEntry[]> {
  const entries = await listOfflineSales(args);
  return entries.filter((entry) => entry.status === "queued" || entry.status === "failed");
}

async function updateOfflineSaleStatus(
  id: string,
  updater: (entry: OfflineSaleQueueEntry) => OfflineSaleQueueEntry
): Promise<OfflineSaleQueueEntry> {
  const current = await getOfflineSaleById(id);
  if (!current) throw new Error("cpipos_offline_sale_not_found");
  const next = updater(current);
  return putRecord<OfflineSaleQueueEntry>(STORE_SALES, {
    ...next,
    updated_at: new Date().toISOString()
  });
}

export async function markOfflineSaleSyncing(id: string): Promise<OfflineSaleQueueEntry> {
  const now = new Date().toISOString();
  return updateOfflineSaleStatus(id, (entry) => ({
    ...entry,
    status: "syncing",
    sync_attempts: entry.sync_attempts + 1,
    last_sync_attempt_at: now,
    last_sync_error: null
  }));
}

export async function markOfflineSaleSynced(id: string, serverOrderId: string): Promise<OfflineSaleQueueEntry> {
  const now = new Date().toISOString();
  return updateOfflineSaleStatus(id, (entry) => ({
    ...entry,
    status: "synced",
    server_order_id: serverOrderId,
    synced_at: now,
    last_sync_error: null
  }));
}

export async function markOfflineSaleFailed(id: string, errorMessage: string): Promise<OfflineSaleQueueEntry> {
  return updateOfflineSaleStatus(id, (entry) => ({
    ...entry,
    status: "failed",
    last_sync_error: errorMessage
  }));
}

export async function voidOfflineSale(id: string, reason: string): Promise<OfflineSaleQueueEntry> {
  return updateOfflineSaleStatus(id, (entry) => ({
    ...entry,
    status: "voided",
    void_reason: reason
  }));
}

export async function getOfflineSaleSummary(args: { tenant_id?: string; branch_id?: string } = {}): Promise<OfflineSaleSummary> {
  const entries = await listOfflineSales(args);
  return entries.reduce<OfflineSaleSummary>(
    (summary, entry) => {
      summary[entry.status] += 1;
      if (entry.status === "queued" || entry.status === "failed" || entry.status === "syncing") {
        summary.total_unsynced_amount += Number(entry.totals.total_amount || 0);
      }
      return summary;
    },
    { queued: 0, syncing: 0, synced: 0, failed: 0, voided: 0, total_unsynced_amount: 0 }
  );
}

export async function resetOfflineSaleDatabaseForDevice(): Promise<void> {
  const database = await openOfflineSaleDatabase();
  await Promise.all(
    Array.from(database.objectStoreNames).map(
      (storeName) => new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).clear();
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error("cpipos_offline_store_clear_failed"));
        transaction.onabort = () => reject(transaction.error ?? new Error("cpipos_offline_store_clear_aborted"));
      })
    )
  );
}
