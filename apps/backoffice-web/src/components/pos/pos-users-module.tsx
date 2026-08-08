"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { fetchWithTimeout } from "@/lib/client-fetch";

type BranchRole = "owner" | "manager" | "staff" | "accountant";
type ScopeMode = "all_devices" | "single_device";
type Lang = "th" | "en";
type AlertDialogState = {
  tone: "success" | "error";
  title: string;
  message: string;
};

type Branch = {
  id: string;
  code: string;
  name: string;
};

type Device = {
  id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  status: string;
};

type PosUser = {
  user_id: string;
  branch_id: string;
  branch_name: string;
  branch_code: string;
  role: BranchRole;
  permission_role: string;
  position_title: string;
  employee_code: string;
  full_name: string;
  email: string;
  is_active: boolean;
  can_approve_cancel_bill: boolean;
  can_edit: boolean;
  can_delete: boolean;
  device_scope: {
    scope_mode: ScopeMode;
    device_id: string | null;
  };
};

type UsersResponse = {
  items: PosUser[];
  branches: Branch[];
  devices: Device[];
  metadata: {
    role: BranchRole;
    user_id: string;
    branch_id: string;
    can_add: boolean;
    can_delete: boolean;
  };
};

type FormState = {
  user_id: string | null;
  branch_id: string;
  full_name: string;
  email: string;
  employee_code: string;
  position_title: string;
  permission_role: string;
  role: BranchRole;
  is_active: boolean;
  scope_mode: ScopeMode;
  device_id: string;
  pin: string;
  approval_pin: string;
  can_approve_cancel_bill: boolean;
  initial_can_approve_cancel_bill: boolean;
};

const roleOptions: BranchRole[] = ["owner", "manager", "staff", "accountant"];
const USER_ROWS_PER_PAGE = 10;

