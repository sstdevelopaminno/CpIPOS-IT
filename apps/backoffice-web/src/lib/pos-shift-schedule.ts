export type ShiftSlot = "morning" | "afternoon" | "night";
export type ShiftGuardPhase = "on_time" | "overdue" | "urgent" | "auto_close";

export type ShiftCycle = {
  slot: ShiftSlot;
  openedAt: Date;
  endAt: Date;
  warningAt: Date;
  autoCloseAt: Date;
  nextSlot: ShiftSlot;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function withTime(base: Date, hours: number, minutes: number) {
  const d = new Date(base);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function addMinutes(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60 * 1000);
}

export function resolveShiftCycle(openedAtRaw: string | Date): ShiftCycle | null {
  const openedAt = openedAtRaw instanceof Date ? openedAtRaw : new Date(openedAtRaw);
  if (Number.isNaN(openedAt.valueOf())) return null;

  const dayStart = startOfDay(openedAt);
  const openedHour = openedAt.getHours();

  if (openedHour < 12) {
    const endAt = withTime(dayStart, 13, 0);
    return {
      slot: "morning",
      openedAt,
      endAt,
      warningAt: addMinutes(endAt, 30),
      autoCloseAt: addMinutes(endAt, 45),
      nextSlot: "afternoon"
    };
  }

  if (openedHour < 18) {
    const endAt = withTime(dayStart, 18, 0);
    return {
      slot: "afternoon",
      openedAt,
      endAt,
      warningAt: addMinutes(endAt, 30),
      autoCloseAt: addMinutes(endAt, 45),
      nextSlot: "night"
    };
  }

  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);
  const endAt = withTime(nextDay, 0, 0);
  const warningAt = withTime(nextDay, 0, 30);
  const autoCloseAt = withTime(nextDay, 0, 45);
  return {
    slot: "night",
    openedAt,
    endAt,
    warningAt,
    autoCloseAt,
    nextSlot: "morning"
  };
}

export function resolveShiftGuardPhase(cycle: ShiftCycle, now = new Date()): ShiftGuardPhase {
  if (now < cycle.endAt) return "on_time";
  if (now < cycle.warningAt) return "overdue";
  if (now < cycle.autoCloseAt) return "urgent";
  return "auto_close";
}

export function slotLabel(slot: ShiftSlot, lang: "th" | "en") {
  if (lang === "th") {
    if (slot === "morning") return "กะเช้า";
    if (slot === "afternoon") return "กะบ่าย";
    return "กะดึก";
  }
  if (slot === "morning") return "Morning Shift";
  if (slot === "afternoon") return "Afternoon Shift";
  return "Night Shift";
}

export function slotWindowLabel(slot: ShiftSlot, lang: "th" | "en") {
  if (lang === "th") {
    if (slot === "morning") return "00:00 - 12:59";
    if (slot === "afternoon") return "13:00 - 17:59";
    return "18:00 - 23:59";
  }
  if (slot === "morning") return "00:00 - 12:59";
  if (slot === "afternoon") return "13:00 - 17:59";
  return "18:00 - 23:59";
}
