"use client";

import type { CSSProperties, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, LoadingState } from "@/components/backoffice/list-state";
import { PaginationControls } from "@/components/backoffice/pagination-controls";
import { usePaginatedApi } from "@/components/backoffice/use-paginated-api";
import { BROWSER_PRINT_AGENT_BAUD_KEY, BROWSER_PRINT_AGENT_CONFIG_EVENT, BROWSER_PRINT_AGENT_ENABLED_KEY, BROWSER_PRINT_AGENT_KEY, BROWSER_PRINT_AGENT_RESET_EVENT, BROWSER_PRINT_AGENT_STATUS_EVENT, type BrowserPrintAgentStatus } from "@/components/printing/browser-print-agent";
import {
  BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY,
  BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY,
  BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY
} from "@/components/printing/browser-bluetooth-print-agent";

type PrinterRole = "receipt" | "kitchen" | "report";
type ConnectionType = "NETWORK_ESC_POS" | "STAR_WEBPRNT" | "LOCAL_BRIDGE" | "BLUETOOTH_BRIDGE";
type ActivePanel = "printers" | "agents" | "assignment";

type PrinterRow = {
  id: string;
  printer_name: string;
  printer_role: PrinterRole;
  connection_type: ConnectionType;
  ip_address: string | null;
  port: number | null;
  paper_width_mm: 58 | 80;
  enabled: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
};

type PrintAgentRow = {
  id: string;
  device_id: string | null;
  device_code: string;
  agent_name: string;
  status: "active" | "blocked" | "inactive";
  last_seen_at: string | null;
  last_claim_at: string | null;
  app_version: string | null;
  metadata: Record<string, unknown>;
};

type BluetoothDevice = { id: string; name: string; address: string | null; rssi: number | null; paired: boolean; connected: boolean };
type ApiEnvelope<T> = { data?: T; error?: { message?: string; code?: string } };
type BridgeEnvelope<TData> = { ok: boolean; code: string; message: string; action: string; timestamp: string; data: TData };
type BridgeDebugEntry = { at: string; attempts: number; request: Record<string, unknown>; status: number | null; response: unknown };

type SerialPortLike = { open(options: { baudRate: number }): Promise<void>; close(): Promise<void>; writable: WritableStream<Uint8Array> | null };
type SerialLike = { getPorts(): Promise<SerialPortLike[]>; requestPort(options?: unknown): Promise<SerialPortLike> };

const text = {
  title: "ตั้งค่าเครื่องพิมพ์",
  description: "ตั้งค่าเครื่องพิมพ์ใบเสร็จ ครัว รายงาน แอปพิมพ์ในเครื่อง Bluetooth Bridge และลิ้นชักเก็บเงิน",
  printers: "เครื่องพิมพ์",
  agents: "แอปพิมพ์",
  assignment: "การผูกเครื่อง",
  newPrinter: "เพิ่มเครื่องพิมพ์",
  printPath: "รูปแบบสั่งพิมพ์",
  networkTitle: "แบบสาย / LAN",
  networkDesc: "เครื่อง ESC/POS ผ่าน IP ใช้กับเครื่องพิมพ์ LAN หรือ Wi-Fi",
  webTitle: "พิมพ์ผ่านเว็บแอป",
  webDesc: "เรียก Star WebPRNT endpoint จากระบบหลังบ้าน",
  appTitle: "พิมพ์ผ่านแอป / Local Bridge",
  appDesc: "แอปในเครื่องรับงานจาก CpIPOS แล้วส่งไป USB หรือ driver printer",
  bluetoothTitle: "Bluetooth Bridge",
  bluetoothDesc: "แอป Bridge เชื่อมต่อและพิมพ์ไปเครื่อง Bluetooth 58mm",
  printerName: "ชื่อเครื่องพิมพ์",
  role: "หน้าที่",
  receipt: "ใบเสร็จ",
  kitchen: "ครัว",
  report: "รายงาน",
  paper: "กระดาษ",
  ipAddress: "IP address",
  port: "พอร์ต",
  bridgeUrl: "Bridge URL",
  webprntUrl: "WebPRNT URL",
  bluetoothAddress: "Bluetooth address",
  bluetoothName: "ชื่อ Bluetooth",
  agentDeviceCode: "ผูกกับรหัสเครื่อง",
  enabled: "เปิดใช้งาน",
  autoConnect: "เชื่อมต่ออัตโนมัติ",
  connectBeforePrint: "เชื่อมต่อก่อนพิมพ์",
  cashDrawer: "ลิ้นชักเก็บเงิน",
  autoOpenCash: "เปิดเมื่อรับเงินสด",
  advancedMetadata: "Metadata JSON ขั้นสูง",
  advancedMetadataHint: "ใส่เฉพาะค่าพิเศษ ระบบจะรวมกับค่าจากฟอร์มให้อัตโนมัติ",
  saving: "กำลังบันทึก...",
  addPrinter: "บันทึกเครื่องพิมพ์",
  loadPrinters: "กำลังโหลดเครื่องพิมพ์...",
  noPrinters: "ยังไม่ได้ตั้งค่าเครื่องพิมพ์",
  printerCreated: "สร้างเครื่องพิมพ์แล้ว",
  createPrinterFailed: "สร้างเครื่องพิมพ์ไม่สำเร็จ",
  metadataInvalid: "Metadata ขั้นสูงต้องเป็น JSON object ที่ถูกต้อง",
  requiredNetwork: "แบบสาย / LAN ต้องใส่ IP address",
  requiredBridge: "พิมพ์ผ่านแอปหรือ Bluetooth ต้องใส่ Bridge URL",
  requiredWebprnt: "พิมพ์ผ่านเว็บแอปต้องใส่ WebPRNT URL",
  requiredBluetooth: "Bluetooth ต้องใส่ address หรือชื่อเครื่อง",
  status: "สถานะ",
  online: "ออนไลน์",
  offline: "ออฟไลน์",
  checking: "กำลังตรวจสอบ",
  testPrint: "ทดสอบพิมพ์",
  testing: "กำลังทดสอบ...",
  testQueued: "ส่งทดสอบพิมพ์แล้ว",
  testQueuedAgent: "ส่งเข้าคิว Print Agent แล้ว ให้เปิดแอปพิมพ์ที่เครื่องแคชเชียร์",
  browserBridgeHint: "โหมดเว็บแอปบน Vercel ต้องมี Local Bridge หรือ Print Agent ที่เครื่องแคชเชียร์ เพราะ Vercel มองไม่เห็น 127.0.0.1/IP LAN ของร้าน",
  bridgeCorsHint: "ถ้า browser แจ้ง Failed to fetch ให้เปิด CORS/Private Network Access ใน Local Bridge",
  testFailed: "ทดสอบพิมพ์ไม่สำเร็จ",
  scanBluetooth: "ค้นหา Bluetooth",
  scanning: "กำลังค้นหา...",
  noDevices: "ไม่พบอุปกรณ์ Bluetooth",
  useDevice: "ใช้เครื่องนี้",
  connecting: "กำลังเชื่อมต่อ...",
  connectDevice: "เชื่อมต่อ",
  connectedMessage: "เชื่อมต่อ Bluetooth แล้ว",
  appliedBluetooth: "เลือกเครื่อง Bluetooth แล้ว",
  discoveryFailed: "ค้นหา Bluetooth ไม่สำเร็จ",
  bridgeHealthFailed: "ตรวจสอบ Bridge ไม่สำเร็จ",
  debugPrint58: "ทดสอบ 58mm",
  testingPrint: "กำลังทดสอบพิมพ์...",
  printDebugComplete: "ทดสอบพิมพ์ Bluetooth เสร็จแล้ว",
  printDebugFailed: "ทดสอบพิมพ์ Bluetooth ไม่สำเร็จ",
  browserAgentTitle: "Browser Print Agent (Web Serial/USB)",
  browserAgentDesc: "สำหรับเปิด POS บนคอมด้วย Chrome/PWA ให้เลือกพอร์ต USB/COM หรือ Bluetooth SPP จาก Windows ครั้งแรก แล้วระบบจะรับคิวพิมพ์อัตโนมัติ",
  browserAgentLimit: "เว็บไม่สามารถค้นหา/เชื่อม Bluetooth Classic แบบเงียบได้ ต้องให้ผู้ใช้เลือกพอร์ตหนึ่งครั้งตามข้อจำกัด browser",
  browserAgentSecret: "Print Agent secret",
  browserAgentBaud: "Baud rate",
  browserAgentEnable: "เปิด Browser Print Agent",
  saveBrowserAgent: "บันทึกค่า Agent ในเครื่องนี้",
  selectSerialPrinter: "เลือกเครื่องจาก Windows",
  reconnectSerialPrinter: "เชื่อมต่ออัตโนมัติ",
  testBrowserSerial: "ทดสอบ Web Serial",
  browserAgentUnsupported: "Browser นี้ไม่รองรับ Web Serial ให้ใช้ Chrome/Edge บน Windows หรือใช้ Windows POS app",
  browserAgentSaved: "บันทึก Browser Print Agent แล้ว",
  browserAgentPortSelected: "เลือกพอร์ตเครื่องพิมพ์แล้ว รอบถัดไประบบจะ reconnect อัตโนมัติ",
  browserAgentPortMissing: "ยังไม่ได้เลือกพอร์ตเครื่องพิมพ์",
  browserAgentReady: "????????????????",
  browserAgentPrinterPreset: "Use Browser Agent",
  browserAgentPrinterPresetHint: "This printer profile will queue jobs for the Browser Print Agent.",
  editPrinter: "Edit",
  cancelEdit: "Cancel edit",
  updatePrinter: "Update printer",
  printerUpdated: "Printer updated",
  disablePrinter: "Disable",
  enablePrinter: "Enable",
  deletePrinter: "Delete",
  printerDeleted: "Printer deleted",
  deleteAgent: "Delete",
  agentDeleted: "Print Agent deleted",
  resetBrowserAgent: "Reset Agent",
  browserAgentReset: "Browser Print Agent reset",
  setBrowserAgent: "Use Browser Agent",
  browserAgentRoute: "Browser Agent / Web Serial",
  printFlowHint: "Sales, payment, reprint, kitchen tickets, shift flow, and cash drawer use enabled printer profiles by role.",
  localAgents: "แอปพิมพ์ / Print Agent",
  agentName: "ชื่อ Agent",
  deviceCode: "รหัสเครื่อง",
  appVersion: "เวอร์ชันแอป",
  agentMetadata: "Metadata Agent JSON",
  createAgentSecret: "สร้าง Secret",
  creating: "กำลังสร้าง...",
  copySecretNow: "คัดลอก secret ตอนนี้ ระบบแสดงให้เห็นครั้งเดียวเท่านั้น",
  copySecret: "คัดลอก secret",
  loadingAgents: "กำลังโหลดแอปพิมพ์...",
  noAgents: "ยังไม่มี Print Agent",
  revoke: "ยกเลิกสิทธิ์",
  block: "บล็อก",
  createAgentFailed: "สร้าง Print Agent ไม่สำเร็จ",
  updateAgentFailed: "อัปเดต Print Agent ไม่สำเร็จ",
  agentBlocked: "บล็อก Print Agent แล้ว",
  agentRevoked: "ยกเลิกสิทธิ์ Print Agent แล้ว",
  assignmentTitle: "กติกาผูกเครื่องพิมพ์",
  assignmentText: "ผูกเครื่องพิมพ์ตามหน้าที่และรหัสเครื่อง เพื่อให้แต่ละจุดแคชเชียร์พิมพ์ใบเสร็จ ครัว หรือรายงานถูกเครื่อง",
  routeReceipt: "เครื่องใบเสร็จใช้พิมพ์บิล พิมพ์ซ้ำ และสั่งเปิดลิ้นชัก",
  routeKitchen: "เครื่องครัวรับใบสั่งจากหน้าขายและ QR ลูกค้านั่งโต๊ะ",
  routeDevice: "การผูกเครื่องใช้ metadata agent_device_code หรือ agent_device_codes",
  debugPanel: "ข้อมูล Debug Bridge",
  address: "ที่อยู่",
  yes: "ใช่",
  no: "ไม่ใช่",
  bleAgentTitle: "Bluetooth Print Agent (Web Bluetooth, ไม่ต้องมีเครื่อง PC)",
  bleAgentDesc: "สำหรับแท็บเล็ต/มือถือ Android ที่ใช้ Chrome เปิด POS โดยตรง เชื่อมต่อเครื่องพิมพ์ Bluetooth ผ่านเบราว์เซอร์ ไม่ต้องมีบริดจ์บนคอมพิวเตอร์",
  bleAgentLimit: "ต้องใช้ Chrome บน Android หรือ Windows/Mac ที่รองรับ Web Bluetooth เท่านั้น และต้องกดปุ่มเชื่อมต่อเองครั้งแรกตามข้อจำกัดของเบราว์เซอร์",
  bleAgentEnable: "เปิด Bluetooth Print Agent",
  bleServiceUuid: "Service UUID (ไม่บังคับ)",
  bleCharacteristicUuid: "Characteristic UUID (ไม่บังคับ)",
  bleUuidHint: "เว้นว่างไว้เพื่อให้ระบบลอง UUID ที่พบบ่อยในเครื่องพิมพ์ Bluetooth ทั่วไปโดยอัตโนมัติ ถ้าเชื่อมต่อไม่ติดให้ระบุ UUID ของเครื่องพิมพ์รุ่นนี้ตามคู่มือ",
  bleAgentSaved: "บันทึกค่า Bluetooth Print Agent แล้ว",
  bleAgentPairHint: "หลังบันทึกและเปิดใช้งาน ให้กลับไปที่หน้าขาย POS แล้วกดปุ่ม \"เชื่อมต่อเครื่องพิมพ์ Bluetooth\" ที่มุมจอเพื่อจับคู่เครื่องพิมพ์ครั้งแรก",
  resetBleAgent: "Reset Bluetooth Agent"
} as const;

