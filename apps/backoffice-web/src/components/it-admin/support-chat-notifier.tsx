"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Head = {
  conversation_id?: string;
  store_name?: string;
  subject?: string;
  latest_message_preview?: string | null;
  latest_sender_type?: string | null;
  unread_it_count?: number | null;
};

async function loadUnreadTotal() {
  const response = await fetch("/api/it-admin/v1/support-chat/conversations", { cache: "no-store" });
  const json = await response.json().catch(() => null) as { data?: { unread_total?: number } } | null;
  return response.ok ? Number(json?.data?.unread_total ?? 0) : 0;
}

function notifyUnread(total: number) {
  window.dispatchEvent(new CustomEvent("cpipos-support-chat-unread", { detail: { total } }));
  window.dispatchEvent(new CustomEvent("cpipos-support-chat-update"));
}

export function SupportChatNotifier() {
  const [toast, setToast] = useState<{ title: string; message: string } | null>(null);
  const initialized = useRef(false);

  useEffect(() => {
    let alive = true;
    const supabase = getSupabaseBrowserClient();

    void loadUnreadTotal().then((total) => {
      if (alive) notifyUnread(total);
    }).catch(() => null);

    const channel = supabase
      .channel("it-support-chat-heads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_chat_heads" },
        async (payload) => {
          const next = (payload.new ?? {}) as Head;
          const totalNext = await loadUnreadTotal().catch(() => 0);
          if (!alive) return;
          notifyUnread(totalNext);

          if (initialized.current && next.latest_sender_type === "store" && Number(next.unread_it_count ?? 0) > 0) {
            const title = next.store_name ? `แชทใหม่ · ${next.store_name}` : "มีแชทใหม่";
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
          initialized.current = true;
        }
      )
      .subscribe(() => {
        initialized.current = true;
      });

    return () => {
      alive = false;
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