const copy = {
  th: {
    title: "ผู้ใช้งาน POS",
    subtitle: "",
    refresh: "รีเฟรช",
    filter: "คัดกรอง",
    filterTitle: "คัดกรองผู้ใช้งาน",
    previousPage: "ก่อนหน้า",
    nextPage: "หน้าถัดไป",
    add: "เพิ่มผู้ใช้งาน",
    search: "ค้นหาชื่อ อีเมล หรือรหัสพนักงาน",
    allBranches: "ทุกสาขา",
    allRoles: "ทุกบทบาท",
    allStatus: "ทุกสถานะ",
    activeOnly: "เปิดใช้งาน",
    inactiveOnly: "ปิดใช้งาน",
    total: "ผู้ใช้งานทั้งหมด",
    active: "เปิดใช้งาน",
    managers: "ผู้จัดการ",
    staff: "พนักงาน",
    employeeCode: "รหัสพนักงาน",
    employeeCodeHint: "แก้ไขรหัสพนักงานได้ โดยต้องใช้ PIN ยืนยันเมื่อมีการเปลี่ยนรหัส",
    name: "ชื่อ",
    position: "ตำแหน่ง",
    permissionRole: "บทบาทสิทธิ์",
    branch: "สาขา",
    role: "บทบาท",
    status: "สถานะ",
    deviceScope: "ขอบเขตเครื่อง",
    actions: "จัดการ",
    edit: "แก้ไข",
    delete: "ลบ",
    save: "บันทึก",
    cancel: "ยกเลิก",
    close: "ปิด",
    pin: "PIN ผู้ใช้งาน",
    approvalPin: "PIN ยืนยัน",
    pinHint: "กรอกเมื่อต้องการตั้ง/เปลี่ยน PIN",
    approvalPinHint: "PIN เจ้าของร้านหรือผู้จัดการสำหรับยืนยันรหัส",
    cancelBillApproval: "สิทธิ์ PIN ยกเลิกบิล",
    cancelBillApprovalEnabled: "อนุญาตให้พนักงานใช้ PIN ยืนยันการยกเลิกบิล",
    cancelBillApprovalDisabled: "ไม่ได้รับสิทธิ์ยืนยันการยกเลิกบิล",
    cancelBillApprovalOwnerOnly: "เฉพาะเจ้าของร้านเท่านั้นที่เปิดหรือปิดสิทธิ์นี้ได้",
    staffPinHint: "กำหนด PIN 4-12 หลักสำหรับยืนยันการยกเลิกบิล",
    staffPinRequired: "กรุณากำหนด PIN พนักงาน 4-12 หลักเมื่อเปิดสิทธิ์ยกเลิกบิล",
    email: "อีเมล",
    fullName: "ชื่อผู้ใช้งาน",
    allDevices: "ทุกเครื่องในสาขา",
    specificDevice: "ระบุเครื่อง",
    chooseDevice: "เลือกเครื่อง",
    empty: "ยังไม่พบผู้ใช้งานตามเงื่อนไข",
    confirmDelete: "ยืนยันลบสิทธิ์ผู้ใช้งานนี้ออกจากสาขา?",
    addTitle: "เพิ่มผู้ใช้งาน",
    editTitle: "แก้ไขผู้ใช้งาน",
    saved: "บันทึกข้อมูลเรียบร้อย",
    deleted: "ลบผู้ใช้งานเรียบร้อย",
    loadError: "โหลดข้อมูลผู้ใช้งานไม่สำเร็จ",
    saveError: "บันทึกข้อมูลไม่สำเร็จ",
    savingTitle: "กำลังบันทึกข้อมูล",
    savingMessage: "กรุณารอสักครู่ ระบบกำลังตรวจสอบและบันทึกข้อมูลผู้ใช้งาน",
    saveSuccessTitle: "บันทึกสำเร็จ",
    saveErrorTitle: "บันทึกไม่สำเร็จ",
    acknowledge: "ตกลง",
    employeeCodeDuplicate: "รหัสพนักงานนี้ถูกใช้งานแล้ว กรุณากำหนดรหัสใหม่ที่ไม่ซ้ำกับผู้ใช้งานคนอื่น",
    deleteError: "ลบผู้ใช้งานไม่สำเร็จ",
    accessOwner: "",
    accessManager: "ผู้จัดการ: เห็นทุกสาขา เพิ่มผู้ใช้ได้ แก้ไขพนักงานได้ และลบไม่ได้",
  },
  en: {
    title: "POS users",
    subtitle: "",
    refresh: "Refresh",
    filter: "Filter",
    filterTitle: "Filter users",
    previousPage: "Previous",
    nextPage: "Next",
    add: "Add user",
    search: "Search name, email, or employee code",
    allBranches: "All branches",
    allRoles: "All roles",
    allStatus: "All status",
    activeOnly: "Active",
    inactiveOnly: "Inactive",
    total: "Total users",
    active: "Active",
    managers: "Managers",
    staff: "Staff",
    employeeCode: "Employee code",
    employeeCodeHint: "You can change the employee code. An approval PIN is required when the code changes.",
    name: "Name",
    position: "Position",
    permissionRole: "Permission role",
    branch: "Branch",
    role: "Role",
    status: "Status",
    deviceScope: "Device scope",
    actions: "Actions",
    edit: "Edit",
    delete: "Delete",
    save: "Save",
    cancel: "Cancel",
    close: "Close",
    pin: "User PIN",
    approvalPin: "Approval PIN",
    pinHint: "Fill only when setting/changing PIN",
    approvalPinHint: "Owner or manager PIN for code confirmation",
    cancelBillApproval: "Cancel-bill PIN authority",
    cancelBillApprovalEnabled: "Allow this staff member to approve bill cancellation with a PIN",
    cancelBillApprovalDisabled: "No bill-cancellation approval authority",
    cancelBillApprovalOwnerOnly: "Only the store owner can enable or disable this authority",
    staffPinHint: "Set a 4-12 digit PIN for bill-cancellation approval",
    staffPinRequired: "Enter a 4-12 digit staff PIN when enabling bill-cancellation approval.",
    email: "Email",
    fullName: "Full name",
    allDevices: "All branch devices",
    specificDevice: "Specific device",
    chooseDevice: "Choose device",
    empty: "No users match the current filters.",
    confirmDelete: "Remove this user's access from the branch?",
    addTitle: "Add user",
    editTitle: "Edit user",
    saved: "User saved.",
    deleted: "User removed.",
    loadError: "Could not load users.",
    saveError: "Could not save user.",
    savingTitle: "Saving user",
    savingMessage: "Please wait while the user information is validated and saved.",
    saveSuccessTitle: "Saved successfully",
    saveErrorTitle: "Save failed",
    acknowledge: "OK",
    employeeCodeDuplicate: "This employee code is already in use. Enter a unique employee code.",
    deleteError: "Could not delete user.",
    accessOwner: "",
    accessManager: "Manager: all branches, can add and edit staff, cannot delete.",
  },
} satisfies Record<Lang, Record<string, string>>;

