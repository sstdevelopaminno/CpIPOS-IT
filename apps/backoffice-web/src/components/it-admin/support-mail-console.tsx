"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";

type MailFolder = "inbox" | "starred" | "sent" | "archive";

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

const folderItems: Array<{ key: MailFolder; label: string; icon: string }> = [
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

function senderLabel(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "ไม่ทราบผู้ส่ง";
  const match = value.match(/^"?([^"<]+)"?\s*</);
  const label = match?.[1]?.trim() || value.replace(/<[^>]+>/g, "").trim() || value;
  return label.length > 52 ? label.slice(0, 49) + "…" : label;
}

function avatarText(raw: string) {
  const label = senderLabel(raw);
  const parts = label.split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "M").toUpperCase();
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
  const [detail, setDetail] = useState<ThreadData | null>(null);
  const [mailbox, setMailbox] = useState("cuttingpointtech.support@gmail.com");
  const [folder, setFolder] = useState<MailFolder>("inbox");
  const [searchInput, setSearchInput] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [syncNotice, setSyncNotice] = useState("");
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const inboxLoadingRef = useRef(false);

  const loadInbox = useCallback(async (silent = false) => {
    if (inboxLoadingRef.current) return;
    inboxLoadingRef.current = true;
    if (!silent) {
      setError("");
      setBusy("inbox");
    }
    try {
      const params = new URLSearchParams({ folder });
      if (activeQuery) params.set("q", activeQuery);
      if (unreadOnly) params.set("unread", "1");
      const data = await request<InboxData>(`/api/it-admin/v1/support-mail?${params.toString()}`);
      setMailbox(data.mailbox);
      setThreads(data.threads);
      setLastSyncedAt(new Date());
      setSyncNotice("");
      setSelectedId((current) => {
        if (current && data.threads.some((item) => item.id === current)) return current;
        return data.threads[0]?.id ?? "";
      });
      if (!data.threads.length) setDetail(null);
    } catch (cause) {
      const message = normalizeError(cause, "โหลดกล่องอีเมลไม่สำเร็จ");
      if (silent) {
        setSyncNotice("รีเฟรชเบื้องหลังไม่สำเร็จ ระบบจะลองใหม่อัตโนมัติ");
      } else {
        setError(message);
      }
    } finally {
      inboxLoadingRef.current = false;
      if (!silent) setBusy("");
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
      setError(normalizeError(cause, "เปิดอีเมลไม่สำเร็จ"));
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
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadInbox]);

  const unreadCount = useMemo(
    () => threads.reduce((sum, thread) => sum + (thread.unread ? 1 : 0), 0),
    [threads]
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSelectedId("");
    setDetail(null);
    setActiveQuery(searchInput.trim());
  }

  function changeFolder(next: MailFolder) {
    if (next === folder) return;
    setFolder(next);
    setSelectedId("");
    setDetail(null);
    setError("");
    setSyncNotice("");
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
      await loadInbox(false);
    } catch (cause) {
      setError(normalizeError(cause, "Archive อีเมลไม่สำเร็จ"));
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="grid gap-3">
      <header className="flex flex-wrap items-center gap-3 px-1">
        <div className="mr-auto">
          <h2 className="text-2xl font-black text-slate-950">อีเมล Support</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">
            {mailbox} · Support mailbox · รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">
          ยังไม่อ่าน {unreadCount}
        </span>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}

      {syncNotice ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-bold text-amber-700">
          {syncNotice}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <form onSubmit={submitSearch} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-full bg-slate-100 px-4">
              <span className="mr-2 text-slate-500">⌕</span>
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="ค้นหาอีเมล เช่น from:, subject:, Store Code หรือคำค้น"
                className="min-w-0 flex-1 bg-transparent py-3 text-sm text-slate-800 outline-none placeholder:text-slate-400"
              />
            </div>
            <button type="submit"
              className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50">
              ค้นหา
            </button>
          </form>
          <button type="button" onClick={() => void loadInbox(false)} disabled={busy !== ""}
            className="rounded-full border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            ↻ รีเฟรช
          </button>
        </div>

        <div className="grid min-h-[720px] xl:grid-cols-[190px_430px_minmax(0,1fr)] lg:grid-cols-[170px_390px_minmax(0,1fr)]">
          <aside className="border-r border-slate-200 bg-white p-3">
            <button type="button" onClick={() => setComposeOpen(true)}
              className="mb-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-100 px-4 py-3 text-sm font-black text-blue-950 shadow-sm hover:bg-blue-200">
              <span className="text-lg">✎</span>
              เขียน
            </button>

            <nav className="grid gap-1">
              {folderItems.map((item) => (
                <button key={item.key} type="button" onClick={() => changeFolder(item.key)}
                  className={"flex items-center gap-3 rounded-r-full px-3 py-2.5 text-left text-sm font-bold transition " +
                    (folder === item.key
                      ? "bg-blue-100 text-blue-950"
                      : "text-slate-700 hover:bg-slate-100")}>
                  <span className="w-5 text-center text-base">{item.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.key === "inbox" && unreadCount > 0 ? (
                    <span className="text-xs font-black">{unreadCount}</span>
                  ) : null}
                </button>
              ))}
            </nav>

            <label className="mt-5 flex items-center gap-2 border-t border-slate-100 pt-4 text-xs font-bold text-slate-600">
              <input type="checkbox" checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)} />
              เฉพาะยังไม่อ่าน
            </label>

            <div className="mt-6 text-[10px] leading-5 text-slate-400">
              {lastSyncedAt ? <>อัปเดตล่าสุด<br />{formatDate(lastSyncedAt.toISOString())}</> : "กำลังเชื่อมต่อ Gmail…"}
            </div>
          </aside>

          <aside className="min-h-0 border-r border-slate-200 bg-white">
            <div className="flex h-11 items-center border-b border-slate-100 px-3 text-xs font-black text-slate-600">
              {folderItems.find((item) => item.key === folder)?.label}
              <span className="ml-auto font-bold text-slate-400">{threads.length} รายการ</span>
            </div>

            <div className="max-h-[676px] overflow-y-auto">
              {threads.length ? threads.map((thread) => {
                const selected = selectedId === thread.id;
                return (
                  <button key={thread.id} type="button" onClick={() => setSelectedId(thread.id)}
                    className={"group grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left transition " +
                      (selected
                        ? "bg-blue-50"
                        : thread.unread
                          ? "bg-white hover:bg-slate-50"
                          : "bg-slate-50/60 hover:bg-slate-100")}>
                    <div className={"mt-0.5 flex h-8 w-8 items-center justify-center rounded-full text-xs font-black " +
                      (thread.unread ? "bg-blue-100 text-blue-800" : "bg-slate-200 text-slate-600")}>
                      {avatarText(thread.from)}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1">
                        <span className={(thread.unread ? "font-black text-slate-950" : "font-bold text-slate-700") + " truncate text-sm"}>
                          {senderLabel(thread.from)}
                        </span>
                        {thread.starred ? <span className="text-amber-500">★</span> : null}
                      </div>
                      <div className={"mt-0.5 truncate text-xs " + (thread.unread ? "font-black text-slate-900" : "font-semibold text-slate-700")}>
                        {thread.subject || "(ไม่มีหัวข้อ)"}
                      </div>
                      <div className="mt-0.5 truncate text-[11px] text-slate-500">
                        {thread.snippet || "—"}
                      </div>
                    </div>
                    <div className={"whitespace-nowrap pt-0.5 text-[10px] " + (thread.unread ? "font-black text-slate-700" : "text-slate-400")}>
                      {formatDate(thread.last_message_at)}
                    </div>
                  </button>
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
                <div className="flex h-11 items-center gap-2 border-b border-slate-100 px-4">
                  {folder === "inbox" ? (
                    <button type="button" onClick={() => void archiveSelected()} disabled={busy === "archive"}
                      className="rounded-lg px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                      ▣ Archive
                    </button>
                  ) : null}
                  <button type="button" onClick={() => void loadThread(selectedId)} disabled={busy === "thread"}
                    className="rounded-lg px-3 py-1.5 text-xs font-black text-slate-600 hover:bg-slate-100 disabled:opacity-50">
                    ↻ รีเฟรช
                  </button>
                  <span className="ml-auto text-[10px] font-bold text-slate-400">
                    {detail.thread.message_count} ข้อความ
                  </span>
                </div>

                <header className="border-b border-slate-100 px-6 py-5">
                  <h3 className="text-xl font-black leading-8 text-slate-950">
                    {detail.thread.subject || "(ไม่มีหัวข้อ)"}
                  </h3>
                  <p className="mt-1 text-xs font-bold text-slate-400">
                    ล่าสุด {formatDate(detail.thread.last_message_at)}
                  </p>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
                  {busy === "thread" && !detail.messages.length ? (
                    <div className="py-10 text-center text-xs text-slate-500">กำลังโหลด Thread...</div>
                  ) : null}

                  {detail.messages.map((message) => {
                    const mine = message.from.toLowerCase().includes(mailbox.toLowerCase());
                    return (
                      <article key={message.id} className="border-b border-slate-100 py-5 last:border-b-0">
                        <div className="flex items-start gap-3">
                          <div className={"flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-black " +
                            (mine ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-700")}>
                            {mine ? "CP" : avatarText(message.from)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                              <strong className="text-sm text-slate-900">
                                {mine ? "CpIPOS Support" : senderLabel(message.from)}
                              </strong>
                              <span className="text-[11px] text-slate-400">
                                &lt;{mine ? mailbox : message.from.replace(/^.*<([^>]+)>.*$/, "$1")}&gt;
                              </span>
                              <span className="ml-auto text-[11px] text-slate-400">{formatDate(message.date)}</span>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-400">
                              ถึง {message.to || "—"}{message.cc ? ` · Cc ${message.cc}` : ""}
                            </div>
                          </div>
                        </div>
                        <div className="ml-13 mt-4 whitespace-pre-wrap break-words pl-[52px] text-sm leading-7 text-slate-800">
                          {message.body || "(ไม่มีข้อความ)"}
                        </div>
                      </article>
                    );
                  })}

                  <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-2 text-xs font-black text-slate-600">ตอบกลับจาก {mailbox}</div>
                    <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)}
                      rows={5} placeholder="พิมพ์ข้อความตอบกลับ…"
                      className="w-full resize-y border-0 bg-transparent text-sm leading-6 text-slate-800 outline-none placeholder:text-slate-400" />
                    <div className="mt-3 flex justify-end">
                      <button type="button" onClick={() => void sendReply()}
                        disabled={busy === "reply" || !replyBody.trim()}
                        className="rounded-full bg-blue-600 px-5 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
                        {busy === "reply" ? "กำลังส่ง..." : "ตอบกลับ"}
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex min-h-[650px] items-center justify-center p-8 text-center">
                <div>
                  <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-2xl text-slate-500">✉</div>
                  <div className="text-lg font-black text-slate-800">เลือกอีเมลจากรายการ</div>
                  <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                    อ่านและตอบลูกค้าจากหลังบ้าน IT ได้โดยตรง โดยระบบไม่เปิดเผย Gmail credential ให้ Browser
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </section>

      {composeOpen ? (
        <section className="fixed bottom-4 right-4 z-50 flex h-[570px] w-[min(620px,calc(100vw-32px))] flex-col overflow-hidden rounded-2xl border border-slate-300 bg-white shadow-2xl">
          <header className="flex items-center gap-3 bg-slate-800 px-4 py-3 text-white">
            <strong className="text-sm">ข้อความใหม่</strong>
            <span className="ml-auto truncate text-[10px] text-slate-300">{mailbox}</span>
            <button type="button" onClick={() => setComposeOpen(false)}
              className="rounded-lg px-2 py-1 text-lg leading-none hover:bg-white/10">×</button>
          </header>
          <input value={composeTo} onChange={(event) => setComposeTo(event.target.value)}
            placeholder="ถึง"
            className="border-b border-slate-200 px-4 py-3 text-sm outline-none" />
          <input value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)}
            placeholder="เรื่อง"
            className="border-b border-slate-200 px-4 py-3 text-sm outline-none" />
          <textarea value={composeBody} onChange={(event) => setComposeBody(event.target.value)}
            placeholder="เขียนข้อความ"
            className="min-h-0 flex-1 resize-none px-4 py-4 text-sm leading-6 outline-none" />
          <footer className="flex items-center border-t border-slate-100 px-4 py-3">
            <button type="button" onClick={() => void sendNewMail()}
              disabled={busy === "compose" || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
              className="rounded-full bg-blue-600 px-6 py-2.5 text-xs font-black text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">
              {busy === "compose" ? "กำลังส่ง..." : "ส่ง"}
            </button>
            <span className="ml-3 text-[10px] font-bold text-slate-400">สูงสุด 5 ผู้รับต่อครั้ง</span>
          </footer>
        </section>
      ) : null}
    </main>
  );
}
