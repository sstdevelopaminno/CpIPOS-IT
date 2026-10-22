"use client";

import Image from "next/image";
import { formatVoiceDuration, type SupportVoicePhase } from "@/components/support/use-support-voice-call";

type CallMode = "incoming" | "outgoing" | "active";

export type SupportVoiceTransferTarget = {
  id: string;
  full_name: string;
  avatar_url?: string;
  platform_role: "it_admin" | "it_support";
};

type SupportVoiceCallOverlayProps = {
  open: boolean;
  mode: CallMode;
  incomingLabel?: string;
  counterpartyName: string;
  counterpartyDetail?: string;
  phase: SupportVoicePhase;
  error?: string;
  busy?: boolean;
  canStart?: boolean;
  micMuted?: boolean;
  speakerMuted?: boolean;
  needsAudioResume?: boolean;
  elapsedSeconds?: number;
  held?: boolean;
  holdLabel?: string;
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
  onStart?: () => void;
  onEnd?: () => void;
  onToggleMic?: () => void;
  onToggleSpeaker?: () => void;
  onResumeAudio?: () => void;
  onOpenExternalBrowser?: () => void;
  allowMinimize?: boolean;
  minimized?: boolean;
  onMinimize?: () => void;
  onRestore?: () => void;
  canTransfer?: boolean;
  transferPending?: boolean;
  transferTargetLabel?: string;
  transferPickerOpen?: boolean;
  transferTargetsLoading?: boolean;
  transferDepartments?: Array<{ role: "it_admin" | "it_support"; label: string }>;
  transferTargets?: SupportVoiceTransferTarget[];
  onOpenTransfer?: () => void;
  onCloseTransfer?: () => void;
  onTransferToDepartment?: (role: "it_admin" | "it_support", label: string) => void;
  onTransferToUser?: (target: SupportVoiceTransferTarget) => void;
  onCancelTransfer?: () => void;
};

function phaseText(phase: SupportVoicePhase) {
  if (phase === "requesting_mic") return "กำลังขอสิทธิ์ไมโครโฟน…";
  if (phase === "waiting_peer") return "กำลังรออีกฝ่ายเชื่อมต่อเสียง…";
  if (phase === "connecting") return "กำลังเชื่อมต่อสาย…";
  if (phase === "reconnecting") return "สัญญาณสะดุด · กำลังเชื่อมต่อใหม่อัตโนมัติ…";
  if (phase === "connected") return "เชื่อมต่อแล้ว";
  if (phase === "failed") return "ยังเชื่อมต่อเสียงไม่ได้";
  return "พร้อมเริ่มการคุยด้วยเสียง";
}

function roleLabel(role: "it_admin" | "it_support") {
  return role === "it_admin" ? "Admin IT" : "Support IT";
}