const roleLabels: Record<Lang, Record<BranchRole, string>> = {
  th: {
    owner: "เจ้าของร้าน",
    manager: "ผู้จัดการ",
    staff: "พนักงาน",
    accountant: "บัญชี",
  },
  en: {
    owner: "Owner",
    manager: "Manager",
    staff: "Staff",
    accountant: "Accountant",
  },
};

const roleTone: Record<BranchRole, string> = {
  owner: "border-blue-200 bg-blue-50 text-blue-700",
  manager: "border-emerald-200 bg-emerald-50 text-emerald-700",
  staff: "border-slate-200 bg-slate-50 text-slate-700",
  accountant: "border-violet-200 bg-violet-50 text-violet-700",
};

function buildEmptyForm(defaultBranchId: string): FormState {
  return {
    user_id: null,
    branch_id: defaultBranchId,
    full_name: "",
    email: "",
    employee_code: "",
    position_title: "",
    permission_role: "pos_user",
    role: "staff",
    is_active: true,
    scope_mode: "all_devices",
    device_id: "",
    pin: "",
    approval_pin: "",
    can_approve_cancel_bill: false,
    initial_can_approve_cancel_bill: false,
  };
}

function normalizeEmployeeCodeInput(value: string) {
  return String(value ?? "").replace(/\D/g, "").slice(0, 32);
}

