"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./platform-users-console.module.css";

type PlatformRole = "it_admin" | "it_support" | "tenant_user";
type BranchRole = "owner" | "manager" | "staff";
type Tenant = { id: string; code: string | null; name: string | null };
type Branch = { id: string; tenant_id: string; code: string | null; name: string | null; is_active?: boolean | null };
type Assignment = {
  assignment_id: string;
  tenant_id: string;
  tenant_name: string | null;
  tenant_code: string | null;
  branch_id: string;
  branch_name: string | null;
  branch_code: string | null;
  role: string | null;
  is_default: boolean;
  employee_code: string | null;
  position_title: string | null;
  permission_role: string | null;
};
type DeviceBinding = { device_code: string | null; device_name: string | null; status: string | null; last_seen_at: string | null };
type UserRow = {
  id: string;
  email: string;
  full_name: string;
  platform_role: PlatformRole | string;
  is_active: boolean;
  updated_at: string | null;
  tenant_count: number;
  branch_count: number;
  active_session_count: number;
  assignments: Assignment[];
  devices: DeviceBinding[];
};
type Payload = { rows: UserRow[]; tenants: Tenant[]; branches: Branch[]; page: number; page_size: number; total: number; has_next: boolean };
type FormState = {
  user_id: string;
  full_name: string;
  email: string;
  platform_role: PlatformRole;
  is_active: boolean;
  tenant_id: string;
  branch_id: string;
  branch_role: BranchRole;
  employee_code: string;
  position_title: string;
  permission_role: string;
  password: string;
  pos_pin: string;
  reason: string;
};
type ModalMode = "create" | "edit" | "view";
type Notice = { tone: "success" | "danger" | "info" | "warning"; title: string; message: string; secret?: string | null } | null;

const emptyForm: FormState = {
  user_id: "",
  full_name: "",
  email: "",
  platform_role: "tenant_user",
  is_active: true,
  tenant_id: "",
  branch_id: "",
  branch_role: "staff",
  employee_code: "",
  position_title: "",
  permission_role: "staff",
  password: "",
  pos_pin: "",
  reason: ""
};

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function roleLabel(role: string | null | undefined) {
  if (role === "it_admin") return "IT Admin";
  if (role === "it_support") return "IT Support";
  if (role === "owner") return "Owner";
  if (role === "manager") return "Manager";
  if (role === "staff") return "Staff";
  return "ผู้ใช้ร้าน";
}

function statusText(user: UserRow) {
  if (!user.is_active) return "ปิดใช้งาน";
  if (user.active_session_count > 0) return "ออนไลน์";
  return "พร้อมใช้งาน";
}

function randomPassword() {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 14);
  return `Cp!${token}9`;
}

function formFromUser(user: UserRow): FormState {
  const primary = user.assignments[0];
  return {
    ...emptyForm,
    user_id: user.id,
    full_name: user.full_name,
    email: user.email,
    platform_role: (user.platform_role === "it_admin" || user.platform_role === "it_support" || user.platform_role === "tenant_user" ? user.platform_role : "tenant_user") as PlatformRole,
    is_active: user.is_active,
    tenant_id: primary?.tenant_id ?? "",
    branch_id: primary?.branch_id ?? "",
    branch_role: (primary?.role === "owner" || primary?.role === "manager" || primary?.role === "staff" ? primary.role : "staff") as BranchRole,
    employee_code: primary?.employee_code ?? "",
    position_title: primary?.position_title ?? "",
    permission_role: primary?.permission_role ?? primary?.role ?? "staff"
  };
}

