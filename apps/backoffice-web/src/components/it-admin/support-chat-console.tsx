"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useItAccess } from "@/components/layout/app-shell";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type Head = {
  conversation_id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  latest_message_at: string | null;
  latest_message_preview: string | null;
  latest_sender_type: string | null;
  unread_it_count: number;
  unread_store_count: number;
  created_at: string;
  updated_at: string;
};

type Conversation = {
  id: string;
  tenant_id: string;
  store_code: string;
  store_name: string;
  store_logo_url: string | null;
  subject: string;
  contact_name: string;
  status: string;
  assigned_role: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  assigned_user_avatar_url: string | null;
  internal_note?: string | null;
  created_at: string;
  updated_at: string;
};

type Attachment = {
  id: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
};

type Message = {
  id: string;
  sender_type: "store" | "it" | "system";
  sender_name: string;
  sender_role: string | null;
  sender_avatar_url: string | null;
  message_body: string;
  created_at: string;
  attachments?: Attachment[];
};

type InboxResponse = {
  conversations: Head[];
  unread_total: number;
  actor: { user_id: string; role: "it_admin" | "it_support" };
};

type DetailResponse = { conversation: Conversation; messages: Message[] };
type Envelope<T> = { data?: T; error?: { code?: string; message?: string } };

function initials(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase() ?? "").join("");
}

function formatTime(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function StoreAvatar({ src, name }: { src?: string | null; name: string }) {
  if (src) {
    return <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-xl border border-slate-200 bg-white bg-cover bg-center"
      style={{ backgroundImage: `url("${src.replace(/["\\]/g, "")}")` }} />;
  }
  return <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xs font-black text-white">{initials(name)}</span>;
}

function SupportAvatar({ src, name: _name }: { src?: string | null; name: string }) {
  if (src) {
    return <span aria-hidden="true" className="h-9 w-9 shrink-0 rounded-full border border-slate-200 bg-white bg-cover bg-center"
      style={{ backgroundImage: `url("${src.replace(/["\\]/g, "")}")` }} />;
  }
  return <Image src="/brand/cpipos-symbol-sidebar.png" alt="" width={38} height={38}
    className="h-9 w-9 rounded-full border border-slate-200 bg-white object-contain" />;
}

function statusLabel(status: string) {
  if (status === "new" || status === "unassigned") return "ใหม่";
  if (status === "in_progress") return "กำลังดูแล";
  if (status === "waiting_store") return "รอลูกค้า";
  if (status === "waiting_it") return "รอ IT";
  if (status === "closed") return "จบแล้ว";
  return status;
}

async function attachmentPayload(file: File) {
  const allowed = ["image/jpeg", "image/png", "image/webp"];
  if (!allowed.includes(file.type)) throw new Error("รองรับเฉพาะ JPG, PNG และ WEBP");
  if (file.size > 2 * 1024 * 1024) throw new Error("รูปภาพต้องมีขนาดไม่เกิน 2 MB");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("อ่านไฟล์รูปภาพไม่สำเร็จ"));
    reader.readAsDataURL(file);
  });
  return {
    name: file.name.slice(0, 180),
    mime_type: file.type,
    size_bytes: file.size,
    data_base64: dataUrl.includes(",") ? dataUrl.slice(dataUrl.indexOf(",") + 1) : dataUrl
  };
}