export function PosUsersModule({ lang, embedded = false, onBack }: { lang: Lang; embedded?: boolean; onBack?: () => void }) {
  const t = copy[lang];
  const [items, setItems] = useState<PosUser[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [metadata, setMetadata] = useState<UsersResponse["metadata"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState<"all" | BranchRole>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [form, setForm] = useState<FormState | null>(null);
  const [alertDialog, setAlertDialog] = useState<AlertDialogState | null>(null);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const currentRole = metadata?.role ?? "staff";
  const canAdd = Boolean(metadata?.can_add);
  const canDelete = Boolean(metadata?.can_delete);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (branchFilter !== "all") params.set("branch_id", branchFilter);
      const response = await fetchWithTimeout(`/api/pos/users?${params.toString()}`, { cache: "no-store" }, 10000);
      const payload = (await response.json()) as { data?: UsersResponse; error?: { message?: string } };
      if (!response.ok || !payload.data) throw new Error(payload.error?.message || t.loadError);
      setItems(payload.data.items ?? []);
      setBranches(payload.data.branches ?? []);
      setDevices(payload.data.devices ?? []);
      setMetadata(payload.data.metadata ?? null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.loadError);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, t.loadError]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const stats = useMemo(
    () => ({
      total: items.length,
      active: items.filter((item) => item.is_active).length,
      managers: items.filter((item) => item.role === "manager").length,
      staff: items.filter((item) => item.role === "staff").length,
    }),
    [items]
  );

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !normalized ||
        item.full_name.toLowerCase().includes(normalized) ||
        item.email.toLowerCase().includes(normalized) ||
        item.employee_code.toLowerCase().includes(normalized);
      const matchesRole = roleFilter === "all" || item.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "active" && item.is_active) ||
        (statusFilter === "inactive" && !item.is_active);
      return matchesQuery && matchesRole && matchesStatus;
    });
  }, [items, query, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / USER_ROWS_PER_PAGE));
  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * USER_ROWS_PER_PAGE;
    return filteredItems.slice(startIndex, startIndex + USER_ROWS_PER_PAGE);
  }, [currentPage, filteredItems]);
  const pageStart = filteredItems.length ? (currentPage - 1) * USER_ROWS_PER_PAGE + 1 : 0;
  const pageEnd = Math.min(currentPage * USER_ROWS_PER_PAGE, filteredItems.length);

  useEffect(() => {
    setCurrentPage(1);
  }, [query, branchFilter, roleFilter, statusFilter]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const branchDevices = useMemo(() => {
    if (!form) return [];
    return devices.filter((device) => device.branch_id === form.branch_id);
  }, [devices, form]);

  const deviceById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices]);

  function openAdd() {
    setForm(buildEmptyForm(branchFilter !== "all" ? branchFilter : branches[0]?.id ?? metadata?.branch_id ?? ""));
    setNotice("");
    setError("");
  }

  function openEdit(item: PosUser) {
    setForm({
      user_id: item.user_id,
      branch_id: item.branch_id,
      full_name: item.full_name,
      email: item.email,
      employee_code: item.employee_code,
      position_title: item.position_title,
      permission_role: item.permission_role,
      role: item.role,
      is_active: item.is_active,
      scope_mode: item.device_scope.scope_mode,
      device_id: item.device_scope.device_id ?? "",
      pin: "",
      approval_pin: "",
      can_approve_cancel_bill: item.can_approve_cancel_bill,
      initial_can_approve_cancel_bill: item.can_approve_cancel_bill,
    });
    setNotice("");
    setError("");
  }

  async function requestJson(url: string, init: RequestInit) {
    const response = await fetchWithTimeout(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    }, 15000);
    const payload = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    if (!response.ok) {
      const message = payload.error?.code === "employee_code_duplicate" ? t.employeeCodeDuplicate : payload.error?.message || t.saveError;
      throw new Error(message);
    }
  }

  async function saveForm() {
    if (!form) return;
    const employeeCode = normalizeEmployeeCodeInput(form.employee_code);
    if (!employeeCode) {
      setAlertDialog({
        tone: "error",
        title: t.saveErrorTitle,
        message: lang === "en" ? "Employee code must contain numbers only." : "รหัสพนักงานต้องเป็นตัวเลขเท่านั้น",
      });
      return;
    }
    const duplicateEmployee = items.find(
      (item) => item.user_id !== form.user_id && normalizeEmployeeCodeInput(item.employee_code) === employeeCode
    );
    if (duplicateEmployee) {
      setAlertDialog({ tone: "error", title: t.saveErrorTitle, message: t.employeeCodeDuplicate });
      return;
    }
    const staffApprovalChanged =
      form.role === "staff" &&
      (form.can_approve_cancel_bill !== form.initial_can_approve_cancel_bill || Boolean(form.pin.trim()));
    if (
      form.role === "staff" &&
      form.can_approve_cancel_bill &&
      (!form.user_id || staffApprovalChanged) &&
      !/^\d{4,12}$/.test(form.pin.trim())
    ) {
      setAlertDialog({ tone: "error", title: t.saveErrorTitle, message: t.staffPinRequired });
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    setAlertDialog(null);
    try {
      if (!form.user_id) {
        await requestJson("/api/pos/users", {
          method: "POST",
          body: JSON.stringify({
            branch_id: form.branch_id,
            full_name: form.full_name.trim(),
            email: form.email.trim().toLowerCase(),
            employee_code: employeeCode,
            position_title: form.position_title.trim(),
            permission_role: form.permission_role.trim(),
            role: form.role,
            pin: form.pin.trim(),
            approval_pin: form.approval_pin.trim(),
            can_approve_cancel_bill: form.can_approve_cancel_bill,
            is_active: form.is_active,
            scope_mode: form.scope_mode,
            device_id: form.scope_mode === "single_device" ? form.device_id : null,
          }),
        });
      } else {
        await requestJson("/api/pos/users", {
          method: "PATCH",
          body: JSON.stringify({
            action: "update_profile",
            user_id: form.user_id,
            branch_id: form.branch_id,
            full_name: form.full_name.trim(),
            email: form.email.trim().toLowerCase(),
            employee_code: employeeCode,
            position_title: form.position_title.trim(),
            permission_role: form.permission_role.trim(),
            role: form.role,
            approval_pin: form.approval_pin.trim(),
          }),
        });
        await requestJson("/api/pos/users", {
          method: "PATCH",
          body: JSON.stringify({ action: "set_active", user_id: form.user_id, branch_id: form.branch_id, is_active: form.is_active }),
        });
        await requestJson("/api/pos/users", {
          method: "PATCH",
          body: JSON.stringify({
            action: "set_device_scope",
            user_id: form.user_id,
            branch_id: form.branch_id,
            scope_mode: form.scope_mode,
            device_id: form.scope_mode === "single_device" ? form.device_id : null,
          }),
        });
        const shouldConfigureStaffCancelApproval = currentRole === "owner" && form.role === "staff" && staffApprovalChanged;
        if (shouldConfigureStaffCancelApproval) {
          await requestJson("/api/pos/users", {
            method: "PATCH",
            body: JSON.stringify({
              action: "set_cancel_bill_approval",
              user_id: form.user_id,
              branch_id: form.branch_id,
              is_enabled: form.can_approve_cancel_bill,
              pin: form.pin.trim(),
              approval_pin: form.approval_pin.trim(),
            }),
          });
        } else if (form.role !== "staff" && form.pin.trim()) {
          await requestJson("/api/pos/users", {
            method: "PATCH",
            body: JSON.stringify({
              action: "set_pin",
              user_id: form.user_id,
              branch_id: form.branch_id,
              pin: form.pin.trim(),
              approval_pin: form.approval_pin.trim(),
            }),
          });
        }
      }
      setForm(null);
      await loadUsers();
      setAlertDialog({
        tone: "success",
        title: t.saveSuccessTitle,
        message: t.saved,
      });
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : t.saveError;
      setError(message);
      setAlertDialog({
        tone: "error",
        title: t.saveErrorTitle,
        message,
      });
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(item: PosUser) {
    if (!window.confirm(t.confirmDelete)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await requestJson(`/api/pos/users?user_id=${encodeURIComponent(item.user_id)}&branch_id=${encodeURIComponent(item.branch_id)}`, {
        method: "DELETE",
      });
      setNotice(t.deleted);
      await loadUsers();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : t.deleteError);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={embedded ? "space-y-5 text-slate-950" : "min-h-screen bg-slate-50 px-5 py-6 text-slate-950 lg:px-8"}>
      <div className={embedded ? "space-y-5" : "mx-auto max-w-[1440px] space-y-5"}>
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-blue-600">CpIPOS</p>
            <h1 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">{t.title}</h1>
            {t.subtitle ? <p className="mt-2 max-w-3xl text-sm text-slate-600">{t.subtitle}</p> : null}
            {currentRole !== "owner" ? <p className="mt-2 text-xs font-semibold text-slate-500">{t.accessManager}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700"
              >
                {lang === "en" ? "Back" : "ย้อนกลับ"}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setIsFilterOpen(true)}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700"
            >
              {t.filter}
            </button>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:border-blue-200 hover:text-blue-700 disabled:opacity-60"
              disabled={loading}
            >
              {t.refresh}
            </button>
            {canAdd ? (
              <button type="button" onClick={openAdd} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
                + {t.add}
              </button>
            ) : null}
          </div>
        </header>

        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label={t.total} value={stats.total} />
          <StatCard label={t.active} value={stats.active} />
          <StatCard label={t.managers} value={stats.managers} />
          <StatCard label={t.staff} value={stats.staff} />
        </div>

        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          {error ? <div className="mx-4 mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
          {notice ? <div className="mx-4 mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">{notice}</div> : null}

          <div className="overflow-x-auto">
            <table className="min-w-[1380px] text-left text-sm">
              <thead className="bg-slate-100 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">{t.employeeCode}</th>
                  <th className="px-4 py-3">{t.name}</th>
                  <th className="px-4 py-3">{t.position}</th>
                  <th className="px-4 py-3">{t.permissionRole}</th>
                  <th className="px-4 py-3">{t.branch}</th>
                  <th className="px-4 py-3">{t.chooseDevice}</th>
                  <th className="px-4 py-3">{t.role}</th>
                  <th className="px-4 py-3">{t.cancelBillApproval}</th>
                  <th className="px-4 py-3">{t.status}</th>
                  <th className="px-4 py-3 text-right">{t.actions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  <tr>
                    <td className="px-4 py-10 text-center text-slate-500" colSpan={10}>
                      Loading...
                    </td>
                  </tr>
                ) : filteredItems.length ? (
                  paginatedItems.map((item) => (
                    <tr key={`${item.branch_id}:${item.user_id}`} className="bg-white hover:bg-slate-50">
                      <td className="px-4 py-4 font-bold text-slate-900">{item.employee_code}</td>
                      <td className="px-4 py-4">
                        <div className="font-bold text-slate-950">{item.full_name}</div>
                        <div className="text-xs text-slate-500">{item.email}</div>
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-700">{item.position_title || "-"}</td>
                      <td className="px-4 py-4 font-semibold text-slate-700">{item.permission_role}</td>
                      <td className="px-4 py-4">
                        <div className="font-semibold text-slate-900">{item.branch_name}</div>
                        <div className="text-xs text-slate-500">{item.branch_code}</div>
                      </td>
                      <td className="px-4 py-4 font-semibold text-slate-700">
                        {item.device_scope.scope_mode === "all_devices"
                          ? t.allDevices
                          : deviceById.get(item.device_scope.device_id ?? "")?.device_name ||
                            deviceById.get(item.device_scope.device_id ?? "")?.device_code ||
                            "-"}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${roleTone[item.role]}`}>
                          {roleLabels[lang][item.role]}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        {item.role === "staff" ? (
                          <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.can_approve_cancel_bill ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                            {item.can_approve_cancel_bill ? t.activeOnly : t.inactiveOnly}
                          </span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${item.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                          {item.is_active ? t.activeOnly : t.inactiveOnly}
                        </span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex justify-end gap-2">
                          {item.can_edit ? (
                            <button type="button" onClick={() => openEdit(item)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100">
                              {t.edit}
                            </button>
                          ) : null}
                          {canDelete && item.can_delete ? (
                            <button type="button" onClick={() => void deleteUser(item)} disabled={saving} className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-100 disabled:opacity-60">
                              {t.delete}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-12 text-center text-slate-500" colSpan={10}>
                      {t.empty}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {!loading && filteredItems.length > USER_ROWS_PER_PAGE ? (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">
              <span>
                {lang === "en"
                  ? `Showing ${pageStart}-${pageEnd} of ${filteredItems.length} users`
                  : `แสดง ${pageStart}-${pageEnd} จาก ${filteredItems.length} รายการ`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.previousPage}
                </button>
                <span className="min-w-20 text-center text-slate-700">
                  {lang === "en" ? `Page ${currentPage} / ${totalPages}` : `หน้า ${currentPage} / ${totalPages}`}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-blue-200 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.nextPage}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {isFilterOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6" onClick={() => setIsFilterOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="pos-users-filter-title"
            className="w-full max-w-3xl rounded-lg border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <h2 id="pos-users-filter-title" className="text-lg font-bold text-slate-950">{t.filterTitle}</h2>
              <button type="button" onClick={() => setIsFilterOpen(false)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {t.close}
              </button>
            </div>
            <div className="grid gap-3 p-5 md:grid-cols-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.search}
                className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 md:col-span-2"
              />
              <select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                <option value="all">{t.allBranches}</option>
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} {branch.code ? `(${branch.code})` : ""}
                  </option>
                ))}
              </select>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | BranchRole)} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                <option value="all">{t.allRoles}</option>
                {roleOptions.map((role) => (
                  <option key={role} value={role}>
                    {roleLabels[lang][role]}
                  </option>
                ))}
              </select>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "all" | "active" | "inactive")} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                <option value="all">{t.allStatus}</option>
                <option value="active">{t.activeOnly}</option>
                <option value="inactive">{t.inactiveOnly}</option>
              </select>
            </div>
          </div>
        </div>
      ) : null}

      {form ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 px-4 py-6">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-lg font-bold text-slate-950">{form.user_id ? t.editTitle : t.addTitle}</h2>
                <p className="mt-1 text-sm text-slate-500">{t.subtitle}</p>
              </div>
              <button type="button" onClick={() => setForm(null)} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {t.close}
              </button>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-2">
              <Field label={t.branch}>
                <select value={form.branch_id} onChange={(event) => setForm({ ...form, branch_id: event.target.value, device_id: "" })} disabled={Boolean(form.user_id)} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100">
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name} {branch.code ? `(${branch.code})` : ""}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.employeeCode} hint={t.employeeCodeHint}>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form.employee_code}
                  onChange={(event) => setForm({ ...form, employee_code: normalizeEmployeeCodeInput(event.target.value) })}
                  placeholder={lang === "en" ? "Enter employee code" : "กรอกรหัสพนักงาน"}
                  autoComplete="off"
                  className="h-11 w-full rounded-md border border-blue-300 bg-blue-50/40 px-3 text-sm font-bold text-slate-950 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </Field>
              <Field label={t.fullName}>
                <input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              </Field>
              <Field label={t.email}>
                <input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              </Field>
              <Field label={t.position}>
                <input value={form.position_title} onChange={(event) => setForm({ ...form, position_title: event.target.value })} className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              </Field>
              <Field label={t.permissionRole}>
                <input value={form.permission_role} onChange={(event) => setForm({ ...form, permission_role: event.target.value })} className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              </Field>
              <Field label={t.role}>
                <select
                  value={form.role}
                  onChange={(event) => {
                    const role = event.target.value as BranchRole;
                    setForm({
                      ...form,
                      role,
                      can_approve_cancel_bill: role === "staff" ? form.can_approve_cancel_bill : false,
                      pin: role === "staff" ? form.pin : ""
                    });
                  }}
                  disabled={currentRole !== "owner" && (form.role === "owner" || form.role === "manager")}
                  className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
                >
                  {roleOptions
                    .filter((role) => currentRole === "owner" || (role !== "owner" && role !== "manager"))
                    .map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[lang][role]}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={t.status}>
                <label className="flex h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm font-semibold">
                  <input type="checkbox" checked={form.is_active} onChange={(event) => setForm({ ...form, is_active: event.target.checked })} className="h-4 w-4" />
                  {form.is_active ? t.activeOnly : t.inactiveOnly}
                </label>
              </Field>
              <Field label={t.deviceScope}>
                <select value={form.scope_mode} onChange={(event) => setForm({ ...form, scope_mode: event.target.value as ScopeMode })} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100">
                  <option value="all_devices">{t.allDevices}</option>
                  <option value="single_device">{t.specificDevice}</option>
                </select>
              </Field>
              <Field label={t.chooseDevice}>
                <select value={form.device_id} onChange={(event) => setForm({ ...form, device_id: event.target.value })} disabled={form.scope_mode !== "single_device"} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100">
                  <option value="">-</option>
                  {branchDevices.map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.device_name || device.device_code}
                    </option>
                  ))}
                </select>
              </Field>
              {form.role === "staff" ? (
                <Field label={t.cancelBillApproval} hint={currentRole === "owner" ? undefined : t.cancelBillApprovalOwnerOnly}>
                  <label className="flex min-h-11 items-center gap-3 rounded-md border border-slate-200 px-3 text-sm font-semibold">
                    <input
                      type="checkbox"
                      checked={form.can_approve_cancel_bill}
                      disabled={currentRole !== "owner"}
                      onChange={(event) => setForm({ ...form, can_approve_cancel_bill: event.target.checked, pin: "" })}
                      className="h-4 w-4"
                    />
                    {form.can_approve_cancel_bill ? t.cancelBillApprovalEnabled : t.cancelBillApprovalDisabled}
                  </label>
                </Field>
              ) : null}
              {form.role !== "staff" || (currentRole === "owner" && form.can_approve_cancel_bill) ? (
                <Field label={t.pin}>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={form.pin}
                    onChange={(event) => setForm({ ...form, pin: event.target.value })}
                    placeholder={form.role === "staff" ? t.staffPinHint : t.pinHint}
                    autoComplete="new-password"
                    className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                  />
                </Field>
              ) : null}
              <Field label={t.approvalPin}>
                <input type="password" inputMode="numeric" value={form.approval_pin} onChange={(event) => setForm({ ...form, approval_pin: event.target.value })} placeholder={t.approvalPinHint} autoComplete="current-password" className="h-11 w-full rounded-md border border-slate-200 px-3 text-sm font-semibold outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button type="button" onClick={() => setForm(null)} className="rounded-md border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                {t.cancel}
              </button>
              <button type="button" onClick={() => void saveForm()} disabled={saving} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? (lang === "en" ? "Saving..." : "กำลังบันทึก...") : t.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {saving && form ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 px-4" role="dialog" aria-modal="true" aria-labelledby="pos-user-saving-title">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-6 py-7 text-center shadow-2xl">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" aria-hidden="true" />
            <h2 id="pos-user-saving-title" className="mt-4 text-lg font-bold text-slate-950">{t.savingTitle}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{t.savingMessage}</p>
          </div>
        </div>
      ) : null}

      {alertDialog ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 px-4" role="dialog" aria-modal="true" aria-labelledby="pos-user-alert-title">
          <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white px-6 py-6 text-center shadow-2xl">
            <div
              className={`mx-auto flex h-11 w-11 items-center justify-center rounded-full text-xl font-bold ${
                alertDialog.tone === "success" ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
              }`}
              aria-hidden="true"
            >
              {alertDialog.tone === "success" ? "✓" : "!"}
            </div>
            <h2 id="pos-user-alert-title" className="mt-4 text-lg font-bold text-slate-950">{alertDialog.title}</h2>
            <p className="mt-2 break-words text-sm leading-6 text-slate-600">{alertDialog.message}</p>
            <button
              type="button"
              onClick={() => setAlertDialog(null)}
              autoFocus
              className={`mt-5 w-full rounded-md px-4 py-2.5 text-sm font-bold text-white ${
                alertDialog.tone === "success" ? "bg-blue-600 hover:bg-blue-700" : "bg-red-600 hover:bg-red-700"
              }`}
            >
              {t.acknowledge}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-950">{value}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint ? <span className="mt-1.5 block text-xs leading-5 text-slate-500">{hint}</span> : null}
    </label>
  );
}
