"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent
} from "react";

type MailFolder = "all" | "inbox" | "starred" | "sent" | "archive";
type SyncStatus = "idle" | "syncing" | "ok" | "error";

type ThreadSummary = {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  last_message_at: string;
  message_count: number;
  unread: boolean;
  starred?: boolean;
  in_inbox: boolean;
};

type MailMessage = {
  id: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  body: string;
};

type InboxData = {
  mailbox: string;
  folder?: string;
  bridge_version?: string;
  capabilities?: string[];
  threads: ThreadSummary[];
  actor: { user_id: string; role: "it_admin" | "it_support" };
};

type ThreadData = {
  mailbox: string;
  thread: ThreadSummary;
  messages: MailMessage[];
};

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type DeleteDialog = {
  ids: string[];
  title: string;
  detail: string;
} | null;

const folderItems: Array<{ key: MailFolder; label: string; icon: string }> = [
  { key: "all", label: "ทั้งหมด", icon: "◫" },
  { key: "inbox", label: "กล่องจดหมาย", icon: "▣" },
  { key: "starred", label: "ติดดาว", icon: "☆" },
  { key: "sent", label: "ส่งแล้ว", icon: "➤" },
  { key: "archive", label: "เก็บถาวร", icon: "▤" }
];

function formatDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat("th-TH", sameDay
    ? { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" }
    : { day: "numeric", month: "short", year: "2-digit", timeZone: "Asia/Bangkok" }
  ).format(date);
}

function formatSyncTime(value: Date | null) {
  if (!value) return "";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Bangkok"
  }).format(value);
}

function senderLabel(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "ไม่ทราบผู้ส่ง";
  const match = value.match(/^"?([^"<]+)"?\s*</);
  const label = match?.[1]?.trim() || value.replace(/<[^>]+>/g, "").trim() || value;
  return label.length > 52 ? label.slice(0, 49) + "…" : label;
}

function senderAddress(raw: string) {
  const value = String(raw || "").trim();
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] || value).trim();
}

function avatarText(raw: string) {
  const label = senderLabel(raw);
  return (label.split(/\s+/).filter(Boolean)[0]?.[0] || "M").toUpperCase();
}

function normalizeError(cause: unknown, fallback: string) {
  const message = cause instanceof Error ? cause.message : fallback;
  if (/aborted|timeout/i.test(message)) {
    return "การโหลดอีเมลใช้เวลานานเกินกำหนด กรุณาลองใหม่อีกครั้ง";
  }
  return message || fallback;
}