const panelStyle: CSSProperties = { border: "1px solid #d8e0ea", borderRadius: 8, padding: 14, background: "#fff" };
const labelStyle: CSSProperties = { display: "grid", gap: 6, color: "#344054", fontSize: 13, fontWeight: 700 };
const inputStyle: CSSProperties = { minHeight: 42, borderRadius: 8, border: "1px solid #cdd5df", padding: "8px 10px", background: "#fff", color: "#101828" };
const buttonStyle: CSSProperties = { minHeight: 40, borderRadius: 8, border: "1px solid #cdd5df", background: "#fff", color: "#101828", padding: "0 14px", fontWeight: 800, cursor: "pointer" };
const primaryButtonStyle: CSSProperties = { ...buttonStyle, borderColor: "#175cd3", background: "#175cd3", color: "#fff" };
const dangerButtonStyle: CSSProperties = { ...buttonStyle, borderColor: "#fecaca", background: "#fff1f2", color: "#be123c" };
const BROWSER_AGENT_BRIDGE_URL = "browser-agent://web-serial";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readJsonObject(value: string): Record<string, unknown> {
  if (!value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("metadata_not_object");
  return parsed;
}

function normalizeText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function metadataValue(value: Record<string, unknown>, key: string) {
  const raw = value[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

async function readJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

async function fetchJsonWithTimeout<T = unknown>(input: RequestInfo | URL, init: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { response, body: await readJson<T>(response) };
  } finally {
    window.clearTimeout(timer);
  }
}
async function postBridgeFromBrowser<T = unknown>(bridgeUrl: string, payload: Record<string, unknown>, timeoutMs = 10000) {
  const url = normalizeText(bridgeUrl);
  if (!url) throw new Error(text.requiredBridge);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return { response, body: await readJson<T>(response) };
  } catch (error) {
    const message = error instanceof Error ? error.message : text.bridgeHealthFailed;
    throw new Error(`${message}. ${text.bridgeCorsHint}`);
  } finally {
    window.clearTimeout(timer);
  }
}

function normalizeBridgeDevice(value: unknown, index: number): BluetoothDevice | null {
  if (!isRecord(value)) return null;
  const name = typeof value.name === "string" ? value.name : typeof value.bluetooth_name === "string" ? value.bluetooth_name : "";
  const address = typeof value.address === "string" ? value.address : typeof value.bluetooth_address === "string" ? value.bluetooth_address : null;
  if (!name && !address) return null;
  return {
    id: typeof value.id === "string" ? value.id : `${address ?? name}-${index}`,
    name,
    address,
    rssi: Number.isFinite(Number(value.rssi)) ? Number(value.rssi) : null,
    paired: value.paired === true,
    connected: value.connected === true
  };
}

function normalizeBridgeDevices(value: unknown): BluetoothDevice[] {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => normalizeBridgeDevice(item, index)).filter((item): item is BluetoothDevice => Boolean(item));
}

function bridgeEnvelopeData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return {};
  if (isRecord(value.data)) return value.data;
  return value;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

function connectionLabel(type: ConnectionType) {
  if (type === "NETWORK_ESC_POS") return text.networkTitle;
  if (type === "STAR_WEBPRNT") return text.webTitle;
  if (type === "LOCAL_BRIDGE") return text.appTitle;
  return text.bluetoothTitle;
}

function printerAddress(printer: PrinterRow) {
  const metadata = printer.metadata ?? {};
  if (printer.connection_type === "NETWORK_ESC_POS") return printer.ip_address ? `${printer.ip_address}:${printer.port ?? 9100}` : "-";
  if (printer.connection_type === "STAR_WEBPRNT") return metadataValue(metadata, "webprnt_url") ?? "-";
  if (printer.connection_type === "LOCAL_BRIDGE") return metadataValue(metadata, "bridge_url") ?? "env:PRINT_BRIDGE_URL";
  return metadataValue(metadata, "bluetooth_address") ?? metadataValue(metadata, "bluetooth_name") ?? "-";
}

function isBrowserAgentPrinter(printer: PrinterRow) {
  const metadata = printer.metadata ?? {};
  return (
    metadataValue(metadata, "bridge_url") === BROWSER_AGENT_BRIDGE_URL ||
    metadata.print_mode === "agent" ||
    metadata.processing_mode === "print_agent" ||
    metadata.queue_only === true
  );
}

