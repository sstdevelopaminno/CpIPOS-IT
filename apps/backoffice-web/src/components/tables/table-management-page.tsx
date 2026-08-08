"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BranchRole } from "@pos/shared-types";
import { ErrorState } from "@/components/backoffice/list-state";
import { PosManagerApprovalModal } from "@/components/pos-ui/pos-manager-approval-modal";
import { FloorPlanCanvas } from "@/components/tables/floor-plan-canvas";
import { getFloorObjectTypeLabel, getTableShapeLabel, getTableStatusLabel, getTableUiText } from "@/components/tables/table-i18n";
import { FloorPlanToolbar } from "@/components/tables/floor-plan-toolbar";
import { TableListGrid } from "@/components/tables/table-list-grid";
import type { DiningTableItem, FloorPlanObjectItem, TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { floorObjectDefaults, floorObjectTypes, tableShapes, tableStatuses } from "@/lib/table-management";

async function readJson(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

type TablePerfEvent = {
  event: "load" | "action" | "api";
  label: string;
  durationMs: number;
  status?: number;
  ok?: boolean;
  meta?: Record<string, unknown>;
  at?: string;
};

type BranchScopeItem = {
  id: string;
  code: string;
  name: string;
  role: "owner" | "manager" | "staff";
  isDefault?: boolean;
};

function emitTablePerf(event: TablePerfEvent) {
  if (typeof window === "undefined") return;
  const payload = {
    ...event,
    at: new Date().toISOString()
  };
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_TABLE_PERF_DEBUG === "1") {
    const parts = [`[TablePerf] ${payload.event}:${payload.label}`, `${payload.durationMs.toFixed(1)}ms`];
    if (typeof payload.status === "number") {
      parts.push(`status=${payload.status}`);
    }
    if (typeof payload.ok === "boolean") {
      parts.push(`ok=${payload.ok}`);
    }
    if (payload.meta && Object.keys(payload.meta).length > 0) {
      parts.push(JSON.stringify(payload.meta));
    }
    console.info(parts.join(" | "));
  }
  window.dispatchEvent(new CustomEvent("table-management:perf", { detail: payload }));
}

const initialTableForm = {
  id: "",
  zone_id: "",
  table_code: "",
  table_name: "",
  capacity: "4",
  status: "available",
  shape: "rectangle",
  position_x: "0",
  position_y: "0",
  width: "96",
  height: "72",
  rotation: "0",
  is_active: true
};

function toNumber(value: string, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type ConfirmDialogState = {
  title: string;
  message: string;
  hint?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
};

type TableApprovalRequest =
  | {
      kind: "edit";
      tableId: string;
      payload: Record<string, unknown>;
    }
  | {
      kind: "delete";
      tableId: string;
      tableCode: string;
    };

export function TableManagementPage({ lang = "th", initialRole = null }: { lang?: Language; initialRole?: BranchRole | null | string }) {
  const text = getTableUiText(lang);
  const normalizedRole: BranchRole | null =
    initialRole === "owner" || initialRole === "manager" || initialRole === "staff" || initialRole === "accountant"
      ? initialRole
      : null;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setSuccess] = useState<string | null>(null);
  const [zones, setZones] = useState<TableZoneItem[]>([]);
  const [tables, setTables] = useState<DiningTableItem[]>([]);
  const [draftTables, setDraftTables] = useState<DiningTableItem[]>([]);
  const [objects, setObjects] = useState<FloorPlanObjectItem[]>([]);
  const [draftObjects, setDraftObjects] = useState<FloorPlanObjectItem[]>([]);
  const [branchOptions, setBranchOptions] = useState<BranchScopeItem[]>([]);
  const [branchFilterId, setBranchFilterId] = useState("");
  const [activeZoneId, setActiveZoneId] = useState("all");
  const [selectedTable, setSelectedTable] = useState<DiningTableItem | null>(null);
  const [selectedObject, setSelectedObject] = useState<FloorPlanObjectItem | null>(null);
  const [viewMode, setViewMode] = useState<"sorted" | "floor">("sorted");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [listSearch, setListSearch] = useState("");
  const [listSortMode, setListSortMode] = useState<"natural" | "capacity_desc" | "status">("natural");
  const [objectCreateType, setObjectCreateType] = useState<(typeof floorObjectTypes)[number]>("counter");
  const [tableForm, setTableForm] = useState(initialTableForm);
  const [tableEditorOpen, setTableEditorOpen] = useState(false);
  const [tableEditorMode, setTableEditorMode] = useState<"create" | "edit">("create");
  const [quickCreateForm, setQuickCreateForm] = useState({
    zone_name: "",
    table_name: "",
    capacity: "4"
  });
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [tableApprovalRequest, setTableApprovalRequest] = useState<TableApprovalRequest | null>(null);
  const loadRequestIdRef = useRef(0);
  const telemetryDisabledRef = useRef(false);
  const telemetryWarnedRef = useRef(false);

  const branchSelectLabel = lang === "th" ? "สาขา" : "Branch";
  const allBranchesLabel = lang === "th" ? "ทุกสาขา" : "All branches";
  const chooseBranchFirstLabel = lang === "th" ? "เลือกสาขาก่อนเพิ่ม/แก้ไขโต๊ะ" : "Choose a branch before editing tables";

  const selectedActionBranchId = branchFilterId && branchFilterId !== "all" ? branchFilterId : "";
  const canWriteSelectedBranch = Boolean(selectedActionBranchId);
  const selectedBranchRole = branchOptions.find((branch) => branch.id === selectedActionBranchId)?.role ?? normalizedRole;
  const requiresManagerPin = selectedBranchRole === "manager";

  function buildBranchQuery(path: string, branchId = branchFilterId): string {
    const normalized = branchId.trim();
    if (!normalized) return path;
    const separator = path.includes("?") ? "&" : "?";
    return `${path}${separator}branch_id=${encodeURIComponent(normalized)}`;
  }

  const fetchJsonWithTiming = useCallback(async (input: string, init: RequestInit | undefined, label: string) => {
    const startedAt = performance.now();
    const response = await fetch(input, init);
    const body = await readJson(response);
    emitTablePerf({
      event: "api",
      label,
      durationMs: performance.now() - startedAt,
      status: response.status,
      ok: response.ok
    });
    return { response, body };
  }, []);

  const loadData = useCallback(async (options?: { showOverlay?: boolean }) => {
    const startedAt = performance.now();
    const showOverlay = options?.showOverlay ?? false;
    const requestId = ++loadRequestIdRef.current;
    if (showOverlay) {
      setLoading(true);
    }
    setError(null);
    try {
      const branchScopeResult = await fetchJsonWithTiming("/api/backoffice/branch-scope", { cache: "no-store" }, "load:branch-scope");
      const branchScopeResponse = branchScopeResult.response;
      const branchScopeBody = branchScopeResult.body;
      if (!branchScopeResponse.ok || branchScopeBody?.error) {
        throw new Error(branchScopeBody?.error?.message ?? (lang === "th" ? "โหลดข้อมูลสาขาไม่สำเร็จ" : "Failed to load branch scope."));
      }
      const nextBranchOptions = (branchScopeBody?.data?.items ?? []) as BranchScopeItem[];
      const currentBranchId = String(branchScopeBody?.data?.currentBranchId ?? "").trim();
      const requestedBranchId =
        branchFilterId === "all" && nextBranchOptions.length > 1
          ? "all"
          : nextBranchOptions.some((branch) => branch.id === branchFilterId)
            ? branchFilterId
            : currentBranchId || nextBranchOptions[0]?.id || "";
      setBranchOptions(nextBranchOptions);
      if (requestedBranchId !== branchFilterId) {
        setBranchFilterId(requestedBranchId);
      }
      const branchQuery = requestedBranchId ? `?branch_id=${encodeURIComponent(requestedBranchId)}` : "";
      const [zonesResult, tablesResult, objectsResult] = await Promise.all([
        fetchJsonWithTiming(`/api/backoffice/table-zones${branchQuery}`, { cache: "no-store" }, "load:zones"),
        fetchJsonWithTiming(`/api/backoffice/tables${branchQuery}`, { cache: "no-store" }, "load:tables"),
        fetchJsonWithTiming(`/api/backoffice/table-layout-objects${branchQuery}`, { cache: "no-store" }, "load:objects")
      ]);
      const zonesResponse = zonesResult.response;
      const tablesResponse = tablesResult.response;
      const objectsResponse = objectsResult.response;
      const zonesBody = zonesResult.body;
      const tablesBody = tablesResult.body;
      const objectsBody = objectsResult.body;
      if (!zonesResponse.ok || zonesBody?.error) {
        throw new Error(zonesBody?.error?.message ?? text.errorLoadZones);
      }
      if (!tablesResponse.ok || tablesBody?.error) {
        throw new Error(tablesBody?.error?.message ?? text.errorLoadTables);
      }
      if (!objectsResponse.ok || objectsBody?.error) {
        throw new Error(objectsBody?.error?.message ?? text.errorLoadObjects);
      }

      const zoneItems = (zonesBody?.data?.items ?? []) as TableZoneItem[];
      const tableItems = (tablesBody?.data?.items ?? []) as DiningTableItem[];
      const objectItems = (objectsBody?.data?.items ?? []) as FloorPlanObjectItem[];
      if (loadRequestIdRef.current !== requestId) {
        return;
      }

      setZones(zoneItems);
      setTables(tableItems);
      setDraftTables(tableItems);
      setObjects(objectItems);
      setDraftObjects(objectItems);
      setSelectedTable((current) => (current ? tableItems.find((table) => table.id === current.id) ?? null : tableItems[0] ?? null));
      setSelectedObject((current) => (current ? objectItems.find((item) => item.id === current.id) ?? null : null));
      emitTablePerf({
        event: "load",
        label: showOverlay ? "initial" : "refresh",
        durationMs: performance.now() - startedAt,
        meta: {
          zones: zoneItems.length,
          tables: tableItems.length,
          objects: objectItems.length
        }
      });
    } catch (loadError) {
      if (loadRequestIdRef.current === requestId) {
        setError(loadError instanceof Error ? loadError.message : text.errorUnknown);
      }
      emitTablePerf({
        event: "load",
        label: "failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: loadError instanceof Error ? loadError.message : "Unknown error"
        }
      });
    } finally {
      if (showOverlay && loadRequestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, [branchFilterId, fetchJsonWithTiming, lang, text.errorLoadObjects, text.errorLoadTables, text.errorLoadZones, text.errorUnknown]);

  useEffect(() => {
    void loadData({ showOverlay: true });
  }, [loadData]);

  useEffect(() => {
    function onPerfEvent(event: Event) {
      const customEvent = event as CustomEvent<TablePerfEvent>;
      const detail = customEvent.detail;
      if (!detail || typeof detail.durationMs !== "number" || typeof detail.label !== "string") {
        return;
      }

      const shouldPersist =
        detail.event === "load" || detail.event === "action" || detail.event === "api" || detail.ok === false || (detail.status ?? 200) >= 400;
      if (shouldPersist && !telemetryDisabledRef.current) {
        void fetch("/api/backoffice/tables/perf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detail),
          keepalive: true
        })
          .then(async (response) => {
            if (response.ok) {
              return;
            }
            telemetryDisabledRef.current = true;
            if (!telemetryWarnedRef.current) {
              telemetryWarnedRef.current = true;
              const body = await response.text().catch(() => "");
              console.warn("[TablePerf] Telemetry disabled due to non-OK response", response.status, body);
            }
          })
          .catch(() => {
            telemetryDisabledRef.current = true;
            if (!telemetryWarnedRef.current) {
              telemetryWarnedRef.current = true;
              console.warn("[TablePerf] Telemetry disabled because perf endpoint is unreachable.");
            }
          });
      }

    }

    window.addEventListener("table-management:perf", onPerfEvent as EventListener);
    return () => {
      window.removeEventListener("table-management:perf", onPerfEvent as EventListener);
    };
  }, []);

  useEffect(() => {
    if (!confirmDialog) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !confirming) {
        setConfirmDialog(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [confirmDialog, confirming]);

  const visibleDraftTables = useMemo(() => {
    if (activeZoneId === "all") return draftTables;
    return draftTables.filter((table) => table.zone_id === activeZoneId);
  }, [activeZoneId, draftTables]);

  const visibleDraftObjects = useMemo(() => {
    if (activeZoneId === "all") return draftObjects;
    return draftObjects.filter((item) => item.zone_id === activeZoneId);
  }, [activeZoneId, draftObjects]);

  const nextAutoTableCode = useMemo(() => {
    let maxCode = 0;
    for (const table of tables) {
      const raw = String(table.table_code ?? "").trim();
      const groups = raw.match(/\d+/g);
      const lastGroup = groups?.[groups.length - 1];
      if (!lastGroup) continue;
      const value = Number(lastGroup);
      if (Number.isFinite(value) && value > maxCode) {
        maxCode = value;
      }
    }
    return String(maxCode + 1);
  }, [tables]);

  const filteredTables = useMemo(() => {
    const keyword = listSearch.trim().toLowerCase();
    if (!keyword) return visibleDraftTables;
    return visibleDraftTables.filter((table) => {
      const code = table.table_code.toLowerCase();
      const name = table.table_name?.toLowerCase() ?? "";
      return code.includes(keyword) || name.includes(keyword);
    });
  }, [listSearch, visibleDraftTables]);

  const isFloorPlanDirty = useMemo(() => {
    if (tables.length !== draftTables.length || objects.length !== draftObjects.length) {
      return true;
    }
    const tableMap = new Map(tables.map((table) => [table.id, table]));
    for (const draft of draftTables) {
      const original = tableMap.get(draft.id);
      if (!original) return true;
      if (
        original.zone_id !== draft.zone_id ||
        Number(original.position_x) !== Number(draft.position_x) ||
        Number(original.position_y) !== Number(draft.position_y) ||
        Number(original.width) !== Number(draft.width) ||
        Number(original.height) !== Number(draft.height) ||
        Number(original.rotation) !== Number(draft.rotation)
      ) {
        return true;
      }
    }

    const objectMap = new Map(objects.map((item) => [item.id, item]));
    for (const draft of draftObjects) {
      const original = objectMap.get(draft.id);
      if (!original) return true;
      if (
        original.zone_id !== draft.zone_id ||
        original.object_type !== draft.object_type ||
        (original.object_name ?? "") !== (draft.object_name ?? "") ||
        original.color !== draft.color ||
        Number(original.position_x) !== Number(draft.position_x) ||
        Number(original.position_y) !== Number(draft.position_y) ||
        Number(original.width) !== Number(draft.width) ||
        Number(original.height) !== Number(draft.height) ||
        Number(original.rotation) !== Number(draft.rotation) ||
        Number(original.z_index) !== Number(draft.z_index)
      ) {
        return true;
      }
    }
    return false;
  }, [draftObjects, draftTables, objects, tables]);

  const canResetFloorPlan = useMemo(() => {
    return (
      draftTables.some(
        (table) =>
          Number(table.position_x) !== 0 ||
          Number(table.position_y) !== 0 ||
          Number(table.width) !== 96 ||
          Number(table.height) !== 72 ||
          Number(table.rotation) !== 0
      ) ||
      draftObjects.some(
        (item) =>
          Number(item.position_x) !== 24 ||
          Number(item.position_y) !== 24 ||
          Number(item.width) !== 120 ||
          Number(item.height) !== 60 ||
          Number(item.rotation) !== 0
      )
    );
  }, [draftObjects, draftTables]);

  function selectTableForEdit(table: DiningTableItem) {
    setSelectedObject(null);
    setSelectedTable(table);
    setTableForm({
      id: table.id,
      zone_id: table.zone_id ?? "",
      table_code: table.table_code,
      table_name: table.table_name ?? "",
      capacity: String(table.capacity),
      status: table.status,
      shape: table.shape,
      position_x: String(table.position_x),
      position_y: String(table.position_y),
      width: String(table.width),
      height: String(table.height),
      rotation: String(table.rotation),
      is_active: table.is_active
    });
  }

  function openCreateTableEditor() {
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    setTableEditorMode("create");
    const activeZone = activeZoneId === "all" ? null : zones.find((zone) => zone.id === activeZoneId) ?? null;
    setQuickCreateForm({
      zone_name: activeZone?.zone_name ?? "",
      table_name: "",
      capacity: "4"
    });
    setTableEditorOpen(true);
  }

  function navigateBack() {
    if (typeof window === "undefined") return;
    window.location.assign("/preview/pos/more");
  }

  function openEditTableEditor(table: DiningTableItem) {
    setTableEditorMode("edit");
    selectTableForEdit(table);
    setTableEditorOpen(true);
  }

  function selectObjectForEdit(item: FloorPlanObjectItem) {
    setSelectedTable(null);
    setSelectedObject(item);
  }

  async function submitQuickCreateForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const zoneName = quickCreateForm.zone_name.trim();
      let zoneId: string | null = null;
      let createdZone: TableZoneItem | null = null;
      if (zoneName.length > 0) {
        const existing = zones.find((zone) => zone.zone_name.trim().toLowerCase() === zoneName.toLowerCase());
        if (existing) {
          zoneId = existing.id;
        } else {
          const zoneResult = await fetchJsonWithTiming(
            "/api/backoffice/table-zones",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                branch_id: selectedActionBranchId,
                zone_name: zoneName,
                color: "#0ea5e9",
                display_order: zones.length + 1
              })
            },
            "create:zone"
          );
          const zoneResponse = zoneResult.response;
          const zoneBody = zoneResult.body;
          if (!zoneResponse.ok || zoneBody?.error) {
            throw new Error(zoneBody?.error?.message ?? text.errorCreateZone);
          }
          zoneId = zoneBody?.data?.id ?? null;
          createdZone = (zoneBody?.data ?? null) as TableZoneItem | null;
        }
      }

      const tableResult = await fetchJsonWithTiming(
        "/api/backoffice/tables",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            zone_id: zoneId,
            branch_id: selectedActionBranchId,
            table_name: quickCreateForm.table_name.trim() || null,
            capacity: Number(quickCreateForm.capacity || 4),
            status: "available",
            shape: "rectangle",
            position_x: 0,
            position_y: 0,
            width: 96,
            height: 72,
            rotation: 0,
            is_active: true
          })
        },
        "create:table"
      );
      const tableResponse = tableResult.response;
      const tableBody = tableResult.body;
      if (!tableResponse.ok || tableBody?.error) {
        throw new Error(tableBody?.error?.message ?? text.errorCreateTable);
      }
      const createdTable = tableBody?.data as DiningTableItem;

      setQuickCreateForm({
        zone_name: "",
        table_name: "",
        capacity: "4"
      });
      if (createdZone) {
        setZones((current) =>
          [...current, createdZone].sort((left, right) => left.display_order - right.display_order || left.zone_name.localeCompare(right.zone_name))
        );
      }
      setTables((current) => [...current, createdTable]);
      setDraftTables((current) => [...current, createdTable]);
      setSelectedTable(createdTable);
      setSelectedObject(null);
      setTableEditorOpen(false);
      setSuccess(text.tableCreated);
      emitTablePerf({
        event: "action",
        label: "quick-create-table",
        durationMs: performance.now() - startedAt,
        meta: {
          createdZone: Boolean(createdZone)
        }
      });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : text.errorUnknown);
      emitTablePerf({
        event: "action",
        label: "quick-create-table:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: createError instanceof Error ? createError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  async function saveTableFormWithPayload(args: {
    payload: Record<string, unknown>;
    isEdit: boolean;
    tableId: string;
    approvalId?: string;
  }) {
    const { payload, isEdit, tableId, approvalId } = args;
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const finalPayload =
        isEdit && approvalId
          ? {
              ...payload,
              manager_approval_id: approvalId
            }
          : payload;
      const result = await fetchJsonWithTiming(
        isEdit ? buildBranchQuery(`/api/backoffice/tables/${tableId}`, selectedActionBranchId) : "/api/backoffice/tables",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...finalPayload,
            branch_id: selectedActionBranchId
          })
        },
        isEdit ? "update:table" : "create:table-editor"
      );
      const response = result.response;
      const body = result.body;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.errorSaveTable);
      }
      const savedTable = body?.data as DiningTableItem;
      if (isEdit) {
        setTables((current) => current.map((item) => (item.id === savedTable.id ? savedTable : item)));
        setDraftTables((current) => current.map((item) => (item.id === savedTable.id ? savedTable : item)));
      } else {
        setTables((current) => [...current, savedTable]);
        setDraftTables((current) => [...current, savedTable]);
      }
      setSelectedTable(savedTable);
      setSelectedObject(null);
      setTableForm(initialTableForm);
      setTableEditorOpen(false);
      setSuccess(isEdit ? text.tableUpdated : text.tableCreated);
      emitTablePerf({
        event: "action",
        label: isEdit ? "save-table-edit" : "save-table-create",
        durationMs: performance.now() - startedAt
      });
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : text.errorUnknown);
      emitTablePerf({
        event: "action",
        label: "save-table:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: submitError instanceof Error ? submitError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  async function submitTableForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      zone_id: tableForm.zone_id || null,
      table_name: tableForm.table_name.trim() || null,
      capacity: Number(tableForm.capacity),
      status: tableForm.status,
      shape: tableForm.shape,
      position_x: Number(tableForm.position_x),
      position_y: Number(tableForm.position_y),
      width: Number(tableForm.width),
      height: Number(tableForm.height),
      rotation: Number(tableForm.rotation),
      is_active: tableForm.is_active
    };
    const isEdit = Boolean(tableForm.id);
    if (isEdit && requiresManagerPin) {
      setTableApprovalRequest({
        kind: "edit",
        tableId: tableForm.id,
        payload
      });
      return;
    }
    await saveTableFormWithPayload({
      payload,
      isEdit,
      tableId: tableForm.id
    });
  }

  async function deleteTable(table: DiningTableItem, approvalId?: string) {
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    if (requiresManagerPin && !approvalId) {
      setTableApprovalRequest({
        kind: "delete",
        tableId: table.id,
        tableCode: table.table_code
      });
      return;
    }
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const query = `?branch_id=${encodeURIComponent(selectedActionBranchId)}${approvalId ? `&approval_id=${encodeURIComponent(approvalId)}` : ""}`;
      const result = await fetchJsonWithTiming(`/api/backoffice/tables/${table.id}${query}`, { method: "DELETE" }, "delete:table");
      const response = result.response;
      const body = result.body;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? (lang === "th" ? "ลบโต๊ะไม่สำเร็จ" : "Failed to delete table."));
      }

      setTables((current) => current.filter((item) => item.id !== table.id));
      setDraftTables((current) => current.filter((item) => item.id !== table.id));
      setSelectedTable((current) => (current?.id === table.id ? null : current));
      setSuccess(text.tableDeleted(table.table_code));
      emitTablePerf({
        event: "action",
        label: "delete-table",
        durationMs: performance.now() - startedAt
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : lang === "th" ? "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ" : "Unknown error");
      emitTablePerf({
        event: "action",
        label: "delete-table:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: deleteError instanceof Error ? deleteError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  async function addFloorObject(objectType: (typeof floorObjectTypes)[number]) {
    if (saving) return;
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    const defaults = floorObjectDefaults[objectType];
    try {
      const result = await fetchJsonWithTiming(
        "/api/backoffice/table-layout-objects",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch_id: selectedActionBranchId,
            zone_id: activeZoneId === "all" ? null : activeZoneId,
            object_type: objectType,
            object_name: defaults.name,
            color: defaults.color,
            position_x: 24 + draftObjects.length * 8,
            position_y: 24 + draftObjects.length * 6,
            width: defaults.width,
            height: defaults.height,
            rotation: 0,
            z_index: Math.max(1, ...draftObjects.map((item) => item.z_index || 1)) + 1
          })
        },
        "create:floor-object"
      );
      const response = result.response;
      const body = result.body;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.errorAddFloorObject);
      }
      const created = body.data as FloorPlanObjectItem;
      setObjects((current) => [...current, created]);
      setDraftObjects((current) => [...current, created]);
      setSelectedTable(null);
      setSelectedObject(created);
      setViewMode("floor");
      setSuccess(text.objectAdded(created.object_name || getFloorObjectTypeLabel(lang, created.object_type)));
      emitTablePerf({
        event: "action",
        label: "add-floor-object",
        durationMs: performance.now() - startedAt
      });
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : text.errorUnknown);
      emitTablePerf({
        event: "action",
        label: "add-floor-object:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: addError instanceof Error ? addError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedObject() {
    if (!selectedObject) return;
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await fetchJsonWithTiming(
        buildBranchQuery(`/api/backoffice/table-layout-objects/${selectedObject.id}`, selectedActionBranchId),
        { method: "DELETE" },
        "delete:floor-object"
      );
      const response = result.response;
      const body = result.body;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.errorDeleteFloorObject);
      }
      setObjects((current) => current.filter((item) => item.id !== selectedObject.id));
      setDraftObjects((current) => current.filter((item) => item.id !== selectedObject.id));
      setSelectedObject(null);
      setSuccess(text.objectDeleted);
      emitTablePerf({
        event: "action",
        label: "delete-floor-object",
        durationMs: performance.now() - startedAt
      });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : text.errorUnknown);
      emitTablePerf({
        event: "action",
        label: "delete-floor-object:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: deleteError instanceof Error ? deleteError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  function openDeleteConfirmDialog(message: string, onConfirm: () => Promise<void> | void) {
    setConfirmDialog({
      title: text.confirmDeleteTitle,
      message,
      hint: text.confirmDeleteHint,
      confirmLabel: text.delete,
      onConfirm
    });
  }

  async function confirmDeleteAction() {
    if (!confirmDialog) return;
    setConfirming(true);
    try {
      await confirmDialog.onConfirm();
      setConfirmDialog(null);
    } finally {
      setConfirming(false);
    }
  }

  function requestDeleteTable(table: DiningTableItem) {
    openDeleteConfirmDialog(text.deleteTableConfirm(table.table_code), () => deleteTable(table));
  }

  function requestDeleteSelectedObject() {
    if (!selectedObject) return;
    const objectName = selectedObject.object_name || getFloorObjectTypeLabel(lang, selectedObject.object_type);
    openDeleteConfirmDialog(text.deleteObjectConfirm(objectName), () => deleteSelectedObject());
  }

  function updateDraftTablePosition(tableId: string, x: number, y: number) {
    const nextX = Math.max(0, x);
    const nextY = Math.max(0, y);
    setDraftTables((current) => {
      let hasChange = false;
      const next = current.map((table) => {
        if (table.id !== tableId) return table;
        if (table.position_x === nextX && table.position_y === nextY) {
          return table;
        }
        hasChange = true;
        return { ...table, position_x: nextX, position_y: nextY };
      });
      return hasChange ? next : current;
    });
    setSelectedTable((current) => {
      if (!current || current.id !== tableId) {
        return current;
      }
      if (current.position_x === nextX && current.position_y === nextY) {
        return current;
      }
      return { ...current, position_x: nextX, position_y: nextY };
    });
  }

  function updateDraftTableSize(tableId: string, width: number, height: number) {
    const nextWidth = Math.max(40, width);
    const nextHeight = Math.max(40, height);
    setDraftTables((current) => {
      let hasChange = false;
      const next = current.map((table) => {
        if (table.id !== tableId) return table;
        if (table.width === nextWidth && table.height === nextHeight) {
          return table;
        }
        hasChange = true;
        return { ...table, width: nextWidth, height: nextHeight };
      });
      return hasChange ? next : current;
    });
    setSelectedTable((current) => {
      if (!current || current.id !== tableId) {
        return current;
      }
      if (current.width === nextWidth && current.height === nextHeight) {
        return current;
      }
      return { ...current, width: nextWidth, height: nextHeight };
    });
  }

  const patchDraftObject = useCallback((objectId: string, patch: Partial<FloorPlanObjectItem>) => {
    setDraftObjects((current) => {
      let hasChange = false;
      const next = current.map((item) => {
        if (item.id !== objectId) return item;
        const changed = Object.entries(patch).some(([key, value]) => item[key as keyof FloorPlanObjectItem] !== value);
        if (!changed) {
          return item;
        }
        hasChange = true;
        return { ...item, ...patch };
      });
      return hasChange ? next : current;
    });
    setSelectedObject((current) => {
      if (!current || current.id !== objectId) {
        return current;
      }
      const changed = Object.entries(patch).some(([key, value]) => current[key as keyof FloorPlanObjectItem] !== value);
      if (!changed) {
        return current;
      }
      return { ...current, ...patch };
    });
  }, []);

  function bringSelectedObjectForward() {
    if (!selectedObject) return;
    patchDraftObject(selectedObject.id, { z_index: (selectedObject.z_index || 1) + 1 });
  }

  function sendSelectedObjectBackward() {
    if (!selectedObject) return;
    patchDraftObject(selectedObject.id, { z_index: Math.max(1, (selectedObject.z_index || 1) - 1) });
  }

  const handleObjectMove = useCallback(
    (itemId: string, x: number, y: number) => {
      patchDraftObject(itemId, { position_x: Math.max(0, x), position_y: Math.max(0, y) });
    },
    [patchDraftObject]
  );

  const handleObjectResize = useCallback(
    (itemId: string, width: number, height: number) => {
      patchDraftObject(itemId, { width: Math.max(24, width), height: Math.max(24, height) });
    },
    [patchDraftObject]
  );

  async function saveFloorPlan(reset = false) {
    if (saving) return;
    if (!canWriteSelectedBranch) {
      setError(chooseBranchFirstLabel);
      return;
    }
    if (!reset && !isFloorPlanDirty) return;
    if (reset && !canResetFloorPlan) return;
    const startedAt = performance.now();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await fetchJsonWithTiming(
        "/api/backoffice/tables/floor-plan/save",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch_id: selectedActionBranchId,
            reset,
            tables: draftTables.map((table) => ({
              id: table.id,
              zone_id: table.zone_id ?? null,
              position_x: table.position_x,
              position_y: table.position_y,
              width: table.width,
              height: table.height,
              rotation: table.rotation
            })),
            objects: draftObjects.map((item) => ({
              id: item.id,
              zone_id: item.zone_id ?? null,
              object_type: item.object_type,
              object_name: item.object_name,
              color: item.color,
              position_x: item.position_x,
              position_y: item.position_y,
              width: item.width,
              height: item.height,
              rotation: item.rotation,
              z_index: item.z_index,
              is_active: item.is_active,
              metadata: item.metadata ?? {}
            }))
          })
        },
        reset ? "save-layout:reset" : "save-layout"
      );
      const response = result.response;
      const body = result.body;
      if (!response.ok || body?.error) {
        throw new Error(body?.error?.message ?? text.errorSaveLayout);
      }
      if (reset) {
        const resetTables = draftTables.map((table) => ({
          ...table,
          position_x: 0,
          position_y: 0,
          width: 96,
          height: 72,
          rotation: 0
        }));
        const resetObjects = draftObjects.map((item) => ({
          ...item,
          position_x: 24,
          position_y: 24,
          width: 120,
          height: 60,
          rotation: 0
        }));
        setDraftTables(resetTables);
        setTables(resetTables);
        setDraftObjects(resetObjects);
        setObjects(resetObjects);
        setSelectedTable((current) => (current ? resetTables.find((table) => table.id === current.id) ?? null : current));
        setSelectedObject((current) => (current ? resetObjects.find((item) => item.id === current.id) ?? null : current));
      } else {
        setTables(draftTables);
        setObjects(draftObjects);
      }
      setSuccess(reset ? text.layoutReset : text.floorPlanSaved);
      emitTablePerf({
        event: "action",
        label: reset ? "reset-layout" : "save-layout",
        durationMs: performance.now() - startedAt,
        meta: {
          tables: draftTables.length,
          objects: draftObjects.length
        }
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : text.errorUnknown);
      emitTablePerf({
        event: "action",
        label: reset ? "reset-layout:failed" : "save-layout:failed",
        durationMs: performance.now() - startedAt,
        meta: {
          message: saveError instanceof Error ? saveError.message : "Unknown error"
        }
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="table-loading-overlay" role="status" aria-live="polite" aria-busy="true">
        <section className="table-loading-dialog">
          <span className="table-loading-spinner" aria-hidden />
          <p>{text.loading}</p>
        </section>
      </div>
    );
  }
  if (error && tables.length === 0 && zones.length === 0 && objects.length === 0) return <ErrorState message={error} />;

  const listControlsStyle = {
    display: "grid",
    gridTemplateColumns:
      branchOptions.length > 1
        ? "minmax(0,1fr) minmax(150px,220px) minmax(170px,220px) minmax(118px,140px)"
        : "minmax(0,1fr) minmax(170px,220px) minmax(118px,140px)",
    gap: "8px",
    alignItems: "center",
    padding: "6px",
    borderRadius: "10px"
  } as const;

  const listControlFieldStyle = {
    minHeight: "34px",
    height: "34px",
    padding: "0 10px"
  } as const;

  const listCreateButtonStyle = {
    minHeight: "34px",
    height: "34px",
    width: "fit-content",
    minWidth: "118px",
    maxWidth: "140px",
    justifySelf: "end",
    alignSelf: "center",
    padding: "0 14px"
  } as const;

  return (
    <>
      <section className="surface table-mgmt-page">
      <header className="table-mgmt-header">
        <div className="table-mgmt-header__main">
          <h2>{text.title}</h2>
          <p>{text.subtitle}</p>
        </div>
        <div className="table-mgmt-view-switch">
          <button
            type="button"
            className="table-mgmt-view-switch__btn table-mgmt-view-switch__back"
            onClick={navigateBack}
            disabled={saving}
          >
            {lang === "th" ? "< กลับเมนูเพิ่มเติม" : "< Back to More"}
          </button>
          <button
            type="button"
            className={`table-mgmt-view-switch__btn ${viewMode === "sorted" ? "is-active" : ""}`}
            onClick={() => setViewMode("sorted")}
            disabled={saving}
          >
            {"LIST | " + text.tableList}
          </button>
          <button
            type="button"
            className={`table-mgmt-view-switch__btn ${viewMode === "floor" ? "is-active" : ""}`}
            onClick={() => setViewMode("floor")}
            disabled={saving}
          >
            {"BOARD | " + text.floorPlan}
          </button>
        </div>
      </header>

      {error ? <p className="table-mgmt-error">{error}</p> : null}

      <div className={`table-mgmt-layout ${viewMode === "floor" ? "is-floor-view" : "is-list-view"}`}>
        <aside className="table-mgmt-left">
          {viewMode === "floor" ? (
            <section className="table-form-card">
            <h3>{text.addFloorObject}</h3>
            <select value={objectCreateType} onChange={(event) => setObjectCreateType(event.target.value as (typeof floorObjectTypes)[number])}>
              {floorObjectTypes.map((type) => (
                <option key={type} value={type}>
                  {getFloorObjectTypeLabel(lang, type)}
                </option>
              ))}
            </select>
            <div className="table-form-card__actions">
              <button type="button" onClick={() => void addFloorObject("counter")} disabled={saving || !canWriteSelectedBranch}>
                {text.addCounter}
              </button>
              <button type="button" onClick={() => void addFloorObject(objectCreateType)} disabled={saving || !canWriteSelectedBranch}>
                {text.addSelectedObject}
              </button>
            </div>
            </section>
          ) : null}
        </aside>

        <section className="table-mgmt-center">
          {viewMode === "sorted" ? (
            <>
              <div className="table-mgmt-list-controls" style={listControlsStyle}>
                <input
                  value={listSearch}
                  onChange={(event) => setListSearch(event.target.value)}
                  placeholder={text.searchTable}
                  aria-label={text.searchTable}
                  style={listControlFieldStyle}
                />
                {branchOptions.length > 1 ? (
                  <select
                    value={branchFilterId}
                    onChange={(event) => {
                      setBranchFilterId(event.target.value);
                      setActiveZoneId("all");
                      setSelectedTable(null);
                      setSelectedObject(null);
                    }}
                    aria-label={branchSelectLabel}
                    style={listControlFieldStyle}
                  >
                    <option value="all">{allBranchesLabel}</option>
                    {branchOptions.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code ? `${branch.name} (${branch.code})` : branch.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  value={listSortMode}
                  onChange={(event) => setListSortMode(event.target.value as "natural" | "capacity_desc" | "status")}
                  style={listControlFieldStyle}
                >
                  <option value="natural">{text.sortNatural}</option>
                  <option value="capacity_desc">{text.sortCapacity}</option>
                  <option value="status">{text.sortStatus}</option>
                </select>
                <button
                  type="button"
                  className="table-list-create-btn"
                  onClick={openCreateTableEditor}
                  style={listCreateButtonStyle}
                  disabled={saving || !canWriteSelectedBranch}
                  title={!canWriteSelectedBranch ? chooseBranchFirstLabel : text.addTable}
                >
                  + {text.addTable}
                </button>
              </div>
              <TableListGrid
                tables={filteredTables}
                zones={zones}
                selectedTableId={selectedTable?.id}
                onSelect={(table) => setSelectedTable(table)}
                onEdit={canWriteSelectedBranch ? openEditTableEditor : undefined}
                onDelete={canWriteSelectedBranch ? requestDeleteTable : undefined}
                readOnly={!canWriteSelectedBranch}
                sortMode={listSortMode}
                lang={lang}
              />
            </>
          ) : (
            <>
              <FloorPlanToolbar
                zoom={zoom}
                canEdit={canWriteSelectedBranch}
                saving={saving}
                canSaveLayout={canWriteSelectedBranch && isFloorPlanDirty}
                canResetLayout={canWriteSelectedBranch && canResetFloorPlan}
                dirty={isFloorPlanDirty}
                lang={lang}
                onZoomIn={() => setZoom((value) => Math.min(2.5, value + 0.1))}
                onZoomOut={() => setZoom((value) => Math.max(0.4, value - 0.1))}
                onResetViewport={() => {
                  setZoom(1);
                  setPan({ x: 0, y: 0 });
                }}
                onAddCounter={() => void addFloorObject("counter")}
                onAddObject={() => void addFloorObject(objectCreateType)}
                onSaveLayout={() => void saveFloorPlan(false)}
                onResetLayout={() => void saveFloorPlan(true)}
              />
              <FloorPlanCanvas
                tables={visibleDraftTables}
                objects={visibleDraftObjects}
                zones={zones}
                lang={lang}
                selectedTableId={selectedTable?.id}
                selectedObjectId={selectedObject?.id}
                editable={canWriteSelectedBranch}
                zoom={zoom}
                pan={pan}
                onPanChange={setPan}
                onSelect={selectTableForEdit}
                onSelectObject={selectObjectForEdit}
                onTableMove={updateDraftTablePosition}
                onTableResize={updateDraftTableSize}
                onObjectMove={handleObjectMove}
                onObjectResize={handleObjectResize}
              />
            </>
          )}
        </section>

        <aside className="table-mgmt-right">
          <h3>{text.selectedItem}</h3>
          {selectedObject ? (
            <div className="table-form-card table-form-card--transparent">
              <p>
                <strong>{selectedObject.object_name || getFloorObjectTypeLabel(lang, selectedObject.object_type)}</strong>
              </p>
              <select
                value={selectedObject.object_type}
                onChange={(event) => patchDraftObject(selectedObject.id, { object_type: event.target.value as FloorPlanObjectItem["object_type"] })}
              >
                {floorObjectTypes.map((type) => (
                  <option key={type} value={type}>
                    {getFloorObjectTypeLabel(lang, type)}
                  </option>
                ))}
              </select>
              <input
                value={selectedObject.object_name ?? ""}
                onChange={(event) => patchDraftObject(selectedObject.id, { object_name: event.target.value })}
                placeholder={text.objectName}
              />
              <select value={selectedObject.zone_id ?? ""} onChange={(event) => patchDraftObject(selectedObject.id, { zone_id: event.target.value || null })}>
                <option value="">{text.unassigned}</option>
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.zone_name}
                  </option>
                ))}
              </select>
              <input
                type="color"
                value={selectedObject.color}
                onChange={(event) => patchDraftObject(selectedObject.id, { color: event.target.value })}
              />
              <div className="table-form-grid">
                <input
                  type="number"
                  value={selectedObject.position_x}
                  onChange={(event) => patchDraftObject(selectedObject.id, { position_x: Math.max(0, toNumber(event.target.value, selectedObject.position_x)) })}
                  placeholder="X"
                />
                <input
                  type="number"
                  value={selectedObject.position_y}
                  onChange={(event) => patchDraftObject(selectedObject.id, { position_y: Math.max(0, toNumber(event.target.value, selectedObject.position_y)) })}
                  placeholder="Y"
                />
                <input
                  type="number"
                  value={selectedObject.width}
                  onChange={(event) => patchDraftObject(selectedObject.id, { width: Math.max(24, toNumber(event.target.value, selectedObject.width)) })}
                  placeholder="Width"
                />
                <input
                  type="number"
                  value={selectedObject.height}
                  onChange={(event) => patchDraftObject(selectedObject.id, { height: Math.max(24, toNumber(event.target.value, selectedObject.height)) })}
                  placeholder="Height"
                />
                <input
                  type="number"
                  value={selectedObject.rotation}
                  onChange={(event) => patchDraftObject(selectedObject.id, { rotation: toNumber(event.target.value, selectedObject.rotation) })}
                  placeholder="Rotation"
                />
                <input
                  type="number"
                  value={selectedObject.z_index}
                  onChange={(event) =>
                    patchDraftObject(selectedObject.id, { z_index: Math.max(1, Math.trunc(toNumber(event.target.value, selectedObject.z_index))) })
                  }
                  placeholder={text.layer}
                />
              </div>
              <div className="table-form-card__actions">
                <button type="button" onClick={sendSelectedObjectBackward}>
                  {text.sendBack}
                </button>
                <button type="button" onClick={bringSelectedObjectForward}>
                  {text.bringFront}
                </button>
                <button type="button" onClick={requestDeleteSelectedObject} className="is-danger">
                  {text.deleteObject}
                </button>
              </div>
            </div>
          ) : selectedTable ? (
            <>
              <p>
                <strong>{selectedTable.table_code}</strong> {selectedTable.table_name ? `(${selectedTable.table_name})` : ""}
              </p>
              <p>
                {text.status}: {getTableStatusLabel(lang, selectedTable.status)}
              </p>
              <p>
                {text.shape}: {getTableShapeLabel(lang, selectedTable.shape)}
              </p>
              <p>
                {text.capacity}: {selectedTable.capacity}
              </p>
              <p>
                {text.position}: {Math.round(Number(selectedTable.position_x))}, {Math.round(Number(selectedTable.position_y))}
              </p>
              <p>
                {text.size}: {Math.round(Number(selectedTable.width))} x {Math.round(Number(selectedTable.height))}
              </p>
            </>
          ) : (
            <p>{text.selectHint}</p>
          )}
        </aside>
      </div>
      </section>
      {tableEditorOpen ? (
        <div className="table-editor-overlay" role="presentation" onClick={() => (!saving ? setTableEditorOpen(false) : null)}>
          <section className="table-editor-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <header className="table-editor-dialog__head">
              <h3>{tableEditorMode === "edit" ? text.editTable : text.addTable}</h3>
              <button type="button" onClick={() => setTableEditorOpen(false)} disabled={saving}>
                {text.close}
              </button>
            </header>
            {tableEditorMode === "create" ? (
              <form onSubmit={submitQuickCreateForm} className="table-editor-dialog__form">
                <input
                  value={quickCreateForm.zone_name}
                  onChange={(event) => setQuickCreateForm((current) => ({ ...current, zone_name: event.target.value }))}
                  placeholder={text.zoneName}
                />
                <input value={text.autoTableCode(nextAutoTableCode)} placeholder={text.tableCode} disabled aria-label={text.tableCode} />
                <input
                  value={quickCreateForm.table_name}
                  onChange={(event) => setQuickCreateForm((current) => ({ ...current, table_name: event.target.value }))}
                  placeholder={text.tableName}
                />
                <input
                  type="number"
                  min={1}
                  value={quickCreateForm.capacity}
                  onChange={(event) => setQuickCreateForm((current) => ({ ...current, capacity: event.target.value }))}
                  placeholder={text.capacity}
                  required
                />
                <div className="table-editor-dialog__actions">
                  <button type="submit" disabled={saving} className="is-primary">
                    {saving ? text.saving : text.addTable}
                  </button>
                  <button type="button" onClick={() => setTableEditorOpen(false)} disabled={saving}>
                    {text.cancel}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={submitTableForm} className="table-editor-dialog__form">
                <input
                  value={tableForm.table_code}
                  placeholder={text.tableCode}
                  disabled
                  aria-label={text.tableCode}
                />
                <input
                  value={tableForm.table_name}
                  onChange={(event) => setTableForm((current) => ({ ...current, table_name: event.target.value }))}
                  placeholder={text.tableName}
                />
                <select value={tableForm.zone_id} onChange={(event) => setTableForm((current) => ({ ...current, zone_id: event.target.value }))}>
                  <option value="">{text.unassigned}</option>
                  {zones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {zone.zone_name}
                    </option>
                  ))}
                </select>
                <div className="table-form-grid">
                  <input
                    type="number"
                    value={tableForm.capacity}
                    onChange={(event) => setTableForm((current) => ({ ...current, capacity: event.target.value }))}
                    placeholder={text.capacity}
                  />
                  <select value={tableForm.status} onChange={(event) => setTableForm((current) => ({ ...current, status: event.target.value }))}>
                    {tableStatuses.map((status) => (
                      <option key={status} value={status}>
                        {getTableStatusLabel(lang, status)}
                      </option>
                    ))}
                  </select>
                  <select value={tableForm.shape} onChange={(event) => setTableForm((current) => ({ ...current, shape: event.target.value }))}>
                    {tableShapes.map((shape) => (
                      <option key={shape} value={shape}>
                        {getTableShapeLabel(lang, shape)}
                      </option>
                    ))}
                  </select>
                  <label>
                    <input
                      type="checkbox"
                      checked={tableForm.is_active}
                      onChange={(event) => setTableForm((current) => ({ ...current, is_active: event.target.checked }))}
                    />
                    {text.active}
                  </label>
                </div>
                <div className="table-form-grid">
                  <input
                    type="number"
                    value={tableForm.position_x}
                    onChange={(event) => setTableForm((current) => ({ ...current, position_x: event.target.value }))}
                    placeholder="X"
                  />
                  <input
                    type="number"
                    value={tableForm.position_y}
                    onChange={(event) => setTableForm((current) => ({ ...current, position_y: event.target.value }))}
                    placeholder="Y"
                  />
                  <input
                    type="number"
                    value={tableForm.width}
                    onChange={(event) => setTableForm((current) => ({ ...current, width: event.target.value }))}
                    placeholder={text.width}
                  />
                  <input
                    type="number"
                    value={tableForm.height}
                    onChange={(event) => setTableForm((current) => ({ ...current, height: event.target.value }))}
                    placeholder={text.height}
                  />
                  <input
                    type="number"
                    value={tableForm.rotation}
                    onChange={(event) => setTableForm((current) => ({ ...current, rotation: event.target.value }))}
                    placeholder={text.rotation}
                  />
                </div>
                <div className="table-editor-dialog__actions">
                  <button type="submit" disabled={saving} className="is-primary">
                    {saving ? text.saving : text.updateTable}
                  </button>
                  <button type="button" onClick={() => setTableEditorOpen(false)} disabled={saving}>
                    {text.cancel}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      ) : null}
      {confirmDialog ? (
        <div className="table-confirm-overlay" role="presentation" onClick={() => (!confirming ? setConfirmDialog(null) : null)}>
          <section
            className="table-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="table-confirm-title"
            aria-describedby="table-confirm-message"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="table-confirm-dialog__icon" aria-hidden>
              !
            </div>
            <h3 id="table-confirm-title">{confirmDialog.title}</h3>
            <p id="table-confirm-message">{confirmDialog.message}</p>
            {confirmDialog.hint ? <p className="table-confirm-dialog__hint">{confirmDialog.hint}</p> : null}
            <div className="table-confirm-dialog__actions">
              <button type="button" onClick={() => setConfirmDialog(null)} disabled={confirming}>
                {text.cancel}
              </button>
              <button type="button" className="is-danger" onClick={() => void confirmDeleteAction()} disabled={confirming}>
                {confirming ? text.saving : confirmDialog.confirmLabel}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {tableApprovalRequest ? (
        <PosManagerApprovalModal
          open
          lang={lang}
          title={lang === "th" ? "ยืนยัน PIN ก่อนแก้ไข/ลบโต๊ะ" : "PIN approval required for table edit/delete"}
          action="table_move_bill"
          targetTable="dining_tables"
          targetId={tableApprovalRequest.tableId}
          onClose={() => setTableApprovalRequest(null)}
          onApproved={(approvalId) => {
            const request = tableApprovalRequest;
            setTableApprovalRequest(null);
            if (request.kind === "edit") {
              void saveTableFormWithPayload({
                payload: request.payload,
                isEdit: true,
                tableId: request.tableId,
                approvalId
              });
              return;
            }
            const targetTable = tables.find((item) => item.id === request.tableId);
            if (!targetTable) return;
            void deleteTable(targetTable, approvalId);
          }}
        />
      ) : null}
    </>
  );
}
