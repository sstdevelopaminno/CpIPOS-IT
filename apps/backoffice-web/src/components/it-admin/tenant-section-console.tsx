"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import Link from "next/link";
import { TenantAdminNav } from "@/components/it-admin/tenant-admin-nav";

type SectionKey = "branches" | "users" | "devices" | "login-policies" | "sessions" | "shifts" | "features";

type ApiEnvelope<T> = {
  data: T;
  error: { code: string; message: string } | null;
};

type BranchRow = {
  id: string;
  code: string;
  name: string;
  address: string | null;
  is_active: boolean;
};

type UserAssignment = {
  id: string;
  user_id: string;
  branch_id: string;
  role: "owner" | "manager" | "staff";
  is_default: boolean;
  users_profiles?: {
    id: string;
    email: string;
    full_name: string;
    is_active: boolean;
    platform_role: string;
  };
};

type DeviceRow = {
  id: string;
  branch_id: string;
  device_code: string;
  device_name: string;
  device_type: string;
  status: string;
  lock_mode: "locked" | "unlocked";
  last_seen_at: string | null;
};

type PolicyRow = {
  id: string;
  branch_id: string;
  require_registered_device: boolean;
  allow_pin_login: boolean;
  allow_staff_card_login: boolean;
  allow_multi_device: boolean;
  max_devices: number;
};

type SessionRow = {
  id: string;
  branch_id: string;
  user_id: string;
  role: string;
  device_code: string | null;
  status: string;
  issued_at: string;
  expires_at: string;
  shift_id: string | null;
};

type ShiftRow = {
  id: string;
  branch_id: string;
  status: string;
  opened_by: string;
  closed_by: string | null;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number | null;
  closing_cash: number | null;
  device_code: string | null;
};

type FeatureRow = {
  code: string;
  name: string;
  description: string;
  is_enabled: boolean;
  source: string;
};

type PlanRow = {
  id: string;
  code: string;
  name: string;
  monthly_price: number | null;
  status?: string | null;
};

type ContractRow = {
  id: string;
  package_id: string;
  status: string;
  started_at: string;
  ended_at: string | null;
  max_branches: number | null;
  max_devices: number | null;
  max_users: number | null;
};

type QuotaLimits = {
  contractId: string | null;
  planId: string | null;
  contractStatus: string | null;
  maxBranches: number | null;
  maxDevices: number | null;
  maxUsers: number | null;
  usage: {
    branches: number;
    devices: number;
    users: number;
  };
};

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "short", timeStyle: "short" }).format(date);
}