async function request<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...init,
      signal: init?.signal ?? controller.signal
    });
    const payload = await response.json().catch(() => null) as Envelope<T> | null;
    if (!response.ok || !payload?.data) {
      throw new Error(payload?.error?.message || "ทำรายการไม่สำเร็จ");
    }
    return payload.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("การโหลดอีเมลใช้เวลานานเกินกำหนด กรุณาลองใหม่อีกครั้ง");
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function SupportMailConsole() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<ThreadData | null>(null);
  const [mailbox, setMailbox] = useState("cuttingpointtech.support@gmail.com");
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [deleteDialog, setDeleteDialog] = useState<DeleteDialog>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const [bridgeVersion, setBridgeVersion] = useState("legacy");
  const [bridgeCapabilities, setBridgeCapabilities] = useState<string[]>(["inbox"]);
  const inboxRequestIdRef = useRef(0);
  const hasSyncedRef = useRef(false);
  const syncFailureCountRef = useRef(0);

  const loadInbox = useCallback(async (silent = false) => {
    const requestId = ++inboxRequestIdRef.current;
    if (!silent) {
      setSyncStatus("syncing");
      setBusy("inbox");
    }
    try {
      const params = new URLSearchParams({ folder });
      if (activeQuery) params.set("q", activeQuery);
      if (unreadOnly) params.set("unread", "1");
      const data = await request<InboxData>(`/api/it-admin/v1/support-mail?${params.toString()}`);
      if (requestId !== inboxRequestIdRef.current) return;
      setMailbox(data.mailbox);
      setThreads(data.threads);
      setBridgeVersion(data.bridge_version || "legacy");
      setBridgeCapabilities(Array.isArray(data.capabilities) ? data.capabilities : ["inbox"]);
      setLastSyncedAt(new Date());
      hasSyncedRef.current = true;
      syncFailureCountRef.current = 0;
      setSyncStatus("ok");
      setSyncMessage("");
      setSelectedIds((current) => current.filter((id) => data.threads.some((item) => item.id === id)));
      setSelectedId((current) => {
        if (current && data.threads.some((item) => item.id === current)) return current;
        return data.threads[0]?.id ?? "";
      });
      if (!data.threads.length) setDetail(null);
    } catch (cause) {
      if (requestId !== inboxRequestIdRef.current) return;
      const message = normalizeError(cause, "โหลดกล่องอีเมลไม่สำเร็จ");
      syncFailureCountRef.current += 1;
      setSyncMessage(message);
      if (!silent || !hasSyncedRef.current || syncFailureCountRef.current >= 3) {
        setSyncStatus("error");
      }
      // A single background refresh failure must not make a healthy mailbox
      // look disconnected. Keep the last successful data and retry later.
    } finally {
      if (requestId === inboxRequestIdRef.current && !silent) setBusy("");
    }
  }, [activeQuery, folder, unreadOnly]);

  const loadThread = useCallback(async (threadId: string) => {
    if (!threadId) return;
    setError("");
    setBusy("thread");
    try {
      const data = await request<ThreadData>(
        `/api/it-admin/v1/support-mail?thread_id=${encodeURIComponent(threadId)}`
      );
      setMailbox(data.mailbox);
      setDetail({ ...data, thread: { ...data.thread, unread: false } });
      if (data.thread.unread) {
        setThreads((current) => current.map((item) =>
          item.id === threadId ? { ...item, unread: false } : item
        ));
        void fetch("/api/it-admin/v1/support-mail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark_read", thread_id: threadId })
        });
      }
    } catch (cause) {
      const message = normalizeError(cause, "เปิดอีเมลไม่สำเร็จ");
      setError(
        message === "เชื่อมต่อ Gmail Support ไม่สำเร็จ"
          ? "เปิดอีเมลนี้ไม่สำเร็จชั่วคราว กรุณากดรีเฟรชหรือลองเลือกอีเมลอีกครั้ง"
          : message
      );
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void loadInbox(false);
  }, [loadInbox]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadInbox(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [loadInbox]);

  const bridgeCurrent = bridgeVersion !== "legacy" && bridgeCapabilities.length > 1;
  const canTrash = bridgeCapabilities.includes("trash") && bridgeCapabilities.includes("trash_many");
  const folderSupported = useCallback((key: MailFolder) =>
    key === "inbox" || bridgeCapabilities.includes(key), [bridgeCapabilities]);

  const unreadCount = useMemo(
    () => threads.reduce((sum, thread) => sum + (thread.unread ? 1 : 0), 0),
    [threads]
  );

  const allVisibleSelected = threads.length > 0 && threads.every((thread) => selectedIds.includes(thread.id));

  const replyTarget = useMemo(() => {
    if (!detail?.messages.length) return "ผู้ส่ง";
    const external = [...detail.messages].reverse().find(
      (message) => !message.from.toLowerCase().includes(mailbox.toLowerCase())
    );
    return external ? senderAddress(external.from) : senderAddress(detail.messages[detail.messages.length - 1]?.from || "");
  }, [detail, mailbox]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSelectedId("");
    setDetail(null);
    setSelectedIds([]);
    setActiveQuery(searchInput.trim());
  }

  function changeFolder(next: MailFolder) {
    if (next === folder) return;
    if (!folderSupported(next)) {
      setSyncMessage("อัปเดต Apps Script Support Mail เป็นเวอร์ชันล่าสุดเพียงครั้งเดียว เพื่อใช้ตัวกรองสถานะนี้");
      return;
    }
    setFolder(next);
    setSelectedId("");
    setSelectedIds([]);
    setDetail(null);
    setError("");
    if (next !== "inbox") setUnreadOnly(false);
    setReplyOpen(false);
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    );
  }

  function toggleAllVisible() {
    setSelectedIds(allVisibleSelected ? [] : threads.map((thread) => thread.id));
  }

  function openSingleDelete(id: string, subject?: string) {
    if (!canTrash) {
      setSyncMessage("การลบต้องใช้ Support Mail Bridge เวอร์ชันล่าสุด กรุณา Deploy Code.gs ล่าสุดเพียงครั้งเดียว");
      return;
    }
    setDeleteDialog({
      ids: [id],
      title: "ลบอีเมลนี้?",
      detail: subject ? `“${subject}” จะถูกย้ายไปถังขยะ Gmail และยังสามารถกู้คืนได้` : "อีเมลจะถูกย้ายไปถังขยะ Gmail"
    });
  }

  function openSelectedDelete() {
    if (!selectedIds.length) return;
    if (!canTrash) {
      setSyncMessage("การลบต้องใช้ Support Mail Bridge เวอร์ชันล่าสุด กรุณา Deploy Code.gs ล่าสุดเพียงครั้งเดียว");
      return;
    }
    setDeleteDialog({
      ids: selectedIds,
      title: `ลบอีเมลที่เลือก ${selectedIds.length} รายการ?`,
      detail: "รายการที่เลือกจะถูกย้ายไปถังขยะ Gmail และยังสามารถกู้คืนได้"
    });
  }

  function openDeleteAllVisible() {
    if (!threads.length) return;
    if (!canTrash) {
      setSyncMessage("การลบต้องใช้ Support Mail Bridge เวอร์ชันล่าสุด กรุณา Deploy Code.gs ล่าสุดเพียงครั้งเดียว");
      return;
    }
    setDeleteDialog({
      ids: threads.map((thread) => thread.id),
      title: `ลบทั้งหมดในหน้านี้ ${threads.length} รายการ?`,
      detail: "ลบเฉพาะรายการที่กำลังแสดงในหน้านี้ ไม่ได้ลบอีเมลทั้งหมดในบัญชี"
    });
  }

  async function confirmTrash() {
    if (!deleteDialog?.ids.length) return;
    const ids = deleteDialog.ids;
    setBusy("trash");
    setError("");
    try {
      if (ids.length === 1) {
        await request<{ trashed: true }>("/api/it-admin/v1/support-mail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "trash", thread_id: ids[0] })
        });
      } else {
        await request<{ trashed: true; count: number }>("/api/it-admin/v1/support-mail", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "trash_many", thread_ids: ids })
        });
      }

      const deleted = new Set(ids);
      setThreads((current) => current.filter((thread) => !deleted.has(thread.id)));
      setSelectedIds((current) => current.filter((id) => !deleted.has(id)));
      if (selectedId && deleted.has(selectedId)) {
        setSelectedId("");
        setDetail(null);
        setReplyOpen(false);
      }
      setDeleteDialog(null);
      await loadInbox(true);
    } catch (cause) {
      setError(normalizeError(cause, "ลบอีเมลไม่สำเร็จ"));
    } finally {
      setBusy("");
    }
  }

  async function sendReply() {
    const body = replyBody.trim();
    if (!selectedId || !body) return;
    setBusy("reply");
    setError("");
    try {
      await request<{ sent: true }>("/api/it-admin/v1/support-mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reply", thread_id: selectedId, body })
      });
      setReplyBody("");
      setReplyOpen(false);
      await loadThread(selectedId);
      await loadInbox(true);
    } catch (cause) {
      setError(normalizeError(cause, "ตอบกลับอีเมลไม่สำเร็จ"));
    } finally {
      setBusy("");
    }
  }

  async function sendNewMail() {
    const to = composeTo.trim();
    const subject = composeSubject.trim();
    const body = composeBody.trim();
    if (!to || !subject || !body) return;
    setBusy("compose");
    setError("");
    try {
      await request<{ sent: true }>("/api/it-admin/v1/support-mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send_new", to, subject, body })
      });
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      if (folder === "sent") await loadInbox(false);
    } catch (cause) {
      setError(normalizeError(cause, "ส่งอีเมลไม่สำเร็จ"));
    } finally {
      setBusy("");
    }
  }

  async function archiveSelected() {
    if (!selectedId) return;
    const id = selectedId;
    setBusy("archive");
    setError("");
    try {
      await request<{ archived: true }>("/api/it-admin/v1/support-mail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "archive", thread_id: id })
      });
      setSelectedId("");
      setDetail(null);
      setReplyOpen(false);
      await loadInbox(false);
    } catch (cause) {
      setError(normalizeError(cause, "Archive อีเมลไม่สำเร็จ"));
    } finally {
      setBusy("");
    }
  }

  function rowTrash(event: MouseEvent<HTMLButtonElement>, thread: ThreadSummary) {
    event.stopPropagation();
    openSingleDelete(thread.id, thread.subject);
  }

  const syncChip = syncStatus === "ok"
    ? { label: `ซิงก์แล้ว ${formatSyncTime(lastSyncedAt)}`, cls: "border-emerald-200 bg-emerald-50 text-emerald-700", bar: "bg-emerald-500" }
    : syncStatus === "syncing"
      ? { label: "กำลังซิงก์…", cls: "border-amber-200 bg-amber-50 text-amber-700", bar: "bg-amber-400" }
      : syncStatus === "error"
        ? { label: "รีเฟรชไม่สำเร็จ", cls: "border-red-200 bg-red-50 text-red-700", bar: "bg-red-500" }
        : { label: "รอซิงก์", cls: "border-slate-200 bg-slate-50 text-slate-500", bar: "bg-slate-300" };

  return (
    <main className="grid gap-3">
      <header className="flex flex-wrap items-center gap-2 px-1">
        <h2 className="mr-auto text-2xl font-black text-slate-950">อีเมล Support</h2>

        <span title={syncMessage || undefined}
          className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${syncChip.cls}`}>
          {syncChip.label}
        </span>
        <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-black text-blue-700">
          ยังไม่อ่าน {unreadCount}
        </span>
        <button type="button" onClick={() => void loadInbox(false)} disabled={busy !== ""}
          className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          ↻ รีเฟรช
        </button>
        <button type="button" onClick={() => setComposeOpen(true)}
          className="rounded-full bg-[#1d4ed8] px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-blue-700">
          ✎ เขียน
        </button>
      </header>

      {!bridgeCurrent ? (
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-800">
          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" />
          <span className="min-w-0 flex-1">
            Inbox ใช้งานได้ปกติ · ต้อง Deploy Code.gs Support Mail เวอร์ชันล่าสุด 1 ครั้ง เพื่อเปิด ทั้งหมด / ติดดาว / ส่งแล้ว / เก็บถาวร / ลบ
          </span>
          <span className="rounded-full bg-white px-2 py-1 text-[10px] text-amber-700">Bridge {bridgeVersion}</span>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-700">
          <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError("")} className="text-red-500">×</button>
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-14 flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2">
          <button type="button" onClick={() => setNavCollapsed((value) => !value)}
            title={navCollapsed ? "ขยายเมนู" : "ย่อเมนู"}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-[#17324d] hover:bg-slate-50">
            ☰
          </button>

          <div className="flex items-center gap-1 overflow-x-auto">
            {folderItems.map((item) => (
              <button key={item.key} type="button" onClick={() => changeFolder(item.key)}
                disabled={!folderSupported(item.key)}
                title={!folderSupported(item.key) ? "ต้องอัปเดต Support Mail Bridge ก่อน" : undefined}
                className={`whitespace-nowrap rounded-full px-3 py-2 text-xs font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  folder === item.key
                    ? "bg-[#17324d] text-white"
                    : "bg-slate-50 text-slate-600 hover:bg-slate-100"
                }`}>
                <span className="mr-1.5">{item.icon}</span>{item.label}
                {item.key === "inbox" && unreadCount > 0 ? <span className="ml-1.5 opacity-80">{unreadCount}</span> : null}
              </button>
            ))}
          </div>

          <form onSubmit={submitSearch} className="ml-auto flex min-w-[260px] max-w-[440px] flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-full border border-slate-200 bg-slate-50 px-3">
              <span className="mr-2 text-slate-400">⌕</span>
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
                placeholder="ค้นหาอีเมล"
                className="min-w-0 flex-1 bg-transparent py-2 text-sm text-slate-800 outline-none placeholder:text-slate-400" />
            </div>
            <button type="submit"
              className="rounded-full border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
              ค้นหา
            </button>
          </form>
        </div>

        <div className={`h-1 ${syncChip.bar}`} />

        <div className={`grid min-h-[700px] ${
          navCollapsed
            ? "xl:grid-cols-[70px_420px_minmax(0,1fr)] lg:grid-cols-[70px_380px_minmax(0,1fr)]"
            : "xl:grid-cols-[150px_420px_minmax(0,1fr)] lg:grid-cols-[140px_380px_minmax(0,1fr)]"
        }`}>
          <aside className="border-r border-slate-200 bg-[#f8fbff] p-2.5">
            <button type="button" onClick={() => setComposeOpen(true)}
              title="เขียนอีเมลใหม่"
              className={`mb-3 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-100 py-3 text-sm font-black text-[#17324d] shadow-sm hover:bg-blue-200 ${navCollapsed ? "px-1" : "px-3"}`}>
              <span className="text-lg">✎</span>
              {!navCollapsed ? <span>เขียน</span> : null}
            </button>

            <label title="แสดงเฉพาะยังไม่อ่าน"
              className={`flex items-center gap-2 rounded-xl px-2 py-2 text-xs font-bold text-slate-600 hover:bg-white ${navCollapsed ? "justify-center" : ""}`}>
              <input type="checkbox" checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)} />
              {!navCollapsed ? <span>ยังไม่อ่าน</span> : null}
            </label>

            {!navCollapsed ? (
              <>
                <div className="my-3 border-t border-slate-200" />
                <div className="px-2 text-[10px] leading-5 text-slate-400">
                  <strong className="text-slate-500">สถานะ</strong><br />
                  {syncStatus === "ok" ? "เชื่อมต่อแล้ว" : syncStatus === "syncing" ? "กำลังซิงก์" : syncStatus === "error" ? "ซิงก์มีปัญหา" : "กำลังเตรียม"}
                  {lastSyncedAt ? <><br />{formatSyncTime(lastSyncedAt)}</> : null}
                </div>
              </>
            ) : (
              <div className={`mx-auto mt-4 h-2.5 w-2.5 rounded-full ${syncChip.bar}`} title={syncChip.label} />
            )}
          </aside>

          <aside className="min-h-0 border-r border-slate-200 bg-white">
            <div className="flex min-h-12 items-center gap-2 border-b border-slate-100 px-3">
              <input type="checkbox" aria-label="เลือกทั้งหมดในหน้านี้"
                checked={allVisibleSelected}
                onChange={toggleAllVisible} />
              {selectedIds.length ? (
                <>
                  <span className="text-xs font-black text-[#17324d]">เลือก {selectedIds.length}</span>
                  <button type="button" onClick={openSelectedDelete}
                    className="rounded-lg bg-red-50 px-2.5 py-1.5 text-[11px] font-black text-red-700 hover:bg-red-100">
                    ลบที่เลือก
                  </button>
                  <button type="button" onClick={() => setSelectedIds([])}
                    className="text-[11px] font-bold text-slate-400 hover:text-slate-700">ยกเลิก</button>
                </>
              ) : (
                <>
                  <strong className="text-xs text-slate-600">
                    {folderItems.find((item) => item.key === folder)?.label}
                  </strong>
                  <span className="text-[10px] font-bold text-slate-400">{threads.length} รายการ</span>
                  {threads.length ? (
                    <button type="button" onClick={openDeleteAllVisible} disabled={!canTrash}
                      className="ml-auto rounded-lg px-2 py-1 text-[10px] font-black text-red-500 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                      ลบทั้งหมดในหน้า
                    </button>
                  ) : null}
                </>
              )}
            </div>

            <div className="max-h-[652px] overflow-y-auto">
              {threads.length ? threads.map((thread) => {
                const current = selectedId === thread.id;
                const checked = selectedIds.includes(thread.id);
                return (
                  <div key={thread.id} role="button" tabIndex={0}
                    onClick={() => setSelectedId(thread.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") setSelectedId(thread.id);
                    }}
                    className={`group grid cursor-pointer grid-cols-[20px_34px_minmax(0,1fr)_auto] items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition ${
                      current
                        ? "bg-blue-50"
                        : thread.unread
                          ? "bg-white hover:bg-slate-50"
                          : "bg-slate-50/50 hover:bg-slate-100"
                    }`}>
                    <input type="checkbox" checked={checked} aria-label="เลือกอีเมล"
                      onChange={() => toggleSelected(thread.id)}
                      onClick={(event) => event.stopPropagation()}
                      className="mt-2" />
                    <div className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-black ${
                      thread.unread ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-600"
                    }`}>
                      {avatarText(thread.from)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={`${thread.unread ? "font-black text-slate-950" : "font-bold text-slate-700"} truncate text-sm`}>
                          {senderLabel(thread.from)}
                        </span>
                        {thread.starred ? <span className="text-amber-500">★</span> : null}
                      </div>
                      <div className={`mt-0.5 truncate text-xs ${thread.unread ? "font-black text-slate-900" : "font-semibold text-slate-700"}`}>
                        {thread.subject || "(ไม่มีหัวข้อ)"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">{thread.snippet || "—"}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className={`whitespace-nowrap pt-0.5 text-[10px] ${thread.unread ? "font-black text-slate-700" : "text-slate-400"}`}>
                        {formatDate(thread.last_message_at)}
                      </span>
                      <button type="button" title={canTrash ? "ลบ" : "ต้องอัปเดต Support Mail Bridge ก่อน"}
                        disabled={!canTrash}
                        onClick={(event) => rowTrash(event, thread)}
                        className="hidden rounded-md px-1.5 py-1 text-[11px] text-red-500 hover:bg-red-50 group-hover:block disabled:cursor-not-allowed disabled:opacity-30">
                        ✕
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="p-10 text-center text-xs font-bold text-slate-500">
                  {busy === "inbox" ? "กำลังโหลดอีเมล..." : "ไม่พบอีเมลในกล่องนี้"}
                </div>
              )}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col bg-white">
            {detail?.thread ? (
              <>
                <div className="flex min-h-12 flex-wrap items-center gap-1.5 border-b border-slate-100 px-4 py-2">
                  <button type="button" onClick={() => setReplyOpen(true)}
                    className="rounded-lg bg-[#17324d] px-3 py-2 text-xs font-black text-white hover:bg-[#244765]">
                    ↩ ตอบกลับ
                  </button>
                  {folder === "inbox" ? (
                    <button type="button" onClick={() => void archiveSelected()} disabled={busy === "archive"}
                      className="rounded-lg px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                      ▣ เก็บถาวร
                    </button>
                  ) : null}
                  <button type="button" onClick={() => openSingleDelete(detail.thread.id, detail.thread.subject)}
                    disabled={!canTrash}
                    title={!canTrash ? "ต้องอัปเดต Support Mail Bridge ก่อน" : undefined}
                    className="rounded-lg px-3 py-2 text-xs font-black text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">
                    ✕ ลบ
                  </button>
                  <button type="button" onClick={() => void loadThread(selectedId)} disabled={busy === "thread"}
                    className="rounded-lg px-3 py-2 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                    ↻
                  </button>
                  <span className="ml-auto text-[10px] font-bold text-slate-400">{detail.thread.message_count} ข้อความ</span>
                </div>

                <header className="border-b border-slate-100 px-6 py-4">
                  <h3 className="text-xl font-black leading-8 text-[#17324d]">{detail.thread.subject || "(ไม่มีหัวข้อ)"}</h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">ล่าสุด {formatDate(detail.thread.last_message_at)}</p>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                  {detail.messages.map((message) => {
                    const mine = message.from.toLowerCase().includes(mailbox.toLowerCase());
                    return (
                      <article key={message.id} className="border-b border-slate-100 py-5 last:border-b-0">
                        <div className="flex items-start gap-3">
                          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black ${
                            mine ? "bg-[#1d4ed8] text-white" : "bg-slate-200 text-slate-700"
                          }`}>
                            {mine ? "CP" : avatarText(message.from)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <strong className="text-sm text-slate-900">{mine ? "CpIPOS Support" : senderLabel(message.from)}</strong>
                              <span className="text-[11px] text-slate-400">&lt;{senderAddress(message.from)}&gt;</span>
                              <span className="ml-auto text-[11px] text-slate-400">{formatDate(message.date)}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">
                              ถึง {message.to || "—"}{message.cc ? ` · Cc ${message.cc}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="mt-4 whitespace-pre-wrap break-words pl-[52px] text-sm leading-7 text-slate-800">
                          {message.body || "(ไม่มีข้อความ)"}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="flex min-h-[650px] items-center justify-center p-8 text-center">
                <div>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-blue-50 text-2xl text-[#1d4ed8]">✉</div>
                  <div className="text-lg font-black text-[#17324d]">เลือกอีเมลจากรายการ</div>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">อ่าน ตอบกลับ เก็บถาวร หรือลบอีเมลได้จากหลังบ้าน IT โดยตรง</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      {composeOpen ? (
        <section className="fixed bottom-4 right-4 z-50 flex h-[560px] w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
          <header className="flex items-center gap-3 bg-[#17324d] px-4 py-3 text-white">
            <strong className="text-sm">ข้อความใหม่</strong>
            <span className="ml-auto truncate text-[10px] text-slate-300">{mailbox}</span>
            <button type="button" onClick={() => setComposeOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/10">×</button>
          </header>
          <input value={composeTo} onChange={(event) => setComposeTo(event.target.value)} placeholder="ถึง"
            className="border-b border-slate-200 px-4 py-3 text-sm outline-none" />
          <input value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)} placeholder="เรื่อง"
            className="border-b border-slate-200 px-4 py-3 text-sm outline-none" />
          <textarea value={composeBody} onChange={(event) => setComposeBody(event.target.value)} placeholder="เขียนข้อความ"
            className="min-h-0 flex-1 resize-none px-4 py-4 text-sm leading-6 outline-none" />
          <footer className="flex items-center border-t border-slate-100 px-4 py-3">
            <button type="button" onClick={() => void sendNewMail()}
              disabled={busy === "compose" || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
              className="rounded-full bg-[#1d4ed8] px-6 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {busy === "compose" ? "กำลังส่ง..." : "ส่ง"}
            </button>
          </footer>
        </section>
      ) : null}

      {replyOpen && detail?.thread ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/30 p-4 backdrop-blur-[1px]"
          onMouseDown={(event) => { if (event.currentTarget === event.target) setReplyOpen(false); }}>
          <section className="flex h-[520px] w-[min(760px,100%)] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <header className="flex items-center gap-3 bg-[#17324d] px-4 py-3 text-white">
              <strong className="text-sm">ตอบกลับอีเมล</strong>
              <span className="ml-auto truncate text-[10px] text-slate-300">{mailbox}</span>
              <button type="button" onClick={() => setReplyOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/10">×</button>
            </header>
            <div className="grid gap-1 border-b border-slate-200 px-4 py-3 text-xs text-slate-600">
              <div><strong className="text-slate-800">ถึง:</strong> {replyTarget || "ผู้ส่ง"}</div>
              <div className="truncate"><strong className="text-slate-800">เรื่อง:</strong> Re: {detail.thread.subject || "(ไม่มีหัวข้อ)"}</div>
            </div>
            <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)}
              placeholder="พิมพ์ข้อความตอบกลับ…" autoFocus
              className="min-h-0 flex-1 resize-none px-4 py-4 text-sm leading-7 outline-none" />
            <footer className="flex items-center border-t border-slate-100 px-4 py-3">
              <button type="button" onClick={() => void sendReply()}
                disabled={busy === "reply" || !replyBody.trim()}
                className="rounded-full bg-[#1d4ed8] px-6 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                {busy === "reply" ? "กำลังส่ง..." : "ส่งตอบกลับ"}
              </button>
              <button type="button" onClick={() => setReplyOpen(false)}
                className="ml-2 rounded-full px-4 py-2.5 text-xs font-black text-slate-500 hover:bg-slate-100">
                ยกเลิก
              </button>
            </footer>
          </section>
        </div>
      ) : null}

      {deleteDialog ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-[1px]"
          onMouseDown={(event) => { if (event.currentTarget === event.target && busy !== "trash") setDeleteDialog(null); }}>
          <section className="w-[min(460px,100%)] rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-xl text-red-600">✕</div>
            <h3 className="mt-4 text-lg font-black text-slate-950">{deleteDialog.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-500">{deleteDialog.detail}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setDeleteDialog(null)} disabled={busy === "trash"}
                className="rounded-full px-4 py-2.5 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                ยกเลิก
              </button>
              <button type="button" onClick={() => void confirmTrash()} disabled={busy === "trash"}
                className="rounded-full bg-red-600 px-5 py-2.5 text-xs font-black text-white hover:bg-red-700 disabled:opacity-50">
                {busy === "trash" ? "กำลังลบ..." : "ย้ายไปถังขยะ"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