export function SupportChatConsole({ historyOnly = false }: { historyOnly?: boolean }) {
  const { canDelete } = useItAccess();
  const [rows, setRows] = useState<Head[]>([]);
  const [actor, setActor] = useState<InboxResponse["actor"] | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [filter, setFilter] = useState<"all" | "new" | "mine" | "active" | "closed">("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [remoteTyping, setRemoteTyping] = useState("");
  const typingChannelRef = useRef<RealtimeChannel | null>(null);
  const typingTimerRef = useRef<number | null>(null);
  const typingSentAtRef = useRef(0);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notificationState, setNotificationState] = useState<NotificationPermission | "unsupported">(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
  );

  const loadInbox = useCallback(async () => {
    setBusy((current) => current || "list");
    try {
      const response = await fetch("/api/it-admin/v1/support-chat/conversations", { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<InboxResponse> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "โหลดแชทไม่สำเร็จ");
      setRows(json.data.conversations);
      setActor(json.data.actor);
      if (!selectedId) {
        const first = json.data.conversations.find((row) => row.status !== "closed") ?? json.data.conversations[0];
        if (first) setSelectedId(first.conversation_id);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [selectedId]);

  const loadConversation = useCallback(async (id: string) => {
    if (!id) return;
    setBusy("conversation");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${id}`, { cache: "no-store" });
      const json = await response.json().catch(() => null) as Envelope<DetailResponse> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "เปิดแชทไม่สำเร็จ");
      setConversation(json.data.conversation);
      setNoteDraft(json.data.conversation.internal_note ?? "");
      setMessages(json.data.messages);
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปิดแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [loadInbox]);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (selectedId) void loadConversation(selectedId);
  }, [selectedId, loadConversation]);

  useEffect(() => {
    const onUpdate = (event: Event) => {
      const head = (event as CustomEvent<{ head?: Head }>).detail?.head;
      void loadInbox();
      if (selectedId && head?.conversation_id === selectedId) void loadConversation(selectedId);
    };
    window.addEventListener("cpipos-support-chat-update", onUpdate);
    return () => window.removeEventListener("cpipos-support-chat-update", onUpdate);
  }, [loadInbox]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (historyOnly && row.status !== "closed") return false;
      if (!historyOnly && filter === "new" && !["new", "unassigned"].includes(row.status)) return false;
      if (filter === "mine" && row.assigned_user_id !== actor?.user_id) return false;
      if (filter === "active" && !["in_progress", "waiting_store", "waiting_it"].includes(row.status)) return false;
      if (filter === "closed" && row.status !== "closed") return false;
      if (filter !== "closed" && filter !== "all" && row.status === "closed") return false;
      if (!q) return true;
      return [row.store_code, row.store_name, row.subject, row.contact_name, row.latest_message_preview]
        .some((value) => String(value ?? "").toLowerCase().includes(q));
    });
  }, [rows, filter, search, actor?.user_id, historyOnly]);

  async function sendMessage() {
    const message = draft.trim();
    if (!selectedId || (!message && !attachment)) return;
    setBusy("send");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "send",
          message,
          attachment: attachment ? await attachmentPayload(attachment) : null
        })
      });
      const json = await response.json().catch(() => null) as Envelope<{ message: Message; conversation: Conversation }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "ส่งข้อความไม่สำเร็จ");
      setDraft("");
      setAttachment(null);
      void typingChannelRef.current?.send({ type: "broadcast", event: "typing", payload: { actor: "it", typing: false } });
      setConversation(json.data.conversation);
      setMessages((current) => [...current, json.data!.message]);
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function setConversationStatus(status: string) {
    if (!selectedId || status === conversation?.status) return;
    if (status === "closed" && !window.confirm("จบการสนทนานี้? รูปภาพแนบจะถูกลบทันที แต่ข้อความจะเก็บไว้")) return;
    setBusy("status");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set_status", status })
      });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "เปลี่ยนสถานะไม่สำเร็จ");
      setConversation(json.data.conversation);
      await loadInbox();
      await loadConversation(selectedId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปลี่ยนสถานะไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function saveNote() {
    if (!selectedId) return;
    setBusy("note");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "update_note", internal_note: noteDraft })
      });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "บันทึกโน้ตไม่สำเร็จ");
      setConversation(json.data.conversation);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกโน้ตไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function deleteConversation() {
    if (!selectedId || !canDelete || conversation?.status !== "closed") return;
    if (!window.confirm("ลบประวัติแชทนี้ถาวร? การลบย้อนกลับไม่ได้")) return;
    setBusy("delete");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "delete" })
      });
      const json = await response.json().catch(() => null) as Envelope<{ deleted: true }> | null;
      if (!response.ok || !json?.data?.deleted) throw new Error(json?.error?.message || "ลบแชทไม่สำเร็จ");
      setSelectedId("");
      setConversation(null);
      setMessages([]);
      setNoteDraft("");
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ลบแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function closeConversation() {
    if (!selectedId || !window.confirm("ยืนยันปิดการสนทนานี้?")) return;
    setBusy("close");
    setError("");
    try {
      const response = await fetch(`/api/it-admin/v1/support-chat/conversations/${selectedId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "close" })
      });
      const json = await response.json().catch(() => null) as Envelope<{ conversation: Conversation }> | null;
      if (!response.ok || !json?.data) throw new Error(json?.error?.message || "ปิดแชทไม่สำเร็จ");
      setConversation(json.data.conversation);
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ปิดแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!selectedId || conversation?.status === "closed") {
      setRemoteTyping("");
      return;
    }
    const supabase = getSupabaseBrowserClient();
    const channel = supabase.channel(`support-chat-typing:${selectedId}`)
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const event = payload as { actor?: string; typing?: boolean; name?: string };
        if (event.actor !== "store") return;
        if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
        setRemoteTyping(event.typing ? (event.name || "ลูกค้า") : "");
        if (event.typing) typingTimerRef.current = window.setTimeout(() => setRemoteTyping(""), 2600);
      })
      .subscribe();
    typingChannelRef.current = channel;
    return () => {
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      setRemoteTyping("");
      typingChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [selectedId, conversation?.status]);

  const announceTyping = useCallback((typing: boolean) => {
    const now = Date.now();
    if (typing && now - typingSentAtRef.current < 700) return;
    typingSentAtRef.current = now;
    void typingChannelRef.current?.send({
      type: "broadcast",
      event: "typing",
      payload: { actor: "it", typing, name: "IT Support" }
    });
  }, []);

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setNotificationState("unsupported");
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationState(permission);
  }

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-2xl font-black text-slate-950">{historyOnly ? "สมุดบันทึกแชท" : "Support Chat"}</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">{historyOnly ? "ประวัติที่จบแล้ว · โน้ตภายใน · รูปภาพถูกลบเมื่อจบแชท" : "IT Admin · IT Support · ร้านค้า"}</p>
        </div>
        <button type="button" onClick={() => void enableNotifications()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">
          {notificationState === "granted" ? "แจ้งเตือนเปิดแล้ว" : notificationState === "denied" ? "แจ้งเตือนถูกบล็อก" : "เปิดแจ้งเตือน"}
        </button>
        <button type="button" onClick={() => void loadInbox()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">
          รีเฟรช
        </button>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</div> : null}

      <section className="grid min-h-[720px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[360px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50/60">
          <div className="border-b border-slate-200 p-3">
            <input value={search} onChange={(event) => setSearch(event.target.value)}
              placeholder="ค้นหาร้าน / เรื่อง / ผู้ติดต่อ"
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
            {!historyOnly ? <div className="mt-2 flex flex-wrap gap-1.5">
              {([
                ["all", "ทั้งหมด"],
                ["new", "ใหม่"],
                ["mine", "ของฉัน"],
                ["active", "กำลังดูแล"],
                ["closed", "ปิดแล้ว"]
              ] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)}
                  className={"rounded-lg px-2.5 py-1.5 text-[11px] font-black " +
                    (filter === key ? "bg-blue-600 text-white" : "border border-slate-200 bg-white text-slate-600")}>
                  {label}
                </button>
              ))}
            </div> : <div className="mt-2 text-[11px] font-bold text-slate-500">แสดงเฉพาะการสนทนาที่จบแล้ว</div>}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {filtered.length ? filtered.map((row) => (
              <button key={row.conversation_id} type="button" onClick={() => setSelectedId(row.conversation_id)}
                className={"flex w-full gap-3 border-b border-slate-100 p-3 text-left transition " +
                  (selectedId === row.conversation_id ? "bg-blue-50" : "bg-white hover:bg-slate-50")}>
                <StoreAvatar src={row.store_logo_url} name={row.store_name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <strong className="min-w-0 flex-1 truncate text-sm text-slate-900">{row.store_name}</strong>
                    {row.unread_it_count > 0 ? <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{row.unread_it_count}</span> : null}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-bold text-slate-700">{row.subject}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-black text-slate-500">{statusLabel(row.status)}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-slate-500">{row.latest_message_preview || "เริ่มการสนทนา"}</div>
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                    <span>{row.store_code}</span>
                    <span>{formatTime(row.latest_message_at)}</span>
                  </div>
                </div>
              </button>
            )) : <div className="p-8 text-center text-xs text-slate-500">ไม่มีรายการแชท</div>}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {conversation ? (
            <>
              <header className="flex flex-wrap items-center gap-3 border-b border-slate-200 px-4 py-3">
                <StoreAvatar src={conversation.store_logo_url} name={conversation.store_name} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-black text-slate-950">{conversation.store_name} · {conversation.store_code}</div>
                  <div className="truncate text-xs text-slate-500">{conversation.subject} · ติดต่อ: {conversation.contact_name}</div>
                </div>
                <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <SupportAvatar src={conversation.assigned_user_avatar_url} name={conversation.assigned_user_name || "IT Support"} />
                  <div className="hidden sm:block">
                    <div className="text-[11px] font-black text-slate-800">{conversation.assigned_user_name || "กำลังรับเรื่อง"}</div>
                    <div className="text-[10px] text-slate-500">{conversation.assigned_role === "it_admin" ? "IT Admin" : "IT Support"}</div>
                  </div>
                </div>
                {conversation.status !== "closed" ? <select value={conversation.status} disabled={busy === "status"}
                  onChange={(event) => void setConversationStatus(event.target.value)}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">
                  <option value="in_progress">กำลังดูแล</option>
                  <option value="waiting_store">รอลูกค้า</option>
                  <option value="waiting_it">รอ IT</option>
                  <option value="closed">จบการสนทนา</option>
                </select> : <span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-black text-slate-500">จบแล้ว</span>}
                {canDelete && conversation.status === "closed" ? <button type="button" onClick={() => void deleteConversation()}
                  disabled={busy === "delete"}
                  className="rounded-xl border border-red-200 bg-white px-3 py-2 text-xs font-black text-red-700">ลบถาวร</button> : null}
              </header>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-[#f7faff] p-4">
                {busy === "conversation" && !messages.length ? <div className="text-center text-xs text-slate-500">กำลังโหลด...</div> : null}
                {messages.map((message) => {
                  if (message.sender_type === "system") {
                    return <div key={message.id} className="text-center text-[11px] text-slate-400">{message.message_body}</div>;
                  }
                  const mine = message.sender_type === "it";
                  return <div key={message.id} className={"flex gap-2 " + (mine ? "justify-end" : "justify-start")}>
                    {!mine ? <StoreAvatar src={conversation.store_logo_url} name={conversation.store_name} /> : null}
                    <div className={"max-w-[76%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm " +
                      (mine ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-800")}>
                      {message.attachments?.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"
                        className="mb-2 block overflow-hidden rounded-xl border border-white/30 bg-white/10">
                        <span className="block h-48 w-64 max-w-full bg-contain bg-center bg-no-repeat"
                          style={{ backgroundImage: `url("${item.url.replace(/["\\]/g, "")}")` }} />
                      </a>)}
                      <div className="whitespace-pre-wrap break-words">{message.message_body}</div>
                      <div className={"mt-1 text-[10px] " + (mine ? "text-blue-100" : "text-slate-400")}>{formatTime(message.created_at)}</div>
                    </div>
                    {mine ? <SupportAvatar src={message.sender_avatar_url || conversation.assigned_user_avatar_url} name={message.sender_name} /> : null}
                  </div>;
                })}
              </div>

              <div className="border-t border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center gap-2">
                  <input value={noteDraft} onChange={(event) => setNoteDraft(event.target.value.slice(0,3000))}
                    placeholder="โน้ตภายใน IT (ลูกค้าไม่เห็น)"
                    className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-blue-500" />
                  <button type="button" onClick={() => void saveNote()} disabled={busy === "note"}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-black text-slate-700">บันทึกโน้ต</button>
                </div>
              </div>
              {conversation.status === "closed" ? (
                <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 text-center text-xs font-black text-slate-500">
                  จบการสนทนาแล้ว · เก็บข้อความไว้ในสมุดบันทึก · รูปภาพถูกลบออกจากระบบ
                </div>
              ) : (
                <div className="border-t border-slate-200 bg-white p-3">
                  {remoteTyping ? <div className="mb-2 text-[11px] font-bold text-slate-500">{remoteTyping} กำลังพิมพ์…</div> : null}
                  {attachment ? <div className="mb-2 flex items-center gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                    <button type="button" onClick={() => setAttachment(null)} className="font-black">ลบ</button>
                  </div> : null}
                  <div className="flex gap-2">
                    <label className="grid h-[50px] w-[50px] shrink-0 cursor-pointer place-items-center rounded-xl border border-slate-300 bg-white text-lg text-slate-600" title="แนบรูปภาพ">
                      📎
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                        onChange={(event) => setAttachment(event.target.files?.[0] ?? null)} />
                    </label>
                    <textarea value={draft}
                      onChange={(event) => { const value = event.target.value.slice(0,4000); setDraft(value); announceTyping(Boolean(value.trim())); }}
                      onBlur={() => announceTyping(false)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && !event.shiftKey) {
                          event.preventDefault();
                          void sendMessage();
                        }
                      }}
                      rows={2} placeholder="พิมพ์ข้อความถึงร้านค้า..."
                      className="min-h-[50px] flex-1 resize-none rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                    <button type="button" onClick={() => void sendMessage()} disabled={busy === "send" || (!draft.trim() && !attachment)}
                      className="rounded-xl bg-blue-600 px-6 text-sm font-black text-white disabled:opacity-40">
                      {busy === "send" ? "..." : "ส่ง"}
                    </button>
                  </div>
                  <div className="mt-1 text-[10px] text-slate-400">รูปภาพ JPG/PNG/WEBP ไม่เกิน 2 MB · รูปจะถูกลบเมื่อจบการสนทนา</div>
                </div>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <Image src="/brand/cpipos-symbol-sidebar.png" alt="" width={72} height={72} className="mx-auto h-16 w-16 object-contain opacity-80" />
                <h3 className="mt-3 text-lg font-black text-slate-900">เลือกแชทจากรายการด้านซ้าย</h3>
                <p className="mt-1 text-sm text-slate-500">เมื่อเปิดแชทใหม่ ระบบจะรับเรื่องให้พนักงานที่เปิดโดยอัตโนมัติ</p>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