function printerConnectionLabel(printer: PrinterRow) {
  if (isBrowserAgentPrinter(printer)) return text.browserAgentRoute;
  return connectionLabel(printer.connection_type);
}

function cashDrawerMetadata(metadata: Record<string, unknown>) {
  const drawer = metadata.cash_drawer;
  return drawer && typeof drawer === "object" && !Array.isArray(drawer) ? (drawer as Record<string, unknown>) : {};
}

export function PrintersModule({ lang: _lang = "th" }: { lang?: "th" | "en" }) {
  const [activePanel, setActivePanel] = useState<ActivePanel>("printers");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [printerActionId, setPrinterActionId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [connectingDeviceId, setConnectingDeviceId] = useState<string | null>(null);
  const [discoveredDevices, setDiscoveredDevices] = useState<BluetoothDevice[]>([]);
  const [bridgeHealth, setBridgeHealth] = useState<{ ok: boolean; code: string; message: string; latencyMs: number | null } | null>(null);
  const [printingBridgeTest, setPrintingBridgeTest] = useState(false);
  const [bridgeDebug, setBridgeDebug] = useState<{ health: BridgeDebugEntry | null; discover: BridgeDebugEntry | null; connect: BridgeDebugEntry | null; print: BridgeDebugEntry | null }>({ health: null, discover: null, connect: null, print: null });
  const [agents, setAgents] = useState<PrintAgentRow[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentActionId, setAgentActionId] = useState<string | null>(null);
  const [agentSubmitting, setAgentSubmitting] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDeviceCode, setAgentDeviceCode] = useState("");
  const [agentVersion, setAgentVersion] = useState("");
  const [agentMetadataText, setAgentMetadataText] = useState("");
  const [createdAgentKey, setCreatedAgentKey] = useState<{ agentName: string; deviceCode: string; key: string } | null>(null);
  const [printerName, setPrinterName] = useState("");
  const [printerRole, setPrinterRole] = useState<PrinterRole>("receipt");
  const [connectionType, setConnectionType] = useState<ConnectionType>("NETWORK_ESC_POS");
  const [paperWidthMm, setPaperWidthMm] = useState<58 | 80>(58);
  const [ipAddress, setIpAddress] = useState("");
  const [portValue, setPortValue] = useState("9100");
  const [bridgeUrlInput, setBridgeUrlInput] = useState("http://127.0.0.1:3210/print");
  const [webprntUrl, setWebprntUrl] = useState("");
  const [bluetoothAddress, setBluetoothAddress] = useState("");
  const [bluetoothName, setBluetoothName] = useState("");
  const [agentDeviceBinding, setAgentDeviceBinding] = useState("");
  const [autoConnect, setAutoConnect] = useState(true);
  const [connectBeforePrint, setConnectBeforePrint] = useState(true);
  const [cashDrawerEnabled, setCashDrawerEnabled] = useState(false);
  const [cashDrawerAutoOpen, setCashDrawerAutoOpen] = useState(false);
  const [metadataTextValue, setMetadataTextValue] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [browserAgentSecret, setBrowserAgentSecret] = useState("");
  const [browserAgentBaud, setBrowserAgentBaud] = useState("9600");
  const [browserAgentEnabled, setBrowserAgentEnabled] = useState(false);
  const [browserAgentSupported, setBrowserAgentSupported] = useState(false);
  const [browserAgentPortReady, setBrowserAgentPortReady] = useState(false);
  const [browserAgentStatus, setBrowserAgentStatus] = useState<BrowserPrintAgentStatus | null>(null);
  const [browserAgentBusy, setBrowserAgentBusy] = useState<string | null>(null);
  const [bleAgentEnabled, setBleAgentEnabled] = useState(false);
  const [bleServiceUuid, setBleServiceUuid] = useState("");
  const [bleCharacteristicUuid, setBleCharacteristicUuid] = useState("");

  const isBridgeMode = connectionType === "LOCAL_BRIDGE" || connectionType === "BLUETOOTH_BRIDGE";
  const isBluetoothMode = connectionType === "BLUETOOTH_BRIDGE";
  const isNetworkMode = connectionType === "NETWORK_ESC_POS";
  const isWebMode = connectionType === "STAR_WEBPRNT";
  const { loading, error, items, pagination } = usePaginatedApi<PrinterRow>("/api/backoffice/printers", { page, page_size: 10, reload: reloadKey });

  const connectionOptions = useMemo(() => [
    { type: "NETWORK_ESC_POS" as const, title: text.networkTitle, desc: text.networkDesc },
    { type: "LOCAL_BRIDGE" as const, title: text.appTitle, desc: text.appDesc },
    { type: "BLUETOOTH_BRIDGE" as const, title: text.bluetoothTitle, desc: text.bluetoothDesc },
    { type: "STAR_WEBPRNT" as const, title: text.webTitle, desc: text.webDesc }
  ], []);

  function getBrowserSerial() {
    return typeof navigator !== "undefined" ? (navigator.serial as SerialLike | undefined) : undefined;
  }

  function browserAgentBaudNumber() {
    const parsed = Number(browserAgentBaud);
    return Number.isFinite(parsed) ? Math.min(921600, Math.max(1200, Math.trunc(parsed))) : 9600;
  }

  function dispatchBrowserAgentConfig() {
    window.dispatchEvent(new Event(BROWSER_PRINT_AGENT_CONFIG_EVENT));
  }

  function buildBrowserAgentTestBytes() {
    const body = new TextEncoder().encode(`CpIPOS Web Serial Test\n${new Date().toISOString()}\n\n\n`);
    const bytes = new Uint8Array(2 + body.length + 3);
    bytes.set([0x1b, 0x40], 0);
    bytes.set(body, 2);
    bytes.set([0x1d, 0x56, 0x00], 2 + body.length);
    return bytes;
  }

  async function openSerialPort(port: SerialPortLike) {
    if (port.writable) {
      setBrowserAgentPortReady(true);
      return port;
    }
    try {
      await port.open({ baudRate: browserAgentBaudNumber() });
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (!message.includes("already open")) throw error;
    }
    setBrowserAgentPortReady(true);
    return port;
  }

  async function closeSerialPort(port: SerialPortLike) {
    try {
      await port.close();
    } catch {
      // Some browser serial drivers report close twice while the port is already released.
    }
  }

  async function writeSerialBytes(port: SerialPortLike, bytes: Uint8Array) {
    if (!port.writable) throw new Error("serial_port_not_writable");
    const writer = port.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
  }

  const refreshBrowserAgentPortStatus = useCallback(async () => {
    const serial = getBrowserSerial();
    setBrowserAgentSupported(Boolean(serial));
    if (!serial) {
      setBrowserAgentPortReady(false);
      return;
    }
    const ports = await serial.getPorts().catch(() => []);
    setBrowserAgentPortReady(ports.length > 0);
  }, []);

  function handleResetBrowserAgent() {
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_ENABLED_KEY);
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_KEY);
    setBrowserAgentEnabled(false);
    setBrowserAgentSecret("");
    setBrowserAgentStatus(null);
    setBrowserAgentPortReady(false);
    window.dispatchEvent(new Event(BROWSER_PRINT_AGENT_RESET_EVENT));
    dispatchBrowserAgentConfig();
    setSubmitError(null);
    setSubmitSuccess(text.browserAgentReset);
  }

  async function handleSaveBrowserAgent() {
    setSubmitError(null);
    setSubmitSuccess(null);
    if (browserAgentEnabled && !browserAgentSecret.trim()) {
      setSubmitError(text.browserAgentSecret);
      return;
    }
    window.localStorage.setItem(BROWSER_PRINT_AGENT_ENABLED_KEY, browserAgentEnabled ? "1" : "0");
    window.localStorage.setItem(BROWSER_PRINT_AGENT_KEY, browserAgentSecret.trim());
    window.localStorage.setItem(BROWSER_PRINT_AGENT_BAUD_KEY, String(browserAgentBaudNumber()));
    dispatchBrowserAgentConfig();
    setSubmitSuccess(text.browserAgentSaved);
  }

  function handleResetBleAgent() {
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY);
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY);
    window.localStorage.removeItem(BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY);
    setBleAgentEnabled(false);
    setBleServiceUuid("");
    setBleCharacteristicUuid("");
    setBrowserAgentStatus(null);
    window.dispatchEvent(new Event(BROWSER_PRINT_AGENT_RESET_EVENT));
    dispatchBrowserAgentConfig();
    setSubmitError(null);
    setSubmitSuccess(text.browserAgentReset);
  }

  async function handleSaveBleAgent() {
    setSubmitError(null);
    setSubmitSuccess(null);
    if (bleAgentEnabled && !browserAgentSecret.trim()) {
      setSubmitError(text.browserAgentSecret);
      return;
    }
    window.localStorage.setItem(BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY, bleAgentEnabled ? "1" : "0");
    window.localStorage.setItem(BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY, bleServiceUuid.trim());
    window.localStorage.setItem(BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY, bleCharacteristicUuid.trim());
    if (!browserAgentSecret.trim()) {
      // Bluetooth agent reuses the same Print Agent secret as Browser Print Agent (Web Serial).
    } else {
      window.localStorage.setItem(BROWSER_PRINT_AGENT_KEY, browserAgentSecret.trim());
    }
    dispatchBrowserAgentConfig();
    setSubmitSuccess(text.bleAgentSaved);
  }

  async function handleSelectBrowserSerialPrinter() {
    setBrowserAgentBusy("select");
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const serial = getBrowserSerial();
      if (!serial?.requestPort) throw new Error(text.browserAgentUnsupported);
      const port = await serial.requestPort();
      await openSerialPort(port);
      await closeSerialPort(port);
      await refreshBrowserAgentPortStatus();
      dispatchBrowserAgentConfig();
      setSubmitSuccess(text.browserAgentPortSelected);
    } catch (serialError) {
      setSubmitError(serialError instanceof Error ? serialError.message : text.browserAgentPortMissing);
    } finally {
      setBrowserAgentBusy(null);
    }
  }

  async function handleReconnectBrowserSerialPrinter() {
    setBrowserAgentBusy("reconnect");
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const serial = getBrowserSerial();
      if (!serial) throw new Error(text.browserAgentUnsupported);
      const ports = await serial.getPorts();
      const port = ports[0];
      if (!port) throw new Error(text.browserAgentPortMissing);
      await openSerialPort(port);
      await closeSerialPort(port);
      await refreshBrowserAgentPortStatus();
      dispatchBrowserAgentConfig();
      setSubmitSuccess(text.browserAgentReady);
    } catch (serialError) {
      setSubmitError(serialError instanceof Error ? serialError.message : text.browserAgentPortMissing);
    } finally {
      setBrowserAgentBusy(null);
    }
  }

  async function handleBrowserSerialTestPrint() {
    setBrowserAgentBusy("test");
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const serial = getBrowserSerial();
      if (!serial) throw new Error(text.browserAgentUnsupported);
      const ports = await serial.getPorts();
      const port = ports[0] ?? await serial.requestPort();
      await openSerialPort(port);
      const bytes = buildBrowserAgentTestBytes();
      await writeSerialBytes(port, bytes);
      await closeSerialPort(port);
      await refreshBrowserAgentPortStatus();
      setSubmitSuccess(text.printDebugComplete);
    } catch (serialError) {
      setSubmitError(serialError instanceof Error ? serialError.message : text.printDebugFailed);
    } finally {
      setBrowserAgentBusy(null);
    }
  }
  const generatedMetadata = useMemo(() => {
    const metadata: Record<string, unknown> = {};
    if (isBridgeMode && bridgeUrlInput.trim()) metadata.bridge_url = bridgeUrlInput.trim();
    if (isBridgeMode && bridgeUrlInput.trim() === BROWSER_AGENT_BRIDGE_URL) {
      metadata.print_mode = "agent";
      metadata.processing_mode = "print_agent";
      metadata.queue_only = true;
      metadata.provider = "browser_web_serial";
    }
    if (isWebMode && webprntUrl.trim()) metadata.webprnt_url = webprntUrl.trim();
    if (isBluetoothMode) {
      if (bluetoothAddress.trim()) metadata.bluetooth_address = bluetoothAddress.trim();
      if (bluetoothName.trim()) metadata.bluetooth_name = bluetoothName.trim();
      metadata.auto_connect = autoConnect;
      metadata.connect_before_print = connectBeforePrint;
      metadata.prefer_html_58mm = paperWidthMm === 58;
    }
    if (agentDeviceBinding.trim()) metadata.agent_device_code = agentDeviceBinding.trim();
    if (cashDrawerEnabled) {
      metadata.cash_drawer = { enabled: true, connectionMode: "printer-kick", openSupported: true, statusSupported: false, closeSupported: false, kickPin: 0, pulseOnMs: 50, pulseOffMs: 250, autoOpenOnCashPayment: cashDrawerAutoOpen };
    }
    return metadata;
  }, [agentDeviceBinding, autoConnect, bluetoothAddress, bluetoothName, bridgeUrlInput, cashDrawerAutoOpen, cashDrawerEnabled, connectBeforePrint, isBluetoothMode, isBridgeMode, isWebMode, paperWidthMm, webprntUrl]);

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ items?: PrintAgentRow[] }>>("/api/backoffice/printers/agents", { cache: "no-store" }, 9000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createAgentFailed);
      setAgents(Array.isArray(body?.data?.items) ? body.data.items : []);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.createAgentFailed);
    } finally {
      setAgentsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activePanel === "agents") void loadAgents();
  }, [activePanel, loadAgents, reloadKey]);

  useEffect(() => {
    const loadBrowserAgentConfig = () => {
      setBrowserAgentSecret(window.localStorage.getItem(BROWSER_PRINT_AGENT_KEY)?.trim() ?? "");
      setBrowserAgentBaud(window.localStorage.getItem(BROWSER_PRINT_AGENT_BAUD_KEY)?.trim() || "9600");
      setBrowserAgentEnabled(window.localStorage.getItem(BROWSER_PRINT_AGENT_ENABLED_KEY) === "1");
      setBleAgentEnabled(window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY) === "1");
      setBleServiceUuid(window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY)?.trim() ?? "");
      setBleCharacteristicUuid(window.localStorage.getItem(BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY)?.trim() ?? "");
      void refreshBrowserAgentPortStatus();
    };
    const onBrowserAgentStatus = (event: Event) => {
      setBrowserAgentStatus((event as CustomEvent<BrowserPrintAgentStatus>).detail ?? null);
    };
    const onStorage = (event: StorageEvent) => {
      if (
        [
          BROWSER_PRINT_AGENT_KEY,
          BROWSER_PRINT_AGENT_BAUD_KEY,
          BROWSER_PRINT_AGENT_ENABLED_KEY,
          BROWSER_PRINT_AGENT_BLUETOOTH_ENABLED_KEY,
          BROWSER_PRINT_AGENT_BLUETOOTH_SERVICE_UUID_KEY,
          BROWSER_PRINT_AGENT_BLUETOOTH_CHARACTERISTIC_UUID_KEY
        ].includes(event.key ?? "")
      )
        loadBrowserAgentConfig();
    };

    loadBrowserAgentConfig();
    window.addEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, onBrowserAgentStatus as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(BROWSER_PRINT_AGENT_STATUS_EVENT, onBrowserAgentStatus as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshBrowserAgentPortStatus]);

  useEffect(() => {
    if (!isBluetoothMode) return;
    let active = true;
    let timer: number | null = null;
    const checkBridgeHealth = async () => {
      const requestPayload = { bridge_url: bridgeUrlInput.trim() || null, timeout_ms: 5000 };
      let attempts = 0;
      let backoffMs = 350;
      try {
        while (attempts < 3) {
          attempts += 1;
          const startedAt = Date.now();
          const { response, body } = await postBridgeFromBrowser<unknown>(bridgeUrlInput, {
            action: "health",
            transport: "bluetooth",
            timeout_ms: 5000,
            metadata: { request_source: "backoffice_printer_settings_browser", health_check: true }
          }, 6500);
          const bodyRecord = isRecord(body) ? body : {};
          if (!active) return;
          setBridgeDebug((current) => ({ ...current, health: { at: new Date().toISOString(), attempts, request: requestPayload, status: response.status, response: body } }));
          const ok = response.ok && bodyRecord.ok !== false;
          setBridgeHealth({ ok, code: ok ? "bridge_browser_ok" : "bridge_browser_unhealthy", message: typeof bodyRecord.message === "string" ? bodyRecord.message : "Bridge checked from this browser.", latencyMs: Date.now() - startedAt });
          if (ok || attempts >= 3) break;
          await sleep(backoffMs);
          backoffMs = Math.min(2200, backoffMs * 2);
        }
      } catch {
        if (!active) return;
        setBridgeHealth({ ok: false, code: "bridge_health_failed", message: text.bridgeHealthFailed, latencyMs: null });
        setBridgeDebug((current) => ({ ...current, health: { at: new Date().toISOString(), attempts: Math.max(1, attempts), request: requestPayload, status: null, response: { error: "bridge_health_failed" } } }));
      } finally {
        if (!active) return;
        timer = window.setTimeout(checkBridgeHealth, 8000);
      }
    };
    void checkBridgeHealth();
    return () => {
      active = false;
      if (timer) window.clearTimeout(timer);
    };
  }, [bridgeUrlInput, isBluetoothMode]);

  function resetPrinterForm() {
    setPrinterName("");
    setIpAddress("");
    setPortValue("9100");
    setBluetoothAddress("");
    setBluetoothName("");
    setAgentDeviceBinding("");
    setMetadataTextValue("");
    setDiscoveredDevices([]);
    setEditingPrinterId(null);
  }

  function applyBluetoothDevice(device: BluetoothDevice) {
    const candidateName = device.name.trim() || device.address || "Bluetooth Printer";
    setConnectionType("BLUETOOTH_BRIDGE");
    setPaperWidthMm(58);
    setPrinterRole("receipt");
    setPrinterName(candidateName.startsWith("BT ") ? candidateName : `BT ${candidateName}`);
    setBluetoothAddress(device.address ?? "");
    setBluetoothName(device.name ?? "");
    setIpAddress("");
    setPortValue("");
    setAutoConnect(true);
    setConnectBeforePrint(true);
    setSubmitSuccess(`${text.appliedBluetooth}: ${candidateName}`);
  }

  async function handleDiscoverBluetooth() {
    setDiscovering(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    const requestPayload = {
      action: "discover_bluetooth_printers",
      transport: "bluetooth",
      timeout_ms: 9000,
      metadata: { request_source: "backoffice_printer_settings_browser", discover: true }
    };
    try {
      const { response, body } = await postBridgeFromBrowser<unknown>(bridgeUrlInput, requestPayload, 12000);
      setBridgeDebug((current) => ({ ...current, discover: { at: new Date().toISOString(), attempts: 1, request: requestPayload, status: response.status, response: body } }));
      if (!response.ok) throw new Error(`${text.discoveryFailed} (${response.status})`);
      const bodyRecord = isRecord(body) ? body : {};
      const dataRecord = bridgeEnvelopeData(bodyRecord);
      const devices = normalizeBridgeDevices(bodyRecord.devices).length > 0
        ? normalizeBridgeDevices(bodyRecord.devices)
        : normalizeBridgeDevices(dataRecord.devices).length > 0
          ? normalizeBridgeDevices(dataRecord.devices)
          : normalizeBridgeDevices(bodyRecord.results);
      setDiscoveredDevices(devices);
      setBridgeHealth({ ok: true, code: "bridge_browser_ok", message: "Bridge reachable from this browser.", latencyMs: null });
      setSubmitSuccess(`พบอุปกรณ์ Bluetooth: ${devices.length}`);
    } catch (discoverError) {
      setDiscoveredDevices([]);
      setBridgeHealth({ ok: false, code: "bridge_browser_failed", message: discoverError instanceof Error ? discoverError.message : text.discoveryFailed, latencyMs: null });
      setSubmitError(discoverError instanceof Error ? discoverError.message : text.discoveryFailed);
    } finally {
      setDiscovering(false);
    }
  }

  async function handleConnectBluetooth(device: BluetoothDevice) {
    setConnectingDeviceId(device.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    const requestPayload = {
      action: "connect_bluetooth_printer",
      transport: "bluetooth",
      bluetooth_address: device.address,
      bluetooth_name: device.name,
      auto_connect: true,
      metadata: { request_source: "backoffice_printer_settings_browser" }
    };
    try {
      let body: unknown = null;
      let responseStatus: number | null = null;
      let attempts = 0;
      let backoffMs = 450;
      while (attempts < 3) {
        attempts += 1;
        const result = await postBridgeFromBrowser<unknown>(bridgeUrlInput, requestPayload, 10000);
        body = result.body;
        responseStatus = result.response.status;
        setBridgeDebug((current) => ({ ...current, connect: { at: new Date().toISOString(), attempts, request: requestPayload, status: responseStatus, response: body } }));
        const bodyRecord = isRecord(body) ? body : {};
        const bridgeOk = result.response.ok && bodyRecord.ok !== false;
        if (bridgeOk) break;
        if (attempts >= 3) throw new Error(`${text.printDebugFailed} (${responseStatus})`);
        await sleep(backoffMs);
        backoffMs = Math.min(2400, backoffMs * 2);
      }
      applyBluetoothDevice(device);
      const message = isRecord(body) && typeof body.message === "string" ? body.message : `${text.connectedMessage}: ${device.name || device.address || "device"}`;
      setBridgeHealth({ ok: true, code: "bridge_browser_ok", message, latencyMs: null });
      setSubmitSuccess(message);
    } catch (connectError) {
      setBridgeHealth({ ok: false, code: "bridge_browser_failed", message: connectError instanceof Error ? connectError.message : text.printDebugFailed, latencyMs: null });
      setSubmitError(connectError instanceof Error ? connectError.message : text.printDebugFailed);
    } finally {
      setConnectingDeviceId(null);
    }
  }

  async function handleBridgePrint58Debug() {
    setPrintingBridgeTest(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    const targetAddress = normalizeText(bluetoothAddress);
    const targetName = normalizeText(bluetoothName) ?? normalizeText(printerName) ?? "Bluetooth Printer";
    if (!targetAddress && !targetName) {
      setSubmitError(text.requiredBluetooth);
      setPrintingBridgeTest(false);
      return;
    }
    const sampleHtml = `<!doctype html><html><head><meta charset="utf-8"/><style>@page{size:58mm 120mm;margin:0}html,body{width:58mm;margin:0;padding:0;font-family:Tahoma,sans-serif;font-size:11px}main{padding:2mm}h1{font-size:12px;margin:0 0 2mm}p{margin:0 0 1mm}</style></head><body><main><h1>Bluetooth 58mm Test</h1><p>Browser bridge test from CpIPOS.</p><p>${new Date().toISOString()}</p></main></body></html>`;
    const requestPayload = {
      action: "print",
      printer_id: "settings-browser-test",
      printer_name: printerName.trim() || targetName,
      connection_type: "BLUETOOTH_BRIDGE",
      payload_text: `Bluetooth 58mm Test\n${new Date().toISOString()}\n`,
      payload_html: sampleHtml,
      metadata: {
        ...generatedMetadata,
        transport: "bluetooth",
        print_format: "html_58mm",
        bluetooth_address: targetAddress,
        bluetooth_name: targetName,
        auto_connect: autoConnect,
        connect_before_print: connectBeforePrint,
        request_source: "backoffice_printer_settings_browser"
      }
    };
    try {
      const { response, body } = await postBridgeFromBrowser<unknown>(bridgeUrlInput, requestPayload, 12000);
      setBridgeDebug((current) => ({ ...current, print: { at: new Date().toISOString(), attempts: 1, request: requestPayload, status: response.status, response: body } }));
      const bodyRecord = isRecord(body) ? body : {};
      if (!response.ok || bodyRecord.ok === false) throw new Error(typeof bodyRecord.message === "string" ? bodyRecord.message : `${text.printDebugFailed} (${response.status})`);
      setBridgeHealth({ ok: true, code: "bridge_browser_ok", message: text.printDebugComplete, latencyMs: null });
      setSubmitSuccess(text.printDebugComplete);
    } catch (printError) {
      setBridgeHealth({ ok: false, code: "bridge_browser_failed", message: printError instanceof Error ? printError.message : text.printDebugFailed, latencyMs: null });
      setSubmitError(printError instanceof Error ? printError.message : text.printDebugFailed);
    } finally {
      setPrintingBridgeTest(false);
    }
  }
  function applyPrinterToForm(printer: PrinterRow) {
    const metadata = printer.metadata ?? {};
    const drawer = cashDrawerMetadata(metadata);
    setEditingPrinterId(printer.id);
    setPrinterName(printer.printer_name);
    setPrinterRole(printer.printer_role);
    setConnectionType(printer.connection_type);
    setPaperWidthMm(printer.paper_width_mm);
    setIpAddress(printer.ip_address ?? "");
    setPortValue(printer.port ? String(printer.port) : "9100");
    setBridgeUrlInput(metadataValue(metadata, "bridge_url") ?? "");
    setWebprntUrl(metadataValue(metadata, "webprnt_url") ?? "");
    setBluetoothAddress(metadataValue(metadata, "bluetooth_address") ?? "");
    setBluetoothName(metadataValue(metadata, "bluetooth_name") ?? "");
    setAgentDeviceBinding(metadataValue(metadata, "agent_device_code") ?? metadataValue(metadata, "device_code") ?? "");
    setAutoConnect(metadata.auto_connect !== false);
    setConnectBeforePrint(metadata.connect_before_print !== false);
    setCashDrawerEnabled(Boolean(drawer.enabled ?? metadata.cash_drawer_enabled));
    setCashDrawerAutoOpen(Boolean(drawer.autoOpenOnCashPayment ?? metadata.cash_drawer_auto_open_cash));
    setMetadataTextValue(JSON.stringify(metadata, null, 2));
    setEnabled(printer.enabled);
    setSubmitSuccess(text.editPrinter + ": " + printer.printer_name);
    setSubmitError(null);
  }

  function applyBrowserAgentPreset() {
    const knownAgentCode = agentDeviceBinding.trim() || createdAgentKey?.deviceCode || agents.find((agent) => agent.status === "active")?.device_code || "";
    setConnectionType("LOCAL_BRIDGE");
    setBridgeUrlInput(BROWSER_AGENT_BRIDGE_URL);
    setBluetoothAddress("");
    setBluetoothName("");
    setIpAddress("");
    setPortValue("");
    setAgentDeviceBinding(knownAgentCode);
    setMetadataTextValue(JSON.stringify({ print_mode: "agent", processing_mode: "print_agent", queue_only: true, provider: "browser_web_serial" }, null, 2));
    setSubmitSuccess(text.browserAgentPrinterPresetHint);
  }

  function buildPrinterPayload() {
    if (isNetworkMode && !normalizeText(ipAddress)) throw new Error(text.requiredNetwork);
    if (isBridgeMode && !normalizeText(bridgeUrlInput)) throw new Error(text.requiredBridge);
    if (isWebMode && !normalizeText(webprntUrl)) throw new Error(text.requiredWebprnt);
    if (isBluetoothMode && !normalizeText(bluetoothAddress) && !normalizeText(bluetoothName)) throw new Error(text.requiredBluetooth);
    const advancedMetadata = readJsonObject(metadataTextValue);
    const metadata = { ...generatedMetadata, ...advancedMetadata };
    return { printer_name: printerName.trim(), printer_role: printerRole, connection_type: connectionType, ip_address: isNetworkMode ? ipAddress.trim() : null, port: isNetworkMode ? Number(portValue || 0) || 9100 : null, paper_width_mm: paperWidthMm, enabled, metadata };
  }

  async function handleCreatePrinter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const payload = buildPrinterPayload();
      const requestBody = editingPrinterId ? { ...payload, printer_id: editingPrinterId } : payload;
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<PrinterRow>>("/api/backoffice/printers", { method: editingPrinterId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(requestBody) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createPrinterFailed);
      setSubmitSuccess((editingPrinterId ? text.printerUpdated : text.printerCreated) + ": " + (body?.data?.printer_name ?? payload.printer_name));
      setReloadKey((key) => key + 1);
      resetPrinterForm();
    } catch (createError) {
      setSubmitError(createError instanceof Error ? createError.message : text.createPrinterFailed);
    } finally {
      setSubmitting(false);
    }
  }

  async function patchPrinter(printer: PrinterRow, patch: Partial<PrinterRow> & { metadata?: Record<string, unknown> }) {
    setPrinterActionId(printer.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const payload = { printer_id: printer.id, printer_name: patch.printer_name ?? printer.printer_name, printer_role: patch.printer_role ?? printer.printer_role, connection_type: patch.connection_type ?? printer.connection_type, ip_address: patch.ip_address === undefined ? printer.ip_address : patch.ip_address, port: patch.port === undefined ? printer.port : patch.port, paper_width_mm: patch.paper_width_mm ?? printer.paper_width_mm, enabled: patch.enabled ?? printer.enabled, metadata: patch.metadata ?? printer.metadata ?? {} };
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<PrinterRow>>("/api/backoffice/printers", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.updatePrinter);
      setSubmitSuccess(text.printerUpdated + ": " + (body?.data?.printer_name ?? printer.printer_name));
      setReloadKey((key) => key + 1);
    } catch (patchError) {
      setSubmitError(patchError instanceof Error ? patchError.message : text.createPrinterFailed);
    } finally {
      setPrinterActionId(null);
    }
  }

  async function handleSetPrinterBrowserAgent(printer: PrinterRow) {
    const metadata: Record<string, unknown> = { ...(printer.metadata ?? {}), bridge_url: BROWSER_AGENT_BRIDGE_URL, print_mode: "agent", processing_mode: "print_agent", queue_only: true, provider: "browser_web_serial" };
    const deviceCode = agentDeviceBinding.trim() || metadataValue(printer.metadata ?? {}, "agent_device_code") || metadataValue(printer.metadata ?? {}, "device_code");
    if (deviceCode) metadata.agent_device_code = deviceCode;
    await patchPrinter(printer, { connection_type: "LOCAL_BRIDGE", ip_address: null, port: null, enabled: true, metadata });
  }

  async function handleTogglePrinterEnabled(printer: PrinterRow) {
    await patchPrinter(printer, { enabled: !printer.enabled });
  }

  async function handleDeletePrinter(printer: PrinterRow) {
    if (!window.confirm(`Delete printer ${printer.printer_name}?`)) return;
    setPrinterActionId(printer.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ deleted?: unknown }>>("/api/backoffice/printers", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer_id: printer.id }) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createPrinterFailed);
      if (editingPrinterId === printer.id) resetPrinterForm();
      setSubmitSuccess(text.printerDeleted + ": " + printer.printer_name);
      setReloadKey((key) => key + 1);
    } catch (deleteError) {
      setSubmitError(deleteError instanceof Error ? deleteError.message : text.createPrinterFailed);
    } finally {
      setPrinterActionId(null);
    }
  }

  async function handleTestPrint(printerId: string) {
    setTestingId(printerId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ printer_id: string; job?: { status?: string | null } | null }>>("/api/backoffice/printers/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ printer_id: printerId }) }, 15000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.testFailed);
      setSubmitSuccess(body?.data?.job?.status === "pending" ? `${text.testQueuedAgent}: ${printerId}` : `${text.testQueued}: ${printerId}`);
      setReloadKey((key) => key + 1);
    } catch (testError) {
      setSubmitError(testError instanceof Error ? testError.message : text.testFailed);
    } finally {
      setTestingId(null);
    }
  }

  async function handleCreateAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAgentSubmitting(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setCreatedAgentKey(null);
    try {
      const metadata = readJsonObject(agentMetadataText);
      const payload = { agent_name: agentName.trim(), device_code: agentDeviceCode.trim(), app_version: agentVersion.trim() || null, metadata };
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ agent?: PrintAgentRow; agent_key?: string }>>("/api/backoffice/printers/agents", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.createAgentFailed);
      setCreatedAgentKey({ agentName: body?.data?.agent?.agent_name ?? payload.agent_name, deviceCode: body?.data?.agent?.device_code ?? payload.device_code, key: body?.data?.agent_key ?? "" });
      setSubmitSuccess(text.copySecretNow);
      setAgentName("");
      setAgentDeviceCode("");
      setAgentVersion("");
      setAgentMetadataText("");
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.createAgentFailed);
    } finally {
      setAgentSubmitting(false);
    }
  }

  async function handleDeleteAgent(agent: PrintAgentRow) {
    if (!window.confirm(`Delete Print Agent ${agent.agent_name}?`)) return;
    setAgentActionId(agent.id);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ agent?: PrintAgentRow }>>("/api/backoffice/printers/agents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agent.id }) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.updateAgentFailed);
      setSubmitSuccess(text.agentDeleted + ": " + agent.agent_name);
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.updateAgentFailed);
    } finally {
      setAgentActionId(null);
    }
  }

  async function handleUpdateAgent(agentId: string, action: "revoke" | "block") {
    setAgentActionId(agentId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const { response, body } = await fetchJsonWithTimeout<ApiEnvelope<{ agent?: PrintAgentRow }>>("/api/backoffice/printers/agents", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_id: agentId, action }) }, 10000);
      if (!response.ok || body?.error) throw new Error(body?.error?.message ?? text.updateAgentFailed);
      setSubmitSuccess(action === "block" ? text.agentBlocked : text.agentRevoked);
      setReloadKey((key) => key + 1);
    } catch (agentError) {
      setSubmitError(agentError instanceof Error ? agentError.message : text.updateAgentFailed);
    } finally {
      setAgentActionId(null);
    }
  }

  return (
    <section className="surface" style={{ display: "grid", gap: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 22 }}>{text.title}</h2>
          <p style={{ margin: "6px 0 0", color: "var(--muted)", maxWidth: 760 }}>{text.description}</p>
        </div>
        {isBluetoothMode ? (
          <div style={{ ...panelStyle, padding: "8px 12px", minWidth: 220, background: bridgeHealth?.ok ? "#ecfdf3" : "#fff7ed" }}>
            <strong style={{ color: bridgeHealth?.ok ? "#067647" : "#b54708" }}>{text.status}: {bridgeHealth ? (bridgeHealth.ok ? text.online : text.offline) : text.checking}</strong>
            <div style={{ color: "#475467", fontSize: 12 }}>{bridgeHealth?.latencyMs != null ? `${bridgeHealth.latencyMs}ms` : bridgeHealth?.code ?? "-"}</div>
          </div>
        ) : null}
      </header>

      <nav style={{ display: "flex", flexWrap: "wrap", gap: 8 }} aria-label={text.title}>
        {([["printers", text.printers], ["agents", text.agents], ["assignment", text.assignment]] as Array<[ActivePanel, string]>).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setActivePanel(key)} style={activePanel === key ? primaryButtonStyle : buttonStyle}>{label}</button>
        ))}
      </nav>

      {submitError ? <ErrorState message={submitError} /> : null}
      {submitSuccess ? <p style={{ margin: 0, color: "#067647", fontWeight: 800 }}>{submitSuccess}</p> : null}

      {activePanel === "printers" ? (
        <>
          <div style={{ ...panelStyle, background: "#eff8ff", borderColor: "#b2ddff", color: "#1849a9", fontWeight: 700 }}>{text.browserBridgeHint}<div style={{ marginTop: 6, color: "#0b4a6f" }}>{text.printFlowHint}</div></div>
          <section style={{ ...panelStyle, borderColor: browserAgentEnabled ? "#84caff" : "#d8e0ea", background: "#f8fbff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{text.browserAgentTitle}</h3>
                <p style={{ margin: "6px 0 0", color: "#475467", maxWidth: 820 }}>{text.browserAgentDesc}</p>
                <p style={{ margin: "6px 0 0", color: "#b54708", fontWeight: 800 }}>{text.browserAgentLimit}</p>
              </div>
              <div style={{ ...panelStyle, minWidth: 230, padding: "8px 12px", background: browserAgentStatus?.connected || browserAgentPortReady ? "#ecfdf3" : "#fff7ed" }}>
                <strong style={{ color: browserAgentStatus?.connected || browserAgentPortReady ? "#067647" : "#b54708" }}>{text.status}: {browserAgentStatus?.code ?? (browserAgentPortReady ? text.browserAgentReady : text.browserAgentPortMissing)}</strong>
                <div style={{ color: "#475467", fontSize: 12 }}>{browserAgentStatus?.message ?? (browserAgentSupported ? "Web Serial" : text.browserAgentUnsupported)}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignItems: "end", marginTop: 14 }}>
              <label style={labelStyle}>{text.browserAgentSecret}<input type="password" value={browserAgentSecret} onChange={(event) => setBrowserAgentSecret(event.target.value)} placeholder="cpi_pa_..." style={inputStyle} /></label>
              <label style={labelStyle}>{text.browserAgentBaud}<select value={browserAgentBaud} onChange={(event) => setBrowserAgentBaud(event.target.value)} style={inputStyle}><option value="9600">9600</option><option value="19200">19200</option><option value="38400">38400</option><option value="57600">57600</option><option value="115200">115200</option></select></label>
              <button type="button" onClick={() => void handleSelectBrowserSerialPrinter()} disabled={browserAgentBusy === "select"} style={buttonStyle}>{browserAgentBusy === "select" ? text.connecting : text.selectSerialPrinter}</button>
              <button type="button" onClick={() => void handleReconnectBrowserSerialPrinter()} disabled={browserAgentBusy === "reconnect"} style={buttonStyle}>{browserAgentBusy === "reconnect" ? text.connecting : text.reconnectSerialPrinter}</button>
              <button type="button" onClick={() => void handleBrowserSerialTestPrint()} disabled={browserAgentBusy === "test"} style={buttonStyle}>{browserAgentBusy === "test" ? text.testingPrint : text.testBrowserSerial}</button>
              <button type="button" onClick={handleResetBrowserAgent} style={dangerButtonStyle}>{text.resetBrowserAgent}</button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={browserAgentEnabled} onChange={(event) => setBrowserAgentEnabled(event.target.checked)} />{text.browserAgentEnable}</label>
              <button type="button" onClick={() => void handleSaveBrowserAgent()} style={primaryButtonStyle}>{text.saveBrowserAgent}</button>
            </div>
          </section>
          <section style={{ ...panelStyle, borderColor: bleAgentEnabled ? "#84caff" : "#d8e0ea", background: "#f8fbff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>{text.bleAgentTitle}</h3>
                <p style={{ margin: "6px 0 0", color: "#475467", maxWidth: 820 }}>{text.bleAgentDesc}</p>
                <p style={{ margin: "6px 0 0", color: "#b54708", fontWeight: 800 }}>{text.bleAgentLimit}</p>
              </div>
              <div style={{ ...panelStyle, minWidth: 230, padding: "8px 12px", background: browserAgentStatus?.connected ? "#ecfdf3" : "#fff7ed" }}>
                <strong style={{ color: browserAgentStatus?.connected ? "#067647" : "#b54708" }}>{text.status}: {browserAgentStatus?.code ?? text.browserAgentPortMissing}</strong>
                <div style={{ color: "#475467", fontSize: 12 }}>{browserAgentStatus?.message ?? "Web Bluetooth"}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, alignItems: "end", marginTop: 14 }}>
              <label style={labelStyle}>{text.browserAgentSecret}<input type="password" value={browserAgentSecret} onChange={(event) => setBrowserAgentSecret(event.target.value)} placeholder="cpi_pa_..." style={inputStyle} /></label>
              <label style={labelStyle}>{text.bleServiceUuid}<input value={bleServiceUuid} onChange={(event) => setBleServiceUuid(event.target.value)} placeholder="000018f0-0000-1000-8000-00805f9b34fb" style={inputStyle} /></label>
              <label style={labelStyle}>{text.bleCharacteristicUuid}<input value={bleCharacteristicUuid} onChange={(event) => setBleCharacteristicUuid(event.target.value)} placeholder="00002af1-0000-1000-8000-00805f9b34fb" style={inputStyle} /></label>
              <button type="button" onClick={handleResetBleAgent} style={dangerButtonStyle}>{text.resetBleAgent}</button>
            </div>
            <p style={{ margin: "10px 0 0", color: "#475467", fontSize: 12 }}>{text.bleUuidHint}</p>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={bleAgentEnabled} onChange={(event) => setBleAgentEnabled(event.target.checked)} />{text.bleAgentEnable}</label>
              <button type="button" onClick={() => void handleSaveBleAgent()} style={primaryButtonStyle}>{text.saveBrowserAgent}</button>
            </div>
            {bleAgentEnabled ? <p style={{ margin: "10px 0 0", color: "#1849a9", fontWeight: 700 }}>{text.bleAgentPairHint}</p> : null}
          </section>
          <form onSubmit={handleCreatePrinter} style={{ display: "grid", gap: 14 }}>
            <section style={panelStyle}>
              <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.printPath}</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
                {connectionOptions.map((option) => (
                  <button key={option.type} type="button" onClick={() => setConnectionType(option.type)} style={{ ...panelStyle, textAlign: "left", cursor: "pointer", background: connectionType === option.type ? "#eff8ff" : "#fff", borderColor: connectionType === option.type ? "#175cd3" : "#d8e0ea" }}>
                    <strong style={{ display: "block", color: connectionType === option.type ? "#175cd3" : "#101828" }}>{option.title}</strong>
                    <span style={{ display: "block", marginTop: 4, color: "#667085", fontSize: 12 }}>{option.desc}</span>
                  </button>
                ))}
              </div>
            </section>

            <section style={panelStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}><h3 style={{ margin: 0, fontSize: 16 }}>{editingPrinterId ? text.updatePrinter : text.newPrinter}</h3><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" onClick={applyBrowserAgentPreset} style={buttonStyle}>{text.browserAgentPrinterPreset}</button>{editingPrinterId ? <button type="button" onClick={resetPrinterForm} style={buttonStyle}>{text.cancelEdit}</button> : null}</div></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
                <label style={labelStyle}>{text.printerName}<input value={printerName} onChange={(event) => setPrinterName(event.target.value)} required style={inputStyle} /></label>
                <label style={labelStyle}>{text.role}<select value={printerRole} onChange={(event) => setPrinterRole(event.target.value as PrinterRole)} style={inputStyle}><option value="receipt">{text.receipt}</option><option value="kitchen">{text.kitchen}</option><option value="report">{text.report}</option></select></label>
                <label style={labelStyle}>{text.paper}<select value={String(paperWidthMm)} onChange={(event) => setPaperWidthMm(Number(event.target.value) === 80 ? 80 : 58)} style={inputStyle}><option value="58">58mm</option><option value="80">80mm</option></select></label>
                {isNetworkMode ? <label style={labelStyle}>{text.ipAddress}<input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder="192.168.1.50" style={inputStyle} /></label> : null}
                {isNetworkMode ? <label style={labelStyle}>{text.port}<input type="number" value={portValue} onChange={(event) => setPortValue(event.target.value)} placeholder="9100" style={inputStyle} /></label> : null}
                {isBridgeMode ? <label style={labelStyle}>{text.bridgeUrl}<input value={bridgeUrlInput} onChange={(event) => setBridgeUrlInput(event.target.value)} placeholder="http://127.0.0.1:3210/print" style={inputStyle} /></label> : null}
                {isWebMode ? <label style={labelStyle}>{text.webprntUrl}<input value={webprntUrl} onChange={(event) => setWebprntUrl(event.target.value)} placeholder="http://printer.local/StarWebPRNT/SendMessage" style={inputStyle} /></label> : null}
                {isBluetoothMode ? <label style={labelStyle}>{text.bluetoothAddress}<input value={bluetoothAddress} onChange={(event) => setBluetoothAddress(event.target.value)} placeholder="AA:BB:CC:DD:EE:FF" style={inputStyle} /></label> : null}
                {isBluetoothMode ? <label style={labelStyle}>{text.bluetoothName}<input value={bluetoothName} onChange={(event) => setBluetoothName(event.target.value)} placeholder="MTP-II" style={inputStyle} /></label> : null}
                <label style={labelStyle}>{text.agentDeviceCode}<input value={agentDeviceBinding} onChange={(event) => setAgentDeviceBinding(event.target.value)} placeholder="POS-COUNTER-01" style={inputStyle} /></label>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />{text.enabled}</label>
                {isBluetoothMode ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={autoConnect} onChange={(event) => setAutoConnect(event.target.checked)} />{text.autoConnect}</label> : null}
                {isBluetoothMode ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={connectBeforePrint} onChange={(event) => setConnectBeforePrint(event.target.checked)} />{text.connectBeforePrint}</label> : null}
                {printerRole === "receipt" ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={cashDrawerEnabled} onChange={(event) => setCashDrawerEnabled(event.target.checked)} />{text.cashDrawer}</label> : null}
                {cashDrawerEnabled ? <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 800 }}><input type="checkbox" checked={cashDrawerAutoOpen} onChange={(event) => setCashDrawerAutoOpen(event.target.checked)} />{text.autoOpenCash}</label> : null}
              </div>
              <details style={{ marginTop: 12 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800 }}>{text.advancedMetadata}</summary>
                <p style={{ color: "#667085", fontSize: 12 }}>{text.advancedMetadataHint}</p>
                <textarea value={metadataTextValue} onChange={(event) => setMetadataTextValue(event.target.value)} rows={5} placeholder={JSON.stringify(generatedMetadata, null, 2)} style={{ ...inputStyle, width: "100%", fontFamily: "Consolas, monospace" }} />
              </details>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
                <button type="submit" disabled={submitting} style={primaryButtonStyle}>{submitting ? text.saving : editingPrinterId ? text.updatePrinter : text.addPrinter}</button>
              </div>
            </section>
          </form>

          {isBluetoothMode ? (
            <section style={panelStyle}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, alignItems: "end" }}>
                <label style={labelStyle}>{text.bridgeUrl}<input value={bridgeUrlInput} onChange={(event) => setBridgeUrlInput(event.target.value)} style={inputStyle} /></label>
                <button type="button" onClick={() => void handleDiscoverBluetooth()} disabled={discovering} style={buttonStyle}>{discovering ? text.scanning : text.scanBluetooth}</button>
                <button type="button" onClick={() => void handleBridgePrint58Debug()} disabled={printingBridgeTest} style={buttonStyle}>{printingBridgeTest ? text.testingPrint : text.debugPrint58}</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 12 }}>
                {discoveredDevices.length === 0 ? <div style={{ color: "#667085", fontSize: 13 }}>{text.noDevices}</div> : discoveredDevices.map((device) => (
                  <div key={device.id} style={{ ...panelStyle, background: "#f8fafc" }}>
                    <strong>{device.name || "Bluetooth Printer"}</strong>
                    <div style={{ color: "#667085", fontSize: 12 }}>{text.address}: {device.address ?? "-"}</div>
                    <div style={{ color: "#667085", fontSize: 12 }}>{text.status}: {device.connected ? text.online : text.offline} / RSSI {device.rssi ?? "-"}</div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                      <button type="button" onClick={() => applyBluetoothDevice(device)} style={buttonStyle}>{text.useDevice}</button>
                      <button type="button" onClick={() => void handleConnectBluetooth(device)} disabled={connectingDeviceId === device.id} style={buttonStyle}>{connectingDeviceId === device.id ? text.connecting : text.connectDevice}</button>
                    </div>
                  </div>
                ))}
              </div>
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: "pointer", fontWeight: 800 }}>{text.debugPanel}</summary>
                <pre style={{ marginTop: 8, maxHeight: 260, overflow: "auto", background: "#f8fafc", border: "1px solid #d8e0ea", padding: 10, borderRadius: 8 }}>{JSON.stringify(bridgeDebug, null, 2)}</pre>
              </details>
            </section>
          ) : null}

          <section style={panelStyle}>
            <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.printers}</h3>
            {loading ? <LoadingState label={text.loadPrinters} /> : null}
            {!loading && error ? <ErrorState message={error} /> : null}
            {!loading && !error && items.length === 0 ? <EmptyState label={text.noPrinters} /> : null}
            {!loading && !error && items.length > 0 ? (
              <>
                <div style={{ display: "grid", gap: 10 }}>
                  {items.map((printer) => (
                    <div key={printer.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "center", borderBottom: "1px solid #edf2f7", padding: "10px 0" }}>
                      <div><strong>{printer.printer_name}</strong><div style={{ color: "#667085", fontSize: 12 }}>{printer.printer_role} / {printer.paper_width_mm}mm</div></div>
                      <div><strong style={{ fontSize: 13 }}>{printerConnectionLabel(printer)}</strong><div style={{ color: "#667085", fontSize: 12, overflowWrap: "anywhere" }}>{printerAddress(printer)}</div></div>
                      <span style={{ color: printer.enabled ? "#067647" : "#b42318", fontWeight: 800 }}>{printer.enabled ? text.yes : text.no}</span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}><button type="button" onClick={() => applyPrinterToForm(printer)} style={buttonStyle}>{text.editPrinter}</button><button type="button" disabled={printerActionId === printer.id} onClick={() => void handleSetPrinterBrowserAgent(printer)} style={buttonStyle}>{text.setBrowserAgent}</button><button type="button" disabled={printerActionId === printer.id} onClick={() => void handleTogglePrinterEnabled(printer)} style={printer.enabled ? dangerButtonStyle : buttonStyle}>{printer.enabled ? text.disablePrinter : text.enablePrinter}</button><button type="button" disabled={printerActionId === printer.id} onClick={() => void handleDeletePrinter(printer)} style={dangerButtonStyle}>{text.deletePrinter}</button><button type="button" disabled={testingId === printer.id || !printer.enabled} onClick={() => void handleTestPrint(printer.id)} style={buttonStyle}>{testingId === printer.id ? text.testing : text.testPrint}</button></div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}><PaginationControls page={pagination.page} totalPages={pagination.total_pages} onPageChange={setPage} /></div>
              </>
            ) : null}
          </section>
        </>
      ) : null}

      {activePanel === "agents" ? (
        <section style={panelStyle}>
          <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>{text.localAgents}</h3>
          <form onSubmit={handleCreateAgent} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12 }}>
            <label style={labelStyle}>{text.agentName}<input value={agentName} onChange={(event) => setAgentName(event.target.value)} required style={inputStyle} /></label>
            <label style={labelStyle}>{text.deviceCode}<input value={agentDeviceCode} onChange={(event) => setAgentDeviceCode(event.target.value)} required placeholder="POS-COUNTER-01" style={inputStyle} /></label>
            <label style={labelStyle}>{text.appVersion}<input value={agentVersion} onChange={(event) => setAgentVersion(event.target.value)} style={inputStyle} /></label>
            <label style={labelStyle}>{text.agentMetadata}<input value={agentMetadataText} onChange={(event) => setAgentMetadataText(event.target.value)} placeholder='{"os":"windows"}' style={inputStyle} /></label>
            <button type="submit" disabled={agentSubmitting} style={primaryButtonStyle}>{agentSubmitting ? text.creating : text.createAgentSecret}</button>
          </form>
          {createdAgentKey ? (
            <div style={{ ...panelStyle, marginTop: 12, background: "#fff7ed", borderColor: "#fed7aa" }}>
              <strong>{text.copySecretNow}</strong>
              <div style={{ color: "#667085", fontSize: 12, marginTop: 4 }}>{createdAgentKey.agentName} / {createdAgentKey.deviceCode}</div>
              <code style={{ display: "block", overflowX: "auto", padding: 8, background: "#fff", border: "1px solid #fed7aa", borderRadius: 8, marginTop: 8 }}>{createdAgentKey.key}</code>
              <button type="button" onClick={() => void navigator.clipboard?.writeText(createdAgentKey.key)} style={{ ...buttonStyle, marginTop: 8 }}>{text.copySecret}</button>
            </div>
          ) : null}
          <div style={{ display: "grid", gap: 10, marginTop: 14 }}>
            {agentsLoading ? <LoadingState label={text.loadingAgents} /> : null}
            {!agentsLoading && agents.length === 0 ? <EmptyState label={text.noAgents} /> : null}
            {!agentsLoading ? agents.map((agent) => (
              <div key={agent.id} style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, alignItems: "center", borderBottom: "1px solid #edf2f7", padding: "10px 0" }}>
                <div><strong>{agent.agent_name}</strong><div style={{ color: "#667085", fontSize: 12 }}>{agent.app_version ?? "-"}</div></div>
                <div><strong>{agent.device_code}</strong><div style={{ color: "#667085", fontSize: 12 }}>{agent.device_id ?? "-"}</div></div>
                <div><strong>{agent.status}</strong><div style={{ color: "#667085", fontSize: 12 }}>{formatDate(agent.last_seen_at)}</div></div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" disabled={agentActionId === agent.id || agent.status !== "active"} onClick={() => void handleUpdateAgent(agent.id, "revoke")} style={buttonStyle}>{text.revoke}</button>
                  <button type="button" disabled={agentActionId === agent.id || agent.status === "blocked"} onClick={() => void handleUpdateAgent(agent.id, "block")} style={buttonStyle}>{text.block}</button>
                  <button type="button" disabled={agentActionId === agent.id} onClick={() => void handleDeleteAgent(agent)} style={dangerButtonStyle}>{text.deleteAgent}</button>
                </div>
              </div>
            )) : null}
          </div>
        </section>
      ) : null}

      {activePanel === "assignment" ? (
        <section style={panelStyle}>
          <h3 style={{ margin: "0 0 8px", fontSize: 16 }}>{text.assignmentTitle}</h3>
          <p style={{ color: "#667085", marginTop: 0 }}>{text.assignmentText}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {[text.routeReceipt, text.routeKitchen, text.routeDevice].map((item) => <div key={item} style={{ ...panelStyle, background: "#f8fafc" }}>{item}</div>)}
          </div>
          <pre style={{ marginTop: 12, overflowX: "auto", background: "#f8fafc", border: "1px solid #d8e0ea", borderRadius: 8, padding: 10 }}>{'{"agent_device_code":"POS-COUNTER-01","bridge_timeout_ms":8000}'}</pre>
        </section>
      ) : null}
    </section>
  );
}
