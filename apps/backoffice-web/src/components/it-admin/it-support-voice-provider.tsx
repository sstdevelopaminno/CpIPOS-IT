"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SupportVoiceCallOverlay, type SupportVoiceTransferTarget } from "@/components/support/support-voice-call-overlay";
import {
  useSupportVoiceCall,
  type SupportVoiceCall,
  type SupportVoicePhase
} from "@/components/support/use-support-voice-call";

type ItVoiceConversation = {
  id: string;
  store_code: string;
  store_name: string;
  contact_name: string;
};

type Envelope<T> = {
  data?: T;
  error?: { message?: string };
};

type VoiceAction =
  | "voice_invite"
  | "voice_accept"
  | "voice_cancel"
  | "voice_end"
  | "voice_transfer"
  | "voice_transfer_accept"
  | "voice_transfer_decline"
  | "voice_transfer_cancel";

type ItSupportVoiceContextValue = {
  call: SupportVoiceCall | null;
  conversation: ItVoiceConversation | null;
  phase: SupportVoicePhase;
  elapsedSeconds: number;
  micMuted: boolean;
  speakerMuted: boolean;
  needsAudioResume: boolean;
  busy: boolean;
  error: string;
  minimized: boolean;
  refresh: () => Promise<void>;
  invite: (conversationId: string) => Promise<void>;
  accept: (conversationId: string, callId: string) => Promise<void>;
  cancel: (conversationId: string, callId: string) => Promise<void>;
  end: () => Promise<void>;
  start: () => Promise<void>;
  toggleMic: () => void;
  toggleSpeaker: () => void;
  resumeAudio: () => Promise<void>;
  minimize: () => void;
  restore: () => void;
};

type TransferTargetsResponse = {
  departments: Array<{ role: "it_admin" | "it_support"; label: string }>;
  users: SupportVoiceTransferTarget[];
};

const ItSupportVoiceContext = createContext<ItSupportVoiceContextValue | null>(null);

function active(status: string | undefined) {
  return Boolean(status && ["requested", "accepted", "connecting", "connected"].includes(status));
}