export function PlatformUsersConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [modalMode, setModalMode] = useState<ModalMode | null>(null);
  const [selected, setSelected] = useState<UserRow | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [confirm, setConfirm] = useState<{ title: string; message: string; action: () => Promise<void> } | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "10", status });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/it-admin/v1/platform-users?${params}`, { cache: "no-store", credentials: "include" });
      const body = (await response.json().catch(() => null)) as { data?: Payload; error?: { message?: string } } | null;
      if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${response.status}).`);
      setData(body.data);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "โหลดข้อมูลผู้ใช้ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const branches = useMemo(() => {
    if (!data) return [];
    return form.tenant_id ? data.branches.filter((branch) => branch.tenant_id === form.tenant_id) : data.branches;
  }, [data, form.tenant_id]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      total: data?.total ?? rows.length,
      active: rows.filter((user) => user.is_active).length,
      inactive: rows.filter((user) => !user.is_active).length,
      online: rows.filter((user) => user.active_session_count > 0).length
    };
  }, [data]);

  const openCreate = () => {
    setSelected(null);
    setForm(emptyForm);
    setModalMode("create");
  };

  const openUser = (user: UserRow, mode: ModalMode = "view") => {
    setSelected(user);
    setForm(formFromUser(user));
    setModalMode(mode);
  };

  const closeModal = () => {
    setModalMode(null);
    setSelected(null);
    setForm(emptyForm);
  };

  const submitForm = async () => {
    setSaving(true);
    try {
      const isCreate = modalMode === "create";
      const response = await fetch("/api/it-admin/v1/platform-users", {
        method: isCreate ? "POST" : "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const body = (await response.json().catch(() => null)) as { data?: { temporary_password?: string | null; auth_sync?: { ok?: boolean; message?: string } }; error?: { message?: string } } | null;
      if (!response.ok) throw new Error(body?.error?.message ?? `Save failed (${response.status}).`);
      closeModal();
      setNotice({ tone: body?.data?.auth_sync?.ok === false ? "warning" : "success", title: isCreate ? "เพิ่มผู้ใช้สำเร็จ" : "บันทึกผู้ใช้สำเร็จ", message: body?.data?.auth_sync?.message ?? "ข้อมูลผู้ใช้ บทบาท และสิทธิ์ถูกบันทึกแล้ว", secret: body?.data?.temporary_password ?? null });
      await load();
    } catch (saveError) {
      setNotice({ tone: "danger", title: "บันทึกไม่สำเร็จ", message: saveError instanceof Error ? saveError.message : "เกิดข้อผิดพลาด" });
    } finally {
      setSaving(false);
    }
  };

  const disableUser = (user: UserRow) => {
    setConfirm({
      title: "ปิดใช้งานผู้ใช้ชั่วคราว?",
      message: `${user.full_name || user.email} จะถูกปิดใช้งานและ session หน้าร้านที่ยัง active จะถูก revoke`,
      action: async () => {
        const response = await fetch("/api/it-admin/v1/platform-users", {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user_id: user.id, is_active: false, reason: "disabled_from_platform_users" })
        });
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "Disable failed.");
        setNotice({ tone: "success", title: "ปิดใช้งานแล้ว", message: "ผู้ใช้ถูกปิดใช้งานชั่วคราวเรียบร้อย" });
        await load();
      }
    });
  };

  const deleteUser = (user: UserRow) => {
    setConfirm({
      title: "ลบผู้ใช้นี้?",
      message: `${user.full_name || user.email} จะถูกลบออกจาก Auth, โปรไฟล์, บทบาท, POS profile และ revoke session ที่ยัง active`,
      action: async () => {
        const response = await fetch(`/api/it-admin/v1/platform-users?user_id=${encodeURIComponent(user.id)}`, { method: "DELETE", credentials: "include" });
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        if (!response.ok) throw new Error(body?.error?.message ?? "Delete failed.");
        setNotice({ tone: "success", title: "ลบผู้ใช้สำเร็จ", message: "ลบผู้ใช้และข้อมูลที่ผูกไว้เรียบร้อย" });
        await load();
      }
    });
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setSaving(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch (confirmError) {
      setNotice({ tone: "danger", title: "ดำเนินการไม่สำเร็จ", message: confirmError instanceof Error ? confirmError.message : "เกิดข้อผิดพลาด" });
    } finally {
      setSaving(false);
    }
  };

  const modal = modalMode && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeModal(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true">
        <header className={styles.dialogHead}>
          <div>
            <span>{modalMode === "create" ? "CREATE USER" : modalMode === "edit" ? "EDIT USER" : "USER DETAIL"}</span>
            <h3>{modalMode === "create" ? "เพิ่มผู้ใช้" : selected?.full_name || selected?.email || "ข้อมูลผู้ใช้"}</h3>
          </div>
          <button type="button" onClick={closeModal}>×</button>
        </header>

        {modalMode === "view" && selected ? (
          <div className={styles.detailGrid}>
            <div className={styles.detailBox}><span>อีเมล</span><strong>{selected.email || "-"}</strong></div>
            <div className={styles.detailBox}><span>Platform Role</span><strong>{roleLabel(selected.platform_role)}</strong></div>
            <div className={styles.detailBox}><span>สถานะ</span><strong>{statusText(selected)}</strong></div>
            <div className={styles.detailBox}><span>อัปเดต</span><strong>{formatDate(selected.updated_at)}</strong></div>
            <section className={styles.fullSection}>
              <h4>ร้าน / สาขา / สิทธิ์</h4>
              {selected.assignments.length ? selected.assignments.map((item) => (
                <article key={item.assignment_id} className={styles.linkCard}>
                  <strong>{item.tenant_name || item.tenant_code || item.tenant_id}</strong>
                  <span>{item.branch_name || item.branch_code || item.branch_id} · {roleLabel(item.role)} · รหัสพนักงาน {item.employee_code || "-"}</span>
                </article>
              )) : <p className={styles.muted}>ยังไม่ผูกกับร้านหรือสาขา</p>}
            </section>
            <section className={styles.fullSection}>
              <h4>เครื่องที่กำลังใช้งาน</h4>
              {selected.devices.length ? selected.devices.map((item, index) => (
                <article key={`${item.device_code}-${index}`} className={styles.linkCard}>
                  <strong>{item.device_name || item.device_code || "ไม่ระบุเครื่อง"}</strong>
                  <span>{item.status || "-"} · พบล่าสุด {formatDate(item.last_seen_at)}</span>
                </article>
              )) : <p className={styles.muted}>ยังไม่มี session หรือเครื่องที่ active</p>}
            </section>
          </div>
        ) : (
          <div className={styles.formGrid}>
            <label>ชื่อผู้ใช้<input value={form.full_name} onChange={(event) => setForm({ ...form, full_name: event.target.value })} /></label>
            <label>อีเมล Login<input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
            <label>Platform Role<select value={form.platform_role} onChange={(event) => setForm({ ...form, platform_role: event.target.value as PlatformRole })}><option value="tenant_user">Tenant User</option><option value="it_support">IT Support</option><option value="it_admin">IT Admin</option></select></label>
            <label>สถานะ<select value={form.is_active ? "active" : "inactive"} onChange={(event) => setForm({ ...form, is_active: event.target.value === "active" })}><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></label>
            <label>ร้าน<select value={form.tenant_id} onChange={(event) => setForm({ ...form, tenant_id: event.target.value, branch_id: "" })}><option value="">ไม่ผูกร้าน</option>{data?.tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name || tenant.code || tenant.id}</option>)}</select></label>
            <label>สาขา<select value={form.branch_id} onChange={(event) => setForm({ ...form, branch_id: event.target.value })}><option value="">ไม่ผูกสาขา</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name || branch.code || branch.id}</option>)}</select></label>
            <label>บทบาทสาขา<select value={form.branch_role} onChange={(event) => setForm({ ...form, branch_role: event.target.value as BranchRole, permission_role: event.target.value })}><option value="staff">Staff</option><option value="manager">Manager</option><option value="owner">Owner</option></select></label>
            <label>รหัสพนักงาน POS<input value={form.employee_code} onChange={(event) => setForm({ ...form, employee_code: event.target.value.toUpperCase() })} /></label>
            <label>ตำแหน่ง<input value={form.position_title} onChange={(event) => setForm({ ...form, position_title: event.target.value })} /></label>
            <label>Permission Role<input value={form.permission_role} onChange={(event) => setForm({ ...form, permission_role: event.target.value })} /></label>
            <label>รหัสผ่าน Login ใหม่<input value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} placeholder="ว่างไว้ถ้าไม่เปลี่ยน" /></label>
            <label>PIN หน้าร้านใหม่<input value={form.pos_pin} onChange={(event) => setForm({ ...form, pos_pin: event.target.value.replace(/\D/g, "") })} placeholder="4-8 หลัก" /></label>
            <label className={styles.fullField}>เหตุผล / หมายเหตุ<input value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label>
          </div>
        )}

        <footer className={styles.dialogActions}>
          {modalMode === "view" && selected ? <button type="button" onClick={() => setModalMode("edit")}>แก้ไข</button> : null}
          {modalMode !== "view" ? <button type="button" onClick={() => setForm({ ...form, password: randomPassword() })}>สร้างรหัสผ่านชั่วคราว</button> : null}
          <button type="button" className={styles.secondary} onClick={closeModal}>ปิด</button>
          {modalMode !== "view" ? <button type="button" className={styles.primary} disabled={saving} onClick={() => void submitForm()}>{saving ? "กำลังบันทึก..." : "บันทึก"}</button> : null}
        </footer>
      </section>
    </div>, document.body) : null;

  const confirmModal = confirm && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop}>
      <section className={styles.confirmDialog} role="alertdialog" aria-modal="true">
        <h3>{confirm.title}</h3>
        <p>{confirm.message}</p>
        <div><button type="button" onClick={() => setConfirm(null)}>ยกเลิก</button><button type="button" className={styles.dangerButton} disabled={saving} onClick={() => void runConfirm()}>{saving ? "กำลังทำงาน..." : "ยืนยัน"}</button></div>
      </section>
    </div>, document.body) : null;

  const noticeModal = notice && typeof document !== "undefined" ? createPortal(
    <div className={styles.backdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setNotice(null); }}>
      <section className={`${styles.confirmDialog} ${notice.tone === "danger" ? styles.noticeDanger : notice.tone === "warning" ? styles.noticeWarning : styles[notice.tone]}`} role="alertdialog" aria-modal="true">
        <h3>{notice.title}</h3>
        <p>{notice.message}</p>
        {notice.secret ? <code className={styles.secretBox}>{notice.secret}</code> : null}
        <div><button type="button" className={styles.primary} onClick={() => setNotice(null)}>ตกลง</button></div>
      </section>
    </div>, document.body) : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><span>IDENTITY & ACCESS</span><h2>ผู้ใช้ / บทบาท / สิทธิ์</h2><p>จัดการบัญชีผู้ใช้ บทบาท สิทธิ์หน้าร้าน สาขา เครื่องที่ใช้งาน และการรีเซ็ตรหัสผ่านจาก Control Plane เดียว</p></div>
        <button type="button" className={styles.primary} onClick={openCreate}>เพิ่มผู้ใช้</button>
      </header>

      <section className={styles.summaryGrid}>
        <article><span>ผู้ใช้ทั้งหมด</span><strong>{totals.total}</strong></article>
        <article><span>เปิดใช้งานในหน้านี้</span><strong>{totals.active}</strong></article>
        <article><span>ปิดใช้งานในหน้านี้</span><strong>{totals.inactive}</strong></article>
        <article><span>ออนไลน์ในหน้านี้</span><strong>{totals.online}</strong></article>
      </section>

      <section className={styles.toolbar}>
        <input value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} placeholder="ค้นหาชื่อ อีเมล หรือบทบาท" />
        <select value={status} onChange={(event) => { setPage(1); setStatus(event.target.value as "all" | "active" | "inactive"); }}><option value="all">ทุกสถานะ</option><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select>
        <button type="button" onClick={() => void load()} disabled={loading}>รีเฟรช</button>
      </section>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <section className={styles.tableCard}>
        <div className={styles.tableHead}><strong>{data?.total ?? 0} รายการ</strong><span>หน้า {page}</span></div>
        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>ผู้ใช้</th><th>Role</th><th>สถานะ</th><th>ร้าน / สาขา</th><th>เครื่อง</th><th>อัปเดต</th><th>จัดการ</th></tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className={styles.empty}>กำลังโหลดข้อมูล...</td></tr> : null}
              {!loading && data?.rows.length === 0 ? <tr><td colSpan={7} className={styles.empty}>ไม่พบข้อมูลผู้ใช้</td></tr> : null}
              {data?.rows.map((user) => (
                <tr key={user.id} onClick={() => openUser(user)}>
                  <td><strong>{user.full_name || "ไม่ระบุชื่อ"}</strong><span>{user.email}</span></td>
                  <td>{roleLabel(user.platform_role)}</td>
                  <td><span className={`${styles.badge} ${user.is_active ? styles.active : styles.inactive}`}>{statusText(user)}</span></td>
                  <td>{user.tenant_count} ร้าน / {user.branch_count} สาขา</td>
                  <td>{user.active_session_count ? `${user.active_session_count} session` : "-"}</td>
                  <td>{formatDate(user.updated_at)}</td>
                  <td className={styles.rowActions} onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => openUser(user, "edit")}>แก้ไข</button><button type="button" onClick={() => disableUser(user)} disabled={!user.is_active}>ปิดใช้</button><button type="button" className={styles.deleteBtn} onClick={() => deleteUser(user)}>ลบ</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className={styles.pagination}><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button><button type="button" disabled={!data?.has_next || loading} onClick={() => setPage((value) => value + 1)}>ถัดไป</button></footer>
      </section>
      {modal}{confirmModal}{noticeModal}
    </main>
  );
}