export function TenantSectionConsole({ tenantId, section }: { tenantId: string; section: SectionKey }) {
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [branchIdFilter, setBranchIdFilter] = useState("");

  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [users, setUsers] = useState<UserAssignment[]>([]);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [features, setFeatures] = useState<FeatureRow[]>([]);
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [activeContract, setActiveContract] = useState<ContractRow | null>(null);
  const [quotaLimits, setQuotaLimits] = useState<QuotaLimits | null>(null);

  const canUseBranchFilter = section !== "branches";

  async function runAction<T>(runner: () => Promise<T>, successMessage: string) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      await runner();
      setSuccess(successMessage);
      await loadSection();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function parseResponse<T>(response: Response): Promise<T> {
    const payload = (await response.json()) as ApiEnvelope<T>;
    if (!response.ok || payload.error) {
      throw new Error(payload.error?.message ?? "Request failed.");
    }
    return payload.data;
  }

  async function loadBranches() {
    const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/branches`, { cache: "no-store" });
    const data = await parseResponse<{ branches: BranchRow[] }>(response);
    setBranches(data.branches ?? []);
  }

  async function loadSection() {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      await loadBranches();
      const params = new URLSearchParams();
      if (branchIdFilter) params.set("branch_id", branchIdFilter);

      if (section === "branches") {
        return;
      }

      if (section === "users") {
        const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/users?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<{ users: UserAssignment[] }>(response);
        setUsers(data.users ?? []);
        return;
      }

      if (section === "devices") {
        const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/devices?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<{ devices: DeviceRow[] }>(response);
        setDevices(data.devices ?? []);
        return;
      }

      if (section === "login-policies") {
        const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/login-policies?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<{ policies: PolicyRow[] }>(response);
        setPolicies(data.policies ?? []);
        return;
      }

      if (section === "sessions") {
        const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/sessions?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<{ sessions: SessionRow[] }>(response);
        setSessions(data.sessions ?? []);
        return;
      }

      if (section === "shifts") {
        const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/shifts?${params.toString()}`, { cache: "no-store" });
        const data = await parseResponse<{ shifts: ShiftRow[] }>(response);
        setShifts(data.shifts ?? []);
        return;
      }

      const [featuresResponse, contractResponse] = await Promise.all([
        fetch(`/api/it-admin/admin/tenants/${tenantId}/features?${params.toString()}`, { cache: "no-store" }),
        fetch(`/api/it-admin/admin/tenants/${tenantId}/contract`, { cache: "no-store" })
      ]);
      const featuresData = await parseResponse<{ features: FeatureRow[] }>(featuresResponse);
      const contractData = await parseResponse<{ plans: PlanRow[]; active_contract: ContractRow | null; limits: QuotaLimits }>(contractResponse);
      setFeatures(featuresData.features ?? []);
      setPlans(contractData.plans ?? []);
      setActiveContract(contractData.active_contract ?? null);
      setQuotaLimits(contractData.limits ?? null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSection();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, section, branchIdFilter]);

  const sectionTitle = useMemo(() => {
    switch (section) {
      case "branches":
        return "Branches";
      case "users":
        return "Users and Branch Roles";
      case "devices":
        return "Devices";
      case "login-policies":
        return "Login Policies";
      case "sessions":
        return "Active Sessions";
      case "shifts":
        return "Shifts";
      case "features":
        return "Feature Subscriptions";
      default:
        return "Tenant Admin";
    }
  }, [section]);

  async function updateRole(assignment: UserAssignment, role: UserAssignment["role"]) {
    await runAction(async () => {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: assignment.user_id, branch_id: assignment.branch_id, role })
      });
      await parseResponse(response);
    }, "Role updated.");
  }

  return (
    <section className="surface" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>{sectionTitle}</h2>
      <TenantAdminNav tenantId={tenantId} />

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        {canUseBranchFilter ? (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span>Branch:</span>
            <select value={branchIdFilter} onChange={(event) => setBranchIdFilter(event.target.value)}>
              <option value="">All</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" onClick={() => void loadSection()} disabled={loading || busy}>
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {success ? <p style={{ margin: 0, color: "#047857" }}>{success}</p> : null}
      {error ? <p style={{ margin: 0, color: "#b91c1c" }}>{error}</p> : null}

      {section === "branches" ? (
        <BranchesPane tenantId={tenantId} branches={branches} onChanged={() => void loadSection()} onError={setError} busy={busy} setBusy={setBusy} />
      ) : null}

      {section === "users" ? (
        <UsersPane
          tenantId={tenantId}
          users={users}
          branches={branches}
          busy={busy}
          onRoleChange={(assignment, role) => void updateRole(assignment, role)}
          onChanged={() => void loadSection()}
          setError={setError}
          setSuccess={setSuccess}
          setBusy={setBusy}
        />
      ) : null}

      {section === "devices" ? (
        <DevicesPane tenantId={tenantId} devices={devices} busy={busy} onChanged={() => void loadSection()} setError={setError} setBusy={setBusy} />
      ) : null}

      {section === "login-policies" ? (
        <PoliciesPane
          tenantId={tenantId}
          policies={policies}
          branches={branches}
          busy={busy}
          onChanged={() => void loadSection()}
          setError={setError}
          setBusy={setBusy}
        />
      ) : null}

      {section === "sessions" ? (
        <SessionsPane tenantId={tenantId} sessions={sessions} busy={busy} onChanged={() => void loadSection()} setError={setError} setBusy={setBusy} />
      ) : null}

      {section === "shifts" ? (
        <ShiftsPane tenantId={tenantId} shifts={shifts} busy={busy} onChanged={() => void loadSection()} setError={setError} setBusy={setBusy} />
      ) : null}

      {section === "features" ? (
        <FeaturesPane
          tenantId={tenantId}
          features={features}
          plans={plans}
          activeContract={activeContract}
          quotaLimits={quotaLimits}
          branchId={branchIdFilter || null}
          busy={busy}
          onChanged={() => void loadSection()}
          setError={setError}
          setBusy={setBusy}
        />
      ) : null}
    </section>
  );
}

function BranchesPane({
  tenantId,
  branches,
  busy,
  onChanged,
  onError,
  setBusy
}: {
  tenantId: string;
  branches: BranchRow[];
  busy: boolean;
  onChanged: () => void;
  onError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");

  async function createBranch() {
    setBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/branches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, name })
      });
      const payload = (await response.json()) as ApiEnvelope<{ branch: BranchRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Create branch failed.");
      }
      setCode("");
      setName("");
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Create branch failed.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(branch: BranchRow) {
    setBusy(true);
    onError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/branches`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branch.id, is_active: !branch.is_active })
      });
      const payload = (await response.json()) as ApiEnvelope<{ branch: BranchRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Update branch failed.");
      }
      onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Update branch failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input placeholder="code" value={code} onChange={(event) => setCode(event.target.value)} />
        <input placeholder="name" value={name} onChange={(event) => setName(event.target.value)} />
        <button type="button" disabled={busy} onClick={() => void createBranch()} className="pos-monitor-btn pos-monitor-btn--primary">
          Add Branch
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Branch</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Action</th>
          </tr>
        </thead>
        <tbody>
          {branches.map((branch) => (
            <tr key={branch.id}>
              <td style={tdStyle}>{branch.name} ({branch.code})</td>
              <td style={tdStyle}>{branch.is_active ? "active" : "inactive"}</td>
              <td style={tdStyle}>
                <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void toggleActive(branch)}>
                  {branch.is_active ? "Deactivate" : "Activate"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersPane({
  tenantId,
  users,
  branches,
  busy,
  onRoleChange,
  onChanged,
  setError,
  setSuccess,
  setBusy
}: {
  tenantId: string;
  users: UserAssignment[];
  branches: BranchRow[];
  busy: boolean;
  onRoleChange: (assignment: UserAssignment, role: UserAssignment["role"]) => void;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setSuccess: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  const [userId, setUserId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [role, setRole] = useState<UserAssignment["role"]>("staff");

  async function assignRole() {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, branch_id: branchId, role })
      });
      const payload = (await response.json()) as ApiEnvelope<{ assignment: UserAssignment }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Assign role failed.");
      }
      setSuccess("Role assigned.");
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Assign role failed.");
    } finally {
      setBusy(false);
    }
  }

  async function deactivateRole(assignment: UserAssignment) {
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: assignment.user_id, branch_id: assignment.branch_id, deactivate: true })
      });
      const payload = (await response.json()) as ApiEnvelope<{ deactivated: boolean }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Deactivate role failed.");
      }
      setSuccess("Role deactivated.");
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Deactivate role failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input placeholder="user_id (uuid)" value={userId} onChange={(event) => setUserId(event.target.value)} style={{ minWidth: 260 }} />
        <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">Select branch</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </select>
        <select value={role} onChange={(event) => setRole(event.target.value as UserAssignment["role"])}>
          <option value="owner">owner</option>
          <option value="manager">manager</option>
          <option value="staff">staff</option>
        </select>
        <button type="button" disabled={busy} onClick={() => void assignRole()} className="pos-monitor-btn pos-monitor-btn--primary">
          Assign
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>User</th>
            <th style={thStyle}>Branch</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((assignment) => (
            <tr key={assignment.id}>
              <td style={tdStyle}>
                <div>{assignment.users_profiles?.full_name ?? assignment.user_id}</div>
                <small style={{ color: "#64748b" }}>{assignment.users_profiles?.email ?? assignment.user_id}</small>
              </td>
              <td style={tdStyle}>{assignment.branch_id}</td>
              <td style={tdStyle}>
                <select value={assignment.role} onChange={(event) => onRoleChange(assignment, event.target.value as UserAssignment["role"])} disabled={busy}>
                  <option value="owner">owner</option>
                  <option value="manager">manager</option>
                  <option value="staff">staff</option>
                </select>
              </td>
              <td style={tdStyle}>
                <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void deactivateRole(assignment)}>
                  Deactivate
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DevicesPane({
  tenantId,
  devices,
  busy,
  onChanged,
  setError,
  setBusy
}: {
  tenantId: string;
  devices: DeviceRow[];
  busy: boolean;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  async function patchDevice(deviceId: string, action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/devices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, action, ...extra })
      });
      const payload = (await response.json()) as ApiEnvelope<{ device: DeviceRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Device update failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Device update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Device</th>
            <th style={thStyle}>Branch</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Lock</th>
            <th style={thStyle}>Last Seen</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id}>
              <td style={tdStyle}>{device.device_name} ({device.device_code})</td>
              <td style={tdStyle}>{device.branch_id}</td>
              <td style={tdStyle}>{device.status}</td>
              <td style={tdStyle}>{device.lock_mode}</td>
              <td style={tdStyle}>{formatDateTime(device.last_seen_at)}</td>
              <td style={tdStyle}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void patchDevice(device.id, "approve")}>Approve</button>
                  <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void patchDevice(device.id, "activate")}>Activate</button>
                  <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void patchDevice(device.id, "deactivate")}>Deactivate</button>
                  <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void patchDevice(device.id, "block")}>Block</button>
                  <Link className="pos-monitor-btn" href={`/tenants/${tenantId}/devices/${device.id}/health`}>Health</Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PoliciesPane({
  tenantId,
  policies,
  branches,
  busy,
  onChanged,
  setError,
  setBusy
}: {
  tenantId: string;
  policies: PolicyRow[];
  branches: BranchRow[];
  busy: boolean;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  const [branchId, setBranchId] = useState("");
  const [requireRegistered, setRequireRegistered] = useState(true);
  const [allowPin, setAllowPin] = useState(true);
  const [allowCard, setAllowCard] = useState(true);
  const [allowMulti, setAllowMulti] = useState(false);
  const [maxDevices, setMaxDevices] = useState(1);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/login-policies`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch_id: branchId,
          require_registered_device: requireRegistered,
          allow_pin_login: allowPin,
          allow_staff_card_login: allowCard,
          allow_multi_device: allowMulti,
          max_devices: maxDevices
        })
      });
      const payload = (await response.json()) as ApiEnvelope<{ policy: PolicyRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Policy update failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Policy update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
          <option value="">Select branch</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </select>
        <label><input type="checkbox" checked={requireRegistered} onChange={(event) => setRequireRegistered(event.target.checked)} /> require_registered_device</label>
        <label><input type="checkbox" checked={allowPin} onChange={(event) => setAllowPin(event.target.checked)} /> allow_pin_login</label>
        <label><input type="checkbox" checked={allowCard} onChange={(event) => setAllowCard(event.target.checked)} /> allow_staff_card_login</label>
        <label><input type="checkbox" checked={allowMulti} onChange={(event) => setAllowMulti(event.target.checked)} /> allow_multi_device</label>
        <input type="number" min={1} value={maxDevices} onChange={(event) => setMaxDevices(Math.max(1, Number(event.target.value || 1)))} style={{ width: 100 }} />
        <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" disabled={busy || !branchId} onClick={() => void save()}>
          Save
        </button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Branch</th>
            <th style={thStyle}>Policy</th>
          </tr>
        </thead>
        <tbody>
          {policies.map((policy) => (
            <tr key={policy.id}>
              <td style={tdStyle}>{policy.branch_id}</td>
              <td style={tdStyle}>
                pin:{String(policy.allow_pin_login)} | card:{String(policy.allow_staff_card_login)} | reg:{String(policy.require_registered_device)} | multi:{String(policy.allow_multi_device)} | max:{policy.max_devices}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SessionsPane({
  tenantId,
  sessions,
  busy,
  onChanged,
  setError,
  setBusy
}: {
  tenantId: string;
  sessions: SessionRow[];
  busy: boolean;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  async function revoke(sessionId: string) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/sessions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, action: "revoke" })
      });
      const payload = (await response.json()) as ApiEnvelope<{ session: SessionRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Revoke session failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Revoke session failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={thStyle}>Session</th>
          <th style={thStyle}>Branch/User</th>
          <th style={thStyle}>Role</th>
          <th style={thStyle}>Expires</th>
          <th style={thStyle}>Action</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((session) => (
          <tr key={session.id}>
            <td style={tdStyle}>{session.id.slice(0, 8)}... ({session.status})</td>
            <td style={tdStyle}>{session.branch_id}<br />{session.user_id}</td>
            <td style={tdStyle}>{session.role}</td>
            <td style={tdStyle}>{formatDateTime(session.expires_at)}</td>
            <td style={tdStyle}>
              <button type="button" className="pos-monitor-btn" disabled={busy || session.status === "revoked"} onClick={() => void revoke(session.id)}>
                Revoke
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShiftsPane({
  tenantId,
  shifts,
  busy,
  onChanged,
  setError,
  setBusy
}: {
  tenantId: string;
  shifts: ShiftRow[];
  busy: boolean;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  async function patchShift(shiftId: string, action: "close" | "suspend") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/shifts`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shift_id: shiftId, action })
      });
      const payload = (await response.json()) as ApiEnvelope<{ shift: ShiftRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Shift update failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Shift update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th style={thStyle}>Shift</th>
          <th style={thStyle}>Branch</th>
          <th style={thStyle}>Opened</th>
          <th style={thStyle}>Status</th>
          <th style={thStyle}>Action</th>
        </tr>
      </thead>
      <tbody>
        {shifts.map((shift) => (
          <tr key={shift.id}>
            <td style={tdStyle}>{shift.id.slice(0, 8)}...</td>
            <td style={tdStyle}>{shift.branch_id}</td>
            <td style={tdStyle}>{formatDateTime(shift.opened_at)}</td>
            <td style={tdStyle}>{shift.status}</td>
            <td style={tdStyle}>
              <div style={{ display: "flex", gap: 6 }}>
                <button type="button" className="pos-monitor-btn" disabled={busy || shift.status === "closed"} onClick={() => void patchShift(shift.id, "close")}>
                  Close
                </button>
                <button type="button" className="pos-monitor-btn" disabled={busy || shift.status === "suspended"} onClick={() => void patchShift(shift.id, "suspend")}>
                  Suspend
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FeaturesPane({
  tenantId,
  features,
  plans,
  activeContract,
  quotaLimits,
  branchId,
  busy,
  onChanged,
  setError,
  setBusy
}: {
  tenantId: string;
  features: FeatureRow[];
  plans: PlanRow[];
  activeContract: ContractRow | null;
  quotaLimits: QuotaLimits | null;
  branchId: string | null;
  busy: boolean;
  onChanged: () => void;
  setError: (message: string | null) => void;
  setBusy: (value: boolean) => void;
}) {
  const [planId, setPlanId] = useState("");
  const [contractStatus, setContractStatus] = useState<"trial" | "active" | "suspended" | "expired" | "cancelled">("active");
  const [maxBranches, setMaxBranches] = useState<number>(1);
  const [maxDevices, setMaxDevices] = useState<number>(1);
  const [maxUsers, setMaxUsers] = useState<number>(10);

  useEffect(() => {
    setPlanId(activeContract?.package_id ?? "");
    setContractStatus((activeContract?.status as "trial" | "active" | "suspended" | "expired" | "cancelled") ?? "active");
    setMaxBranches(activeContract?.max_branches ?? quotaLimits?.maxBranches ?? 1);
    setMaxDevices(activeContract?.max_devices ?? quotaLimits?.maxDevices ?? 1);
    setMaxUsers(activeContract?.max_users ?? quotaLimits?.maxUsers ?? 10);
  }, [activeContract, quotaLimits]);

  async function toggleFeature(feature: FeatureRow) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/features`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feature_code: feature.code, is_enabled: !feature.is_enabled, branch_id: branchId })
      });
      const payload = (await response.json()) as ApiEnvelope<{ feature: unknown }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Feature update failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Feature update failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveContract() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/it-admin/admin/tenants/${tenantId}/contract`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          status: contractStatus,
          max_branches: maxBranches,
          max_devices: maxDevices,
          max_users: maxUsers
        })
      });
      const payload = (await response.json()) as ApiEnvelope<{ contract: ContractRow }>;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Contract update failed.");
      }
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Contract update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
        <strong>Active Contract</strong>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <select value={planId} onChange={(event) => setPlanId(event.target.value)}>
            <option value="">Select plan</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.name} ({plan.code})
              </option>
            ))}
          </select>
          <select value={contractStatus} onChange={(event) => setContractStatus(event.target.value as "trial" | "active" | "suspended" | "expired" | "cancelled")}>
            <option value="trial">trial</option>
            <option value="active">active</option>
            <option value="suspended">suspended</option>
            <option value="expired">expired</option>
            <option value="cancelled">cancelled</option>
          </select>
          <input type="number" min={1} value={maxBranches} onChange={(event) => setMaxBranches(Math.max(1, Number(event.target.value || 1)))} placeholder="max branches" />
          <input type="number" min={1} value={maxDevices} onChange={(event) => setMaxDevices(Math.max(1, Number(event.target.value || 1)))} placeholder="max devices" />
          <input type="number" min={1} value={maxUsers} onChange={(event) => setMaxUsers(Math.max(1, Number(event.target.value || 1)))} placeholder="max users" />
          <button type="button" className="pos-monitor-btn pos-monitor-btn--primary" disabled={busy || !planId} onClick={() => void saveContract()}>
            Save Contract
          </button>
        </div>
        <div style={{ color: "#475569", fontSize: 13 }}>
          <div>Contract status: {activeContract?.status ?? "-"}</div>
          <div>
            Quota usage: branches {quotaLimits?.usage.branches ?? 0}/{quotaLimits?.maxBranches ?? "-"} | devices {quotaLimits?.usage.devices ?? 0}/{quotaLimits?.maxDevices ?? "-"} | users {quotaLimits?.usage.users ?? 0}/{quotaLimits?.maxUsers ?? "-"}
          </div>
        </div>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>Feature</th>
            <th style={thStyle}>Description</th>
            <th style={thStyle}>State</th>
            <th style={thStyle}>Action</th>
          </tr>
        </thead>
        <tbody>
          {features.map((feature) => (
            <tr key={feature.code}>
              <td style={tdStyle}>{feature.name} ({feature.code})</td>
              <td style={tdStyle}>{feature.description}</td>
              <td style={tdStyle}>{feature.is_enabled ? "enabled" : "disabled"} ({feature.source})</td>
              <td style={tdStyle}>
                <button type="button" className="pos-monitor-btn" disabled={busy} onClick={() => void toggleFeature(feature)}>
                  {feature.is_enabled ? "Disable" : "Enable"}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const thStyle: CSSProperties = {
  textAlign: "left",
  borderBottom: "1px solid #e2e8f0",
  padding: "8px 6px"
};

const tdStyle: CSSProperties = {
  borderBottom: "1px solid #f1f5f9",
  padding: "8px 6px",
  verticalAlign: "top"
};