export function ItSupportVoiceProvider({ children }: { children: ReactNode }) {
  const [call, setCall] = useState<SupportVoiceCall | null>(null);
  const [conversation, setConversation] = useState<ItVoiceConversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlError, setControlError] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [transferPickerOpen, setTransferPickerOpen] = useState(false);
  const [transferLoading, setTransferLoading] = useState(false);
  const [transferDepartments, setTransferDepartments] = useState<TransferTargetsResponse["departments"]>([]);
  const [transferUsers, setTransferUsers] = useState<SupportVoiceTransferTarget[]>([]);
  const lastCallIdRef = useRef("");
  const autoStartTransferRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/it-admin/v1/support-chat/active-call", { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<{
        call: SupportVoiceCall | null;
        conversation: ItVoiceConversation | null;
      }> | null;
      if (!response.ok || !json?.data) return;

      const nextCall = json.data.call && active(json.data.call.status) ? json.data.call : null;
      const nextId = nextCall?.id ?? "";
      if (nextId !== lastCallIdRef.current) {
        lastCallIdRef.current = nextId;
        setMinimized(false);
        setControlError("");
        setTransferPickerOpen(false);
      }
      setCall(nextCall);
      setConversation(nextCall ? json.data.conversation : null);
    } catch {
      // Recovery polling must never interrupt an active WebRTC media session.
    }
  }, []);

  const control = useCallback(async (
    action: VoiceAction,
    conversationId: string,
    callId?: string,
    extra: Record<string, unknown> = {}
  ) => {
    setBusy(true);
    setControlError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${conversationId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, call_id: callId ?? null, ...extra })
      });
      const json = await response.json().catch(() => null) as Envelope<{
        call: SupportVoiceCall;
        conversation: ItVoiceConversation;
        head?: Record<string, unknown>;
      }> | null;
      if (!response.ok || !json?.data) {
        throw new Error(json?.error?.message || "ทำรายการคุยด้วยเสียงไม่สำเร็จ");
      }

      const nextCall = active(json.data.call.status) ? json.data.call : null;
      setCall(nextCall);
      setConversation(nextCall ? json.data.conversation : null);
      lastCallIdRef.current = nextCall?.id ?? "";
      if (!nextCall) setMinimized(false);

      if (json.data.head) {
        window.dispatchEvent(new CustomEvent("cpipos-support-chat-update", {
          detail: { head: json.data.head }
        }));
      }
      return json.data;
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "ทำรายการคุยด้วยเสียงไม่สำเร็จ");
      throw cause;
    } finally {
      setBusy(false);
    }
  }, []);

  const loadVoiceIceServers = useCallback(async () => {
    if (!conversation?.id || !call?.id) throw new Error("ไม่พบห้องเสียง");
    const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${conversation.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "voice_ice", call_id: call.id })
    });
    const json = await response.json().catch(() => null) as Envelope<{
      ice_servers: RTCIceServer[];
      turn_enabled: boolean;
    }> | null;
    if (!response.ok || !json?.data) {
      throw new Error(json?.error?.message || "โหลดการตั้งค่าเครือข่ายเสียงไม่สำเร็จ");
    }
    return json.data.ice_servers;
  }, [conversation?.id, call?.id]);

  const updateVoiceState = useCallback(async (state: "connecting" | "connected") => {
    if (!conversation?.id || !call?.id) return;
    const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${conversation.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "voice_state", call_id: call.id, state })
    });
    const json = await response.json().catch(() => null) as Envelope<{ call: SupportVoiceCall }> | null;
    if (!response.ok || !json?.data) return;
    setCall(json.data.call);
  }, [conversation?.id, call?.id]);

  const handleRemoteHangup = useCallback(async () => {
    if (!conversation?.id || !call?.id) return;
    await fetch(`/api/it-admin/v1/support-chat/conversations/${conversation.id}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "voice_end", call_id: call.id })
    }).catch(() => null);
    setCall(null);
    setConversation(null);
    setMinimized(false);
    lastCallIdRef.current = "";
    window.setTimeout(() => void refresh(), 500);
  }, [conversation?.id, call?.id, refresh]);

  const voice = useSupportVoiceCall({
    call,
    side: "it",
    loadIceServers: loadVoiceIceServers,
    onState: updateVoiceState,
    onRemoteHangup: handleRemoteHangup
  });

  const end = useCallback(async () => {
    if (!call?.id || !conversation?.id) return;
    await voice.endLocal();
    await control("voice_end", conversation.id, call.id).catch(() => null);
  }, [call?.id, conversation?.id, voice, control]);

  const openTransferPicker = useCallback(async () => {
    if (!call?.id || call.status !== "connected" || call.transfer_offer_for_me) return;
    setTransferPickerOpen(true);
    setTransferLoading(true);
    setControlError("");
    try {
      const response = await fetch("/api/it-admin/v1/support-chat/transfer-targets", { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<TransferTargetsResponse> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดรายชื่อผู้รับโอนไม่สำเร็จ");
      setTransferDepartments(json.data.departments);
      setTransferUsers(json.data.users);
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "โหลดรายชื่อผู้รับโอนไม่สำเร็จ");
    } finally {
      setTransferLoading(false);
    }
  }, [call?.id, call?.status, call?.transfer_offer_for_me]);

  const transferTo = useCallback(async (target: {
    id?: string;
    full_name: string;
    platform_role: "it_admin" | "it_support";
  }) => {
    if (!call?.id || !conversation?.id) return;
    await control("voice_transfer", conversation.id, call.id, {
      target_user_id: target.id ?? null,
      target_name: target.full_name,
      target_role: target.platform_role
    });
    setTransferPickerOpen(false);
  }, [call?.id, conversation?.id, control]);

  const cancelTransfer = useCallback(async () => {
    if (!call?.id || !conversation?.id) return;
    await control("voice_transfer_cancel", conversation.id, call.id).catch(() => null);
  }, [call?.id, conversation?.id, control]);

  const acceptTransfer = useCallback(async () => {
    if (!call?.id || !conversation?.id) return;
    autoStartTransferRef.current = true;
    await control("voice_transfer_accept", conversation.id, call.id).catch(() => {
      autoStartTransferRef.current = false;
    });
  }, [call?.id, conversation?.id, control]);

  const declineTransfer = useCallback(async () => {
    if (!call?.id || !conversation?.id) return;
    await control("voice_transfer_decline", conversation.id, call.id).catch(() => null);
  }, [call?.id, conversation?.id, control]);

  const transferVoicePhase = voice.phase;
  const startTransferredVoice = voice.start;

  useEffect(() => {
    if (
      autoStartTransferRef.current &&
      call?.transfer_status === "accepted" &&
      Boolean(call.signaling_key) &&
      transferVoicePhase === "idle"
    ) {
      autoStartTransferRef.current = false;
      void startTransferredVoice();
    }
  }, [call?.signaling_key, call?.transfer_status, startTransferredVoice, transferVoicePhase]);

  useEffect(() => {
    void refresh();
    const fastTransferRefresh = call?.transfer_status === "requested";
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "hidden") void refresh();
    }, fastTransferRefresh ? 2_500 : 30_000);
    const onFocus = () => void refresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const onSupportUpdate = () => void refresh();

    window.addEventListener("focus", onFocus);
    window.addEventListener("cpipos-support-chat-update", onSupportUpdate);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("cpipos-support-chat-update", onSupportUpdate);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, call?.transfer_status]);

  const transferOffer = call?.transfer_offer_for_me === true && call.transfer_status === "requested";
  const mode = transferOffer
    ? "incoming"
    : call?.status === "requested"
      ? call.direction === "store_to_it"
        ? "incoming"
        : "outgoing"
      : "active";

  const value = useMemo<ItSupportVoiceContextValue>(() => ({
    call,
    conversation,
    phase: voice.phase,
    elapsedSeconds: voice.elapsedSeconds,
    micMuted: voice.micMuted,
    speakerMuted: voice.speakerMuted,
    needsAudioResume: voice.needsAudioResume,
    busy,
    error: controlError || voice.error,
    minimized,
    refresh,
    invite: (conversationId) => control("voice_invite", conversationId).then(() => undefined),
    accept: (conversationId, callId) => control("voice_accept", conversationId, callId).then(() => undefined),
    cancel: (conversationId, callId) => control("voice_cancel", conversationId, callId).then(() => undefined),
    end,
    start: voice.start,
    toggleMic: voice.toggleMic,
    toggleSpeaker: voice.toggleSpeaker,
    resumeAudio: voice.resumeAudio,
    minimize: () => setMinimized(true),
    restore: () => setMinimized(false)
  }), [
    call,
    conversation,
    voice.phase,
    voice.elapsedSeconds,
    voice.micMuted,
    voice.speakerMuted,
    voice.needsAudioResume,
    voice.error,
    voice.start,
    voice.toggleMic,
    voice.toggleSpeaker,
    voice.resumeAudio,
    busy,
    controlError,
    minimized,
    refresh,
    control,
    end
  ]);

  return (
    <ItSupportVoiceContext.Provider value={value}>
      {children}
      <SupportVoiceCallOverlay
        open={Boolean(call && conversation)}
        mode={mode}
        incomingLabel={transferOffer ? "สายโอนเข้า" : undefined}
        counterpartyName={conversation?.store_name || conversation?.contact_name || "ลูกค้า CpIPOS"}
        counterpartyDetail={
          transferOffer
            ? `โอนจาก ${call?.previous_it_name || call?.transfer_requested_by_name || "เจ้าหน้าที่"} · ${conversation?.store_code || ""}`
            : conversation
              ? `ร้านค้า · ${conversation.store_code}`
              : "CpIPOS Support"
        }
        phase={voice.phase}
        error={controlError || voice.error}
        busy={busy}
        canStart={voice.canStart}
        micMuted={voice.micMuted}
        speakerMuted={voice.speakerMuted}
        needsAudioResume={voice.needsAudioResume}
        elapsedSeconds={voice.elapsedSeconds}
        allowMinimize={mode === "active"}
        minimized={minimized}
        onMinimize={() => setMinimized(true)}
        onRestore={() => setMinimized(false)}
        onAccept={
          transferOffer
            ? () => void acceptTransfer()
            : call && conversation
              ? () => void control("voice_accept", conversation.id, call.id)
              : undefined
        }
        onDecline={transferOffer ? () => void declineTransfer() : undefined}
        onCancel={call && conversation ? () => void control("voice_cancel", conversation.id, call.id) : undefined}
        onStart={() => void voice.start()}
        onEnd={() => void end()}
        onToggleMic={voice.toggleMic}
        onToggleSpeaker={voice.toggleSpeaker}
        onResumeAudio={() => void voice.resumeAudio()}
        canTransfer={mode === "active" && call?.status === "connected" && call?.transfer_status !== "requested"}
        transferPending={call?.transfer_status === "requested" && !transferOffer}
        transferTargetLabel={call?.transfer_target_name || undefined}
        transferPickerOpen={transferPickerOpen}
        transferTargetsLoading={transferLoading}
        transferDepartments={transferDepartments}
        transferTargets={transferUsers}
        onOpenTransfer={() => void openTransferPicker()}
        onCloseTransfer={() => setTransferPickerOpen(false)}
        onTransferToDepartment={(role, label) => void transferTo({ full_name: label, platform_role: role })}
        onTransferToUser={(target) => void transferTo(target)}
        onCancelTransfer={() => void cancelTransfer()}
      />
    </ItSupportVoiceContext.Provider>
  );
}

export function useItSupportVoice() {
  const value = useContext(ItSupportVoiceContext);
  if (!value) throw new Error("useItSupportVoice must be used inside ItSupportVoiceProvider");
  return value;
}
