"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type ItRole = "it_admin" | "it_support";

type ItUser = {
  id: string;
  email: string;
  full_name: string;
  platform_role: ItRole;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

type Payload = {
  rows: ItUser[];
  actor_role: ItRole;
};

type FormState = {
  user_id: string;
  full_name: string;
  email: string;
  platform_role: ItRole;
  is_active: boolean;
  password: string;
  reason: string;
};

const emptyForm: FormState = {
  user_id: "",
  full_name: "",
  email: "",
  platform_role: "it_admin",
  is_active: true,
  password: "",
  reason: ""
};

function roleLabel(role: ItRole) {
  return role === "it_support" ? "IT Support" : "IT Admin";
}

function roleDescription(role: ItRole) {
  return role === "it_support"
    ? "เห็นทุกเมนู และมีสิทธิ์แก้ไข เพิ่ม ลบ และดำเนินการเต็มรูปแบบ"
    : "เห็นเฉพาะเมนูงานหลักที่กำหนด แก้ไข/เพิ่ม/บันทึกได้ แต่ไม่มีสิทธิ์ลบ";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function generatePassword() {
  const bytes = new Uint8Array(12);
  window.crypto.getRandomValues(bytes);
  return `Cp!${Array.from(bytes, (byte) => byte.toString(36).padStart(2, "0")).join("").slice(0, 14)}9`;
}

export function ItSystemUsersConsole() {
  const [data, setData] = useState<Payload | null>(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "active" | "inactive">("all");
  const [role, setRole] = useState<"all" | ItRole>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ status, role });
      if (search.trim()) params.set("search", search.trim());
      const response = await fetch(`/api/it-admin/v1/it-users?${params}`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as { data?: Payload; error?: { message?: string } } | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดผู้ใช้ระบบ IT ไม่สำเร็จ");
      setData(json.data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดผู้ใช้ระบบ IT ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [role, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    const rows = data?.rows ?? [];
    return {
      total: rows.length,
      admin: rows.filter((row) => row.platform_role === "it_admin").length,
      support: rows.filter((row) => row.platform_role === "it_support").length,
      active: rows.filter((row) => row.is_active).length
    };
  }, [data]);

  async function save() {
    if (!form || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    setTemporaryPassword("");
    try {
      const isCreate = !form.user_id;
      const response = await fetch("/api/it-admin/v1/it-users", {
        method: isCreate ? "POST" : "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form)
      });
      const json = await response.json().catch(() => null) as {
        data?: { temporary_password?: string | null };
        error?: { message?: string };
      } | null;
      if (!response.ok) throw new Error(json?.error?.message || "บันทึกไม่สำเร็จ");
      if (json?.data?.temporary_password) setTemporaryPassword(json.data.temporary_password);
      setForm(null);
      setNotice(isCreate ? "เพิ่มผู้ใช้ระบบ IT เรียบร้อยแล้ว" : "บันทึกผู้ใช้ระบบ IT เรียบร้อยแล้ว");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function setActive(user: ItUser, isActive: boolean) {
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/it-admin/v1/it-users", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user_id: user.id, is_active: isActive })
      });
      const json = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(json?.error?.message || "เปลี่ยนสถานะไม่สำเร็จ");
      setNotice(isActive ? "เปิดใช้งานบัญชีแล้ว" : "ปิดใช้งานบัญชีแล้ว");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  async function remove(user: ItUser) {
    if (!window.confirm(`ยืนยันลบบัญชี IT: ${user.full_name || user.email} ?\n\nการลบนี้ใช้เฉพาะบัญชีระบบ IT และไม่เกี่ยวข้องกับผู้ใช้งาน POS`)) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/it-users?user_id=${encodeURIComponent(user.id)}`, { method: "DELETE" });
      const json = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      if (!response.ok) throw new Error(json?.error?.message || "ลบบัญชีไม่สำเร็จ");
      setNotice("ลบบัญชีผู้ใช้ระบบ IT เรียบร้อยแล้ว");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ลบบัญชีไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-black tracking-[0.12em] text-blue-600">IT IDENTITY & ACCESS</span>
          <h2 className="mt-1 text-3xl font-black text-slate-900">ตั้งค่า USER ใช้งานระบบ IT</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            หน้านี้จัดการเฉพาะบัญชีที่ใช้ Login เข้าระบบ IT Control Plane เท่านั้น
            <strong className="ml-1 text-red-600">ไม่แสดงและไม่แก้ไขผู้ใช้งาน POS ของร้านค้า</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ ...emptyForm })}
          className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-sm"
        >
          เพิ่มผู้ใช้ IT
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-4">
        <Summary label="ผู้ใช้ IT ทั้งหมด" value={totals.total} />
        <Summary label="IT Admin" value={totals.admin} />
        <Summary label="IT Support" value={totals.support} />
        <Summary label="เปิดใช้งาน" value={totals.active} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px_auto]">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ค้นหาชื่อหรืออีเมลผู้ใช้ IT"
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <select value={role} onChange={(event) => setRole(event.target.value as typeof role)}
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            <option value="all">ทุก Role</option>
            <option value="it_admin">IT Admin</option>
            <option value="it_support">IT Support</option>
          </select>
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
            <option value="all">ทุกสถานะ</option>
            <option value="active">เปิดใช้งาน</option>
            <option value="inactive">ปิดใช้งาน</option>
          </select>
          <button type="button" onClick={() => void load()} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-bold">รีเฟรช</button>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-semibold text-emerald-700">{notice}</div> : null}
      {temporaryPassword ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>รหัสผ่านชั่วคราว:</strong>
          <code className="ml-2 rounded bg-white px-2 py-1 font-mono">{temporaryPassword}</code>
          <div className="mt-2 text-xs">คัดลอกรหัสนี้เก็บไว้และให้ผู้ใช้เปลี่ยนรหัสผ่านหลัง Login ครั้งแรก</div>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs font-black text-slate-500">
              <tr>
                <th className="px-5 py-4">ผู้ใช้ IT</th>
                <th className="px-5 py-4">Role</th>
                <th className="px-5 py-4">สิทธิ์เมนู</th>
                <th className="px-5 py-4">สถานะ</th>
                <th className="px-5 py-4">อัปเดต</th>
                <th className="px-5 py-4 text-right">จัดการ</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">กำลังโหลด...</td></tr>
              ) : data?.rows.length ? data.rows.map((user) => (
                <tr key={user.id} className="border-t border-slate-100 align-top">
                  <td className="px-5 py-4"><strong className="block text-slate-900">{user.full_name || "—"}</strong><span className="mt-1 block text-xs text-slate-500">{user.email}</span></td>
                  <td className="px-5 py-4"><RoleBadge role={user.platform_role} /></td>
                  <td className="max-w-sm px-5 py-4 text-xs leading-5 text-slate-600">{roleDescription(user.platform_role)}</td>
                  <td className="px-5 py-4">
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${user.is_active ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                      {user.is_active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs text-slate-500">{formatDate(user.updated_at)}</td>
                  <td className="px-5 py-4">
                    <div className="flex justify-end gap-2">
                      <button type="button" onClick={() => setForm({
                        user_id: user.id,
                        full_name: user.full_name,
                        email: user.email,
                        platform_role: user.platform_role,
                        is_active: user.is_active,
                        password: "",
                        reason: ""
                      })} className="rounded-lg border border-blue-200 px-3 py-2 text-xs font-bold text-blue-700">แก้ไข</button>
                      <button type="button" disabled={saving} onClick={() => void setActive(user, !user.is_active)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold text-slate-700">
                        {user.is_active ? "ปิดใช้" : "เปิดใช้"}
                      </button>
                      <button type="button" disabled={saving} onClick={() => void remove(user)}
                        className="rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700">ลบ</button>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr><td colSpan={6} className="px-5 py-10 text-center text-slate-500">ไม่พบบัญชีผู้ใช้ระบบ IT</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {form ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-slate-950/45 p-4" onMouseDown={(event) => {
          if (event.currentTarget === event.target) setForm(null);
        }}>
          <section className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="text-[10px] font-black tracking-[0.12em] text-blue-600">{form.user_id ? "EDIT IT USER" : "CREATE IT USER"}</span>
                <h3 className="mt-1 text-2xl font-black text-slate-900">{form.user_id ? "แก้ไขผู้ใช้ระบบ IT" : "เพิ่มผู้ใช้ระบบ IT"}</h3>
              </div>
              <button type="button" onClick={() => setForm(null)} className="rounded-lg px-3 py-2 text-xl text-slate-500">×</button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <Field label="ชื่อผู้ใช้" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} />
              <Field label="อีเมล Login" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">Role ระบบ IT</span>
                <select value={form.platform_role} onChange={(event) => setForm({ ...form, platform_role: event.target.value as ItRole })}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  <option value="it_admin">IT Admin — เมนูจำกัด / ห้ามลบ</option>
                  <option value="it_support">IT Support — สิทธิ์เต็มทั้งหมด</option>
                </select>
              </label>
              <label className="grid gap-2">
                <span className="text-sm font-bold text-slate-700">สถานะ</span>
                <select value={form.is_active ? "active" : "inactive"} onChange={(event) => setForm({ ...form, is_active: event.target.value === "active" })}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm">
                  <option value="active">เปิดใช้งาน</option>
                  <option value="inactive">ปิดใช้งาน</option>
                </select>
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm font-bold text-slate-700">รหัสผ่าน {form.user_id ? "ใหม่ (ว่างไว้ถ้าไม่เปลี่ยน)" : "(ว่างไว้ให้ระบบสร้างชั่วคราว)"}</span>
                <div className="flex gap-2">
                  <input type="text" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
                  <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-bold">สร้างรหัส</button>
                </div>
              </label>
              <Field label="เหตุผล / หมายเหตุ" value={form.reason} onChange={(value) => setForm({ ...form, reason: value })} wide />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setForm(null)} className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-bold">ยกเลิก</button>
              <button type="button" disabled={saving} onClick={() => void save()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
                {saving ? "กำลังบันทึก..." : "บันทึก"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function Summary({ label, value }: { label: string; value: number }) {
  return <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="text-xs font-bold text-slate-500">{label}</span><strong className="mt-2 block text-3xl font-black text-slate-900">{value}</strong></article>;
}

function RoleBadge({ role }: { role: ItRole }) {
  return <span className={`rounded-full px-2.5 py-1 text-xs font-black ${role === "it_support" ? "bg-violet-50 text-violet-700" : "bg-blue-50 text-blue-700"}`}>{roleLabel(role)}</span>;
}

function Field({ label, value, onChange, type = "text", wide = false }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email";
  wide?: boolean;
}) {
  return <label className={`grid gap-2 ${wide ? "md:col-span-2" : ""}`}><span className="text-sm font-bold text-slate-700">{label}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" /></label>;
}