function RoundButton({
  label,
  symbol,
  tone,
  disabled,
  onClick
}: {
  label: string;
  symbol: string;
  tone: "green" | "red" | "dark" | "light" | "blue";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const toneClass = tone === "green"
    ? "bg-emerald-500 text-white"
    : tone === "red"
      ? "bg-red-500 text-white"
      : tone === "blue"
        ? "bg-blue-500 text-white"
        : tone === "light"
          ? "bg-white/15 text-white"
          : "bg-slate-800 text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-[68px] flex-col items-center gap-2 text-[11px] font-bold text-white disabled:opacity-40"
    >
      <span className={"grid h-14 w-14 place-items-center rounded-full text-xl shadow-lg transition active:scale-95 " + toneClass}>
        {symbol}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function SupportVoiceCallOverlay({
  open,
  mode,
  incomingLabel,
  counterpartyName,
  counterpartyDetail,
  phase,
  error,
  busy = false,
  canStart = false,
  micMuted = false,
  speakerMuted = false,
  needsAudioResume = false,
  elapsedSeconds = 0,
  held = false,
  holdLabel,
  onAccept,
  onDecline,
  onCancel,
  onStart,
  onEnd,
  onToggleMic,
  onToggleSpeaker,
  onResumeAudio,
  onOpenExternalBrowser,
  allowMinimize = false,
  minimized = false,
  onMinimize,
  onRestore,
  canTransfer = false,
  transferPending = false,
  transferTargetLabel,
  transferPickerOpen = false,
  transferTargetsLoading = false,
  transferDepartments = [],
  transferTargets = [],
  onOpenTransfer,
  onCloseTransfer,
  onTransferToDepartment,
  onTransferToUser,
  onCancelTransfer
}: SupportVoiceCallOverlayProps) {
  if (!open) return null;

  const connected = phase === "connected";
  const micBlocked = Boolean(error?.includes("ไมโครโฟน") || error?.includes("อนุญาต"));
  const transferText = transferTargetLabel ? `กำลังโอนไปยัง ${transferTargetLabel}` : "กำลังรอผู้รับโอนสาย";

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-[120] w-[min(94vw,390px)] rounded-3xl border border-slate-700 bg-slate-950 p-4 text-white shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-white">
            <Image src="/brand/cpipos-symbol-sidebar.png" alt="" width={34} height={34} className="h-8 w-8 object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-black">{counterpartyName}</div>
            <div className="mt-0.5 text-xs text-white/50">
              {transferPending
                ? "พักสายลูกค้า · " + transferText
                : held
                  ? "พักสาย · " + (holdLabel || "กำลังโอนสาย")
                  : connected
                    ? "กำลังคุย · " + formatVoiceDuration(elapsedSeconds)
                    : phaseText(phase)}
            </div>
          </div>
          <button
            type="button"
            onClick={onRestore}
            className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white"
          >
            ขยาย
          </button>
        </div>

        <div className={"mt-4 grid gap-2 " + (canTransfer || transferPending ? "grid-cols-4" : "grid-cols-3")}>
          <button type="button" onClick={onToggleMic} className="rounded-2xl bg-white/10 px-2 py-3 text-[11px] font-black">
            {micMuted ? "🎙 เปิดไมค์" : "🔇 ปิดไมค์"}
          </button>
          <button type="button" onClick={onToggleSpeaker} className="rounded-2xl bg-white/10 px-2 py-3 text-[11px] font-black">
            {speakerMuted ? "🔊 เปิดเสียง" : "🔈 ลำโพง"}
          </button>
          {canTransfer || transferPending ? (
            <button
              type="button"
              onClick={transferPending ? onCancelTransfer : onOpenTransfer}
              disabled={busy}
              className="rounded-2xl bg-blue-500 px-2 py-3 text-[11px] font-black disabled:opacity-50"
            >
              {transferPending ? "↩ ยกเลิกโอน" : "⇄ โอนสาย"}
            </button>
          ) : null}
          <button type="button" onClick={onEnd} disabled={busy} className="rounded-2xl bg-red-500 px-2 py-3 text-[11px] font-black text-white disabled:opacity-50">
            ☎ วางสาย
          </button>
        </div>

        <div className="mt-3 text-center text-[10px] text-white/35">
          สายยังเชื่อมต่ออยู่ สามารถเปิดเมนูอื่นในระบบ IT ได้
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]">
        <div className="relative flex items-center justify-center">
          <div className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-bold tracking-wide text-white/80">
            CpIPOS Support Voice
          </div>
          {allowMinimize ? (
            <button
              type="button"
              onClick={onMinimize}
              className="absolute right-0 rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs font-black text-white"
            >
              ย่อหน้าสาย
            </button>
          ) : null}
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-8 text-center">
          <div className="relative">
            <div className={"absolute inset-0 rounded-full blur-2xl " + (held || transferPending ? "bg-amber-400/25" : connected ? "bg-emerald-400/30" : "bg-blue-400/25")} />
            <div className="relative grid h-32 w-32 place-items-center rounded-full border border-white/15 bg-white shadow-2xl">
              <Image
                src="/brand/cpipos-symbol-sidebar.png"
                alt="CpIPOS Support"
                width={92}
                height={92}
                className="h-20 w-20 object-contain"
              />
            </div>
          </div>

          <h2 className="mt-8 max-w-sm text-3xl font-black leading-tight">{counterpartyName}</h2>
          {counterpartyDetail ? <p className="mt-2 max-w-sm text-sm text-white/60">{counterpartyDetail}</p> : null}

          <div className="mt-5 text-base font-bold text-white/85">
            {mode === "incoming"
              ? incomingLabel || "สายเรียกเข้า"
              : mode === "outgoing"
                ? "กำลังโทรหา…"
                : held
                  ? "พักสาย · " + (holdLabel || "กำลังโอนสาย")
                  : transferPending
                    ? "พักสายลูกค้า · " + transferText
                    : connected
                      ? formatVoiceDuration(elapsedSeconds)
                      : phaseText(phase)}
          </div>

          {mode === "active" && !connected && !held ? (
            <div className="mt-2 text-sm text-white/55">{phaseText(phase)}</div>
          ) : null}

          {transferPending ? (
            <div className="mt-5 w-full max-w-md rounded-3xl border border-blue-300/20 bg-blue-500/10 px-5 py-4 text-left">
              <div className="text-sm font-black text-blue-100">⏸️ ลูกค้าถูกพักสายแล้ว</div>
              <div className="mt-1 text-sm leading-6 text-blue-100/85">
                {transferText} · เมื่อผู้รับคนใหม่กดรับ ระบบจะสร้างการเชื่อมต่อเสียงใหม่และปล่อยผู้รับคนเดิมออกจากสาย
              </div>
              {onCancelTransfer ? (
                <button
                  type="button"
                  onClick={onCancelTransfer}
                  disabled={busy}
                  className="mt-3 rounded-2xl bg-white px-4 py-2.5 text-xs font-black text-slate-950 disabled:opacity-50"
                >
                  ยกเลิกการโอนและกลับมาคุยต่อ
                </button>
              ) : null}
            </div>
          ) : null}

          {held ? (
            <div className="mt-5 w-full max-w-md rounded-3xl border border-amber-300/20 bg-amber-500/10 px-5 py-4 text-left">
              <div className="text-sm font-black text-amber-100">🎵 กำลังพักสาย</div>
              <div className="mt-1 text-sm leading-6 text-amber-100/85">
                กรุณารอสักครู่ ระบบกำลังส่งต่อให้เจ้าหน้าที่ที่รับผิดชอบ และเปิดเสียงดนตรีพักสายบนอุปกรณ์ของคุณ
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 w-full max-w-md rounded-3xl border border-red-300/20 bg-red-500/10 px-5 py-4 text-left">
              <div className="text-sm font-black text-red-100">ยังเปิดเสียงไม่ได้</div>
              <div className="mt-1 text-sm leading-6 text-red-100/90">{error}</div>
              {micBlocked ? (
                <div className="mt-2 space-y-2 text-xs leading-5 text-white/70">
                  <div>
                    Android: การตั้งค่าเครื่อง → แอป → LINE → สิทธิ์ → ไมโครโฟน → อนุญาต
                    <br />
                    คอมพิวเตอร์: กดไอคอนด้านซ้ายของ URL → Microphone → Allow
                  </div>
                  {onOpenExternalBrowser ? (
                    <button
                      type="button"
                      onClick={onOpenExternalBrowser}
                      className="mt-2 w-full rounded-2xl bg-white px-4 py-3 text-sm font-black text-slate-950"
                    >
                      เปิดสายเสียงในเบราว์เซอร์
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {needsAudioResume && !held ? (
            <button
              type="button"
              onClick={onResumeAudio}
              className="mt-5 rounded-full bg-white px-5 py-3 text-sm font-black text-slate-900"
            >
              🔊 แตะเพื่อเปิดเสียงคู่สนทนา
            </button>
          ) : null}
        </div>

        {mode === "incoming" ? (
          onDecline ? (
            <div className="mx-auto flex w-full max-w-sm items-end justify-around gap-8 pb-4">
              <RoundButton label="ปฏิเสธ" symbol="✕" tone="red" disabled={busy} onClick={onDecline} />
              <RoundButton label="รับสาย" symbol="☎" tone="green" disabled={busy} onClick={onAccept} />
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-sm justify-center pb-4">
              <RoundButton label="รับสาย" symbol="☎" tone="green" disabled={busy} onClick={onAccept} />
            </div>
          )
        ) : mode === "outgoing" ? (
          <div className="mx-auto flex w-full max-w-sm justify-center pb-4">
            <RoundButton label="ยกเลิก" symbol="☎" tone="red" disabled={busy} onClick={onCancel} />
          </div>
        ) : connected ? (
          <div className={"mx-auto grid w-full max-w-md gap-4 pb-4 " + (canTransfer || transferPending ? "grid-cols-4" : "grid-cols-3")}>
            <RoundButton
              label={micMuted ? "เปิดไมค์" : "ปิดไมค์"}
              symbol={micMuted ? "🎙" : "🔇"}
              tone="light"
              onClick={onToggleMic}
            />
            <RoundButton
              label={speakerMuted ? "เปิดเสียง" : "ลำโพง"}
              symbol="🔊"
              tone="light"
              onClick={onToggleSpeaker}
            />
            {canTransfer || transferPending ? (
              <RoundButton
                label={transferPending ? "ยกเลิกโอน" : "โอนสาย"}
                symbol={transferPending ? "↩" : "⇄"}
                tone="blue"
                disabled={busy}
                onClick={transferPending ? onCancelTransfer : onOpenTransfer}
              />
            ) : null}
            <RoundButton label="วางสาย" symbol="☎" tone="red" disabled={busy} onClick={onEnd} />
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-sm items-end justify-around gap-6 pb-4">
            <RoundButton label="วางสาย" symbol="☎" tone="red" disabled={busy} onClick={onEnd} />
            <RoundButton
              label={phase === "failed" ? "ลองใหม่" : "เปิดไมค์"}
              symbol="🎙"
              tone="green"
              disabled={busy || !canStart || !["idle", "failed"].includes(phase)}
              onClick={onStart}
            />
          </div>
        )}

        <div className="pt-3 text-center text-[11px] text-white/35">
          เสียงสนทนาและเสียงพักสายไม่ถูกบันทึกลงระบบ
        </div>
      </div>

      {transferPickerOpen ? (
        <div className="fixed inset-0 z-[140] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="max-h-[82dvh] w-full max-w-lg overflow-hidden rounded-[30px] bg-white text-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <div className="text-lg font-black">โอนสาย</div>
                <div className="mt-1 text-xs text-slate-500">เลือกแผนกหรือพนักงานที่จะรับช่วงต่อ</div>
              </div>
              <button type="button" onClick={onCloseTransfer} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-black">
                ✕
              </button>
            </div>

            <div className="max-h-[calc(82dvh-92px)] overflow-y-auto p-5">
              {transferTargetsLoading ? (
                <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
                  กำลังโหลดผู้รับโอน…
                </div>
              ) : (
                <>
                  <div className="text-xs font-black uppercase tracking-wide text-slate-400">โอนไปทั้งแผนก</div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    {transferDepartments.map((department) => (
                      <button
                        key={department.role}
                        type="button"
                        onClick={() => onTransferToDepartment?.(department.role, department.label)}
                        disabled={busy}
                        className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 text-left disabled:opacity-50"
                      >
                        <div className="text-sm font-black">{department.label}</div>
                        <div className="mt-1 text-xs text-slate-500">เจ้าหน้าที่ว่างคนแรกในแผนกรับต่อ</div>
                      </button>
                    ))}
                  </div>

                  <div className="mt-6 text-xs font-black uppercase tracking-wide text-slate-400">โอนไปพนักงานรายบุคคล</div>
                  <div className="mt-3 space-y-2">
                    {transferTargets.length ? transferTargets.map((target) => (
                      <button
                        key={target.id}
                        type="button"
                        onClick={() => onTransferToUser?.(target)}
                        disabled={busy}
                        className="flex w-full items-center gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left disabled:opacity-50"
                      >
                        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-100 text-sm font-black">
                          {target.full_name.slice(0, 1).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-black">{target.full_name}</div>
                          <div className="text-xs text-slate-500">{roleLabel(target.platform_role)}</div>
                        </div>
                        <div className="text-lg text-slate-400">›</div>
                      </button>
                    )) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                        ยังไม่มีพนักงานอื่นที่เปิดใช้งาน
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
