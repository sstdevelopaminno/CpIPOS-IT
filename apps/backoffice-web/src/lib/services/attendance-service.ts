import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase-admin";
import type { PosSessionScope } from "@/lib/pos-session-guard";

export type AttendanceStatus =
  | "scheduled"
  | "checked_in"
  | "late"
  | "absent"
  | "on_leave"
  | "checked_out"
  | "manual_adjusted";

export type AttendanceSummary = {
  checkedIn: number;
  late: number;
  absent: number;
  onLeave: number;
  total: number;
};

export type AttendanceStaffItem = {
  user_id: string;
  full_name: string;
  role: string | null;
  attendance_status: AttendanceStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  late_minutes: number;
  note: string | null;
};

type AttendanceRecordRow = {
  user_id: string;
  status: AttendanceStatus;
  checked_in_at: string | null;
  checked_out_at: string | null;
  late_minutes: number | null;
  note: string | null;
};

type LeaveRow = {
  user_id: string;
  status: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function todayDateIso() {
  return nowIso().slice(0, 10);
}

export function computeLateMinutes(scheduledStartAt: string | null, checkedInAt: string): number {
  if (!scheduledStartAt) return 0;
  const scheduled = new Date(scheduledStartAt).getTime();
  const checked = new Date(checkedInAt).getTime();
  if (!Number.isFinite(scheduled) || !Number.isFinite(checked) || checked <= scheduled) return 0;
  return Math.max(0, Math.floor((checked - scheduled) / 60000));
}

export function summarizeAttendance(items: AttendanceStaffItem[]): AttendanceSummary {
  const summary: AttendanceSummary = {
    checkedIn: 0,
    late: 0,
    absent: 0,
    onLeave: 0,
    total: items.length
  };

  for (const item of items) {
    if (item.attendance_status === "late") {
      summary.late += 1;
      summary.checkedIn += 1;
      continue;
    }
    if (item.attendance_status === "checked_in" || item.attendance_status === "checked_out") {
      summary.checkedIn += 1;
      continue;
    }
    if (item.attendance_status === "on_leave") {
      summary.onLeave += 1;
      continue;
    }
    if (item.attendance_status === "absent") {
      summary.absent += 1;
      continue;
    }
  }

  return summary;
}

export async function resolveBranchStaff(args: { tenantId: string; branchId: string }) {
  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("user_branch_roles")
    .select("user_id,role,users_profiles!inner(full_name,is_active)")
    .eq("tenant_id", args.tenantId)
    .eq("branch_id", args.branchId);

  if (error) {
    return { staff: [], error: error.message };
  }

  const staff = (data ?? [])
    .map((row) => {
      const profile = row.users_profiles as { full_name?: string | null; is_active?: boolean | null } | null;
      if (!profile || profile.is_active === false) return null;
      return {
        user_id: String(row.user_id),
        role: typeof row.role === "string" ? row.role : null,
        full_name: String(profile.full_name ?? row.user_id)
      };
    })
    .filter((row): row is { user_id: string; role: string | null; full_name: string } => Boolean(row));

  return { staff };
}

export async function loadAttendanceRows(args: {
  tenantId: string;
  branchId: string;
  attendanceDate: string;
  userIds: string[];
}) {
  if (args.userIds.length === 0) return { records: [] as AttendanceRecordRow[], leaves: [] as LeaveRow[] };
  const supabase = getSupabaseServiceClient();
  const [recordsResult, leavesResult] = await Promise.all([
    supabase
      .from("staff_attendance_records")
      .select("user_id,status,checked_in_at,checked_out_at,late_minutes,note")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .eq("attendance_date", args.attendanceDate)
      .in("user_id", args.userIds),
    supabase
      .from("staff_leave_requests")
      .select("user_id,status")
      .eq("tenant_id", args.tenantId)
      .eq("branch_id", args.branchId)
      .eq("status", "approved")
      .lte("start_date", args.attendanceDate)
      .gte("end_date", args.attendanceDate)
      .in("user_id", args.userIds)
  ]);

  return {
    records: (recordsResult.data ?? []) as AttendanceRecordRow[],
    leaves: (leavesResult.data ?? []) as LeaveRow[]
  };
}

export async function resolveAttendanceStatus(args: {
  scope: PosSessionScope;
  attendanceDate?: string;
}): Promise<{ summary: AttendanceSummary; staff: AttendanceStaffItem[]; canViewAllBranch: boolean; canManage: boolean }> {
  const canViewAllBranch = args.scope.permissions.includes("attendance:view_all_branch");
  const canManage = args.scope.permissions.includes("attendance:manage");
  const attendanceDate = args.attendanceDate ?? todayDateIso();

  if (!canViewAllBranch) {
    const { records, leaves } = await loadAttendanceRows({
      tenantId: args.scope.session.tenant_id,
      branchId: args.scope.session.branch_id,
      attendanceDate,
      userIds: [args.scope.session.user_id]
    });
    const ownRecord = records[0];
    const onLeave = leaves.some((row) => row.user_id === args.scope.session.user_id && row.status === "approved");
    const attendanceStatus: AttendanceStatus = onLeave ? "on_leave" : (ownRecord?.status ?? "absent");

    const ownItem: AttendanceStaffItem = {
      user_id: args.scope.session.user_id,
      full_name: args.scope.user.full_name ?? args.scope.session.user_id,
      role: args.scope.session.role,
      attendance_status: attendanceStatus,
      checked_in_at: ownRecord?.checked_in_at ?? null,
      checked_out_at: ownRecord?.checked_out_at ?? null,
      late_minutes: Number(ownRecord?.late_minutes ?? 0),
      note: ownRecord?.note ?? null
    };
    return {
      summary: summarizeAttendance([ownItem]),
      staff: [ownItem],
      canViewAllBranch,
      canManage
    };
  }

  const { staff: branchStaff, error } = await resolveBranchStaff({
    tenantId: args.scope.session.tenant_id,
    branchId: args.scope.session.branch_id
  });
  if (error) {
    throw new Error(error);
  }
  const { records, leaves } = await loadAttendanceRows({
    tenantId: args.scope.session.tenant_id,
    branchId: args.scope.session.branch_id,
    attendanceDate,
    userIds: branchStaff.map((item) => item.user_id)
  });

  const recordByUser = new Map(records.map((row) => [row.user_id, row]));
  const leaveUserIds = new Set(leaves.filter((row) => row.status === "approved").map((row) => row.user_id));

  const staffItems: AttendanceStaffItem[] = branchStaff.map((staff) => {
    const record = recordByUser.get(staff.user_id);
    const onLeave = leaveUserIds.has(staff.user_id);
    const attendanceStatus: AttendanceStatus = onLeave ? "on_leave" : (record?.status ?? "absent");
    return {
      user_id: staff.user_id,
      full_name: staff.full_name,
      role: staff.role,
      attendance_status: attendanceStatus,
      checked_in_at: record?.checked_in_at ?? null,
      checked_out_at: record?.checked_out_at ?? null,
      late_minutes: Number(record?.late_minutes ?? 0),
      note: record?.note ?? null
    };
  });

  return {
    summary: summarizeAttendance(staffItems),
    staff: staffItems,
    canViewAllBranch,
    canManage
  };
}

export async function upsertAttendanceRecord(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  attendanceDate: string;
  status: AttendanceStatus;
  source?: string;
  note?: string | null;
  checkedInAt?: string | null;
  checkedOutAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  lateMinutes?: number;
  approvedBy?: string | null;
}) {
  const supabase = getSupabaseServiceClient();
  const payload = {
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    user_id: input.userId,
    attendance_date: input.attendanceDate,
    status: input.status,
    source: input.source ?? "system",
    note: input.note ?? null,
    checked_in_at: input.checkedInAt ?? null,
    checked_out_at: input.checkedOutAt ?? null,
    scheduled_start_at: input.scheduledStartAt ?? null,
    scheduled_end_at: input.scheduledEndAt ?? null,
    late_minutes: Math.max(0, Number(input.lateMinutes ?? 0)),
    approved_by: input.approvedBy ?? null
  };

  const { data, error } = await supabase
    .from("staff_attendance_records")
    .upsert(payload, { onConflict: "tenant_id,branch_id,user_id,attendance_date" })
    .select("id,status,checked_in_at,checked_out_at,late_minutes,attendance_date")
    .single<{
      id: string;
      status: AttendanceStatus;
      checked_in_at: string | null;
      checked_out_at: string | null;
      late_minutes: number;
      attendance_date: string;
    }>();

  if (error || !data) {
    throw new Error(error?.message ?? "Cannot upsert attendance record.");
  }
  return data;
}

export async function writeAttendanceEvent(input: {
  tenantId: string;
  branchId: string;
  userId: string;
  eventType: string;
  deviceCode?: string | null;
  shiftId?: string | null;
  posSessionId?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const supabase = getSupabaseServiceClient();
  await supabase.from("staff_attendance_events").insert({
    tenant_id: input.tenantId,
    branch_id: input.branchId,
    user_id: input.userId,
    event_type: input.eventType,
    event_at: nowIso(),
    device_code: input.deviceCode ?? null,
    shift_id: input.shiftId ?? null,
    pos_session_id: input.posSessionId ?? null,
    metadata: input.metadata ?? {}
  });
}
