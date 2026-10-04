"use client";

import Image from "next/image";
import { formatVoiceDuration, type SupportVoicePhase } from "@/components/support/use-support-voice-call";

type CallMode = "incoming" | "outgoing" | "active";

type SupportVoiceCallOverlayProps = {
  open: boolean;
  mode: CallMode;
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
  onAccept?: () => void;
  onDecline?: () => void;
  onCancel?: () => void;
  onStart?: () => void;
  onEnd?: () => void;
  onToggleMic?: () => void;
  onToggleSpeaker?: () => void;
  onResumeAudio?: () => void;
  onOpenExternalBrowser?: () => void;
};

function phaseText(phase: SupportVoicePhase) {
  if (phase === "requesting_mic") return "กำลังขอสิทธิ์ไมโครโฟน…";
  if (phase === "waiting_peer") return "กำลังรออีกฝ่ายเชื่อมต่อเสียง…";
  if (phase === "connecting") return "กำลังเชื่อมต่อสาย…";
  if (phase === "reconnecting") return "สัญญาณสะดุด · กำลังเชื่อมต่อใหม่…";
  if (phase === "connected") return "เชื่อมต่อแล้ว";
  if (phase === "failed") return "ยังเชื่อมต่อเสียงไม่ได้";
  return "พร้อมเริ่มการคุยด้วยเสียง";
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
  tone: "green" | "red" | "dark" | "light";
  disabled?: boolean;
  onClick?: () => void;
}) {
  const toneClass = tone === "green"
    ? "bg-emerald-500 text-white"
    : tone === "red"
      ? "bg-red-500 text-white"
      : tone === "light"
        ? "bg-white/15 text-white"
        : "bg-slate-800 text-white";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-w-[76px] flex-col items-center gap-2 text-xs font-bold text-white disabled:opacity-40"
    >
      <span className={"grid h-16 w-16 place-items-center rounded-full text-2xl shadow-lg transition active:scale-95 " + toneClass}>
        {symbol}
      </span>
      <span>{label}</span>
    </button>
  );
}

export function SupportVoiceCallOverlay({
  open,
  mode,
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
  onAccept,
  onDecline,
  onCancel,
  onStart,
  onEnd,
  onToggleMic,
  onToggleSpeaker,
  onResumeAudio,
  onOpenExternalBrowser
}: SupportVoiceCallOverlayProps) {
  if (!open) return null;

  const connected = phase === "connected";
  const micBlocked = Boolean(error?.includes("ไมโครโฟน") || error?.includes("อนุญาต"));

  return (
    <div className="fixed inset-0 z-[120] overflow-y-auto bg-slate-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]">
        <div className="flex items-center justify-center">
          <div className="rounded-full border border-white/10 bg-white/10 px-4 py-2 text-xs font-bold tracking-wide text-white/80">
            CpIPOS Support Voice
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
          <div className="relative">
            <div className={"absolute inset-0 rounded-full blur-2xl " + (connected ? "bg-emerald-400/30" : "bg-blue-400/25")} />
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
              ? "สายเรียกเข้า"
              : mode === "outgoing"
                ? "กำลังโทรหา…"
                : connected
                  ? formatVoiceDuration(elapsedSeconds)
                  : phaseText(phase)}
          </div>

          {mode === "active" && !connected ? (
            <div className="mt-2 text-sm text-white/55">{phaseText(phase)}</div>
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

          {needsAudioResume ? (
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
          <div className="mx-auto grid w-full max-w-sm grid-cols-3 gap-5 pb-4">
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
          เสียงสนทนาไม่ถูกบันทึกลงระบบ
        </div>
      </div>
    </div>
  );
}
