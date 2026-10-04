"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Head = {
  conversation_id?: string;
  store_name?: string;
  subject?: string;
  status?: string;
  latest_message_at?: string | null;
  latest_message_preview?: string | null;
  latest_sender_type?: string | null;
  unread_it_count?: number | null;
  updated_at?: string;
};

type InboxSnapshot = {
  conversations: Head[];
  unread_total: number;
};

async function loadInboxSnapshot(): Promise<InboxSnapshot> {
  const response = await fetch("/api/it-admin/v1/support-chat/conversations", { cache: "no-store" });
  const json = await response.json().catch(() => null) as {
    data?: { conversations?: Head[]; unread_total?: number }
  } | null;
  if (!response.ok || !json?.data) {
    return { conversations: [], unread_total: 0 };
  }
  return {
    conversations: json.data.conversations ?? [],
    unread_total: Number(json.data.unread_total ?? 0)
  };
}

function notifyUnread(total: number) {
  window.dispatchEvent(new CustomEvent("cpipos-support-chat-unread", { detail: { total } }));
}

function notifyUpdate(head: Head) {
  window.dispatchEvent(new CustomEvent("cpipos-support-chat-update", { detail: { head } }));
}

export function SupportChatNotifier() {
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const initialized = useRef(false);
  const headSignals = useRef(new Map<string, string>());
  const notifiedSignals = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const supabase = getSupabaseBrowserClient();

    const signalFor = (head: Head) => [
      head.updated_at ?? "",
      head.latest_message_at ?? "",
      head.status ?? "",
      String(head.unread_it_count ?? 0)
    ].join("|");

    const handleHead = (next: Head, allowToast = true) => {
      if (!alive || !next.conversation_id) return;
      const signal = signalFor(next);
      const previous = headSignals.current.get(next.conversation_id);
      headSignals.current.set(next.conversation_id, signal);
      if (previous === signal) return;

      notifyUpdate(next);

      const voiceRequest = next.latest_sender_type === "system" &&
        String(next.latest_message_preview ?? "").includes("ลูกค้าขอคุยด้วยเสียง");
      if (
        allowToast &&
        initialized.current &&
        (next.latest_sender_type === "store" || voiceRequest) &&
        Number(next.unread_it_count ?? 0) > 0
      ) {
        const noticeKey = next.conversation_id + ":" + String(next.latest_message_at ?? signal);
        if (notifiedSignals.current.has(noticeKey)) return;
        notifiedSignals.current.add(noticeKey);
        if (notifiedSignals.current.size > 100) {
          notifiedSignals.current = new Set(Array.from(notifiedSignals.current).slice(-50));
        }

        const title = voiceRequest
          ? (next.store_name ? `📞 ขอคุยด้วยเสียง · ${next.store_name}` : "📞 ลูกค้าขอคุยด้วยเสียง")
          : (next.store_name ? `แชทใหม่ · ${next.store_name}` : "มีแชทใหม่");
        const message = next.latest_message_preview || next.subject || "ลูกค้าส่งข้อความเข้ามา";
        setToast({ title, message });
        window.setTimeout(() => setToast(null), 5000);

        try {
          const AudioCtx = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            gain.gain.value = 0.04;
            osc.frequency.value = 760;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
          }
        } catch {
          // Browser may block audio until the user interacts with the page.
        }

        if ("Notification" in window && Notification.permission === "granted") {
          new Notification(title, { body: message, icon: "/brand/cpipos-symbol-sidebar.png", tag: next.conversation_id });
        }
      }
    };

    const refreshSnapshot = async (allowToast: boolean) => {
      const snapshot = await loadInboxSnapshot();
      if (!alive) return;
      notifyUnread(snapshot.unread_total);
      for (const head of snapshot.conversations) handleHead(head, allowToast);
      initialized.current = true;
    };

    void refreshSnapshot(false).catch(() => null);

    const channel = supabase
      .channel("it-support-chat-heads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_chat_heads" },
        async (payload) => {
          const next = (payload.new ?? {}) as Head;
          if (!alive) return;

          // Realtime is the fast path; polling below is a safety net for
          // mobile/browser websocket stalls.
          handleHead(next, true);
          void loadInboxSnapshot().then((snapshot) => {
            if (alive) notifyUnread(snapshot.unread_total);
          }).catch(() => null);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          initialized.current = true;
          void refreshSnapshot(false).catch(() => null);
          return;
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          window.setTimeout(() => {
            void refreshSnapshot(true).catch(() => null);
          }, 1200);
        }
      });

    // Fallback poll keeps the IT inbox responsive even if Postgres Realtime
    // is temporarily disconnected by the browser/network.
    const fallbackPoll = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshSnapshot(true).catch(() => null);
    }, 2500);

    const refreshOnFocus = () => {
      if (document.visibilityState === "hidden") return;
      void refreshSnapshot(true).catch(() => null);
    };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("online", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);

    const onPush = (event: Event) => {
      const payload = (event as CustomEvent<{ title?: string; body?: string; kind?: string }>).detail;
      if (payload?.kind !== "chat") return;
      setToast({ title: payload.title || "มีแชทใหม่", message: payload.body || "" });
      window.setTimeout(() => setToast(null), 5000);
      void refreshSnapshot(true).catch(() => null);
    };
    window.addEventListener("cpipos-it-push-notification", onPush);

    return () => {
      alive = false;
      window.clearInterval(fallbackPoll);
      window.removeEventListener("focus", refreshOnFocus);
      window.removeEventListener("online", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnFocus);
      window.removeEventListener("cpipos-it-push-notification", onPush);
      void supabase.removeChannel(channel);
    };
  }, []);

  if (!toast) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setToast(null);
        window.location.assign("/it-admin/support-chat");
      }}
      className="fixed right-5 top-20 z-[200] w-[min(360px,calc(100vw-2rem))] rounded-2xl border border-blue-200 bg-white p-4 text-left shadow-2xl"
    >
      <div className="text-sm font-black text-slate-950">{toast.title}</div>
      <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">{toast.message}</div>
      <div className="mt-2 text-[10px] font-black text-blue-600">เปิด Support Chat</div>
    </button>
  );
}
