"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type ThreadSummary = {
  id: string;
  subject: string;
  from: string;
  to: string;
  snippet: string;
  last_message_at: string;
  message_count: number;
  unread: boolean;
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

function formatDate(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Bangkok"
  }).format(new Date(value));
}

function senderLabel(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "ไม่ทราบผู้ส่ง";
  return value.length > 72 ? value.slice(0, 69) + "…" : value;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error?.message || "ทำรายการไม่สำเร็จ");
  }
  return payload.data;
}

export function SupportMailConsole() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ThreadData | null>(null);
  const [mailbox, setMailbox] = useState("cuttingpointtech.support@gmail.com");
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

  const loadInbox = useCallback(async () => {
    setError("");
    setBusy((current) => current || "inbox");
    try {
      const params = new URLSearchParams();
      if (activeQuery) params.set("q", activeQuery);
      if (unreadOnly) params.set("unread", "1");
      const data = await request<InboxData>(`/api/it-admin/v1/support-mail?${params.toString()}`);
      setMailbox(data.mailbox);
      setThreads(data.threads);
      setSelectedId((current) => {
        if (current && data.threads.some((item) => item.id === current)) return current;
        return data.threads[0]?.id ?? "";
      });
      if (!data.threads.length) setDetail(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดกล่องอีเมลไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, [activeQuery, unreadOnly]);

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
      setError(cause instanceof Error ? cause.message : "เปิดอีเมลไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  useEffect(() => {
    if (selectedId) void loadThread(selectedId);
  }, [selectedId, loadThread]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && busy === "") void loadInbox();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [loadInbox, busy]);

  const unreadCount = useMemo(
    () => threads.reduce((sum, thread) => sum + (thread.unread ? 1 : 0), 0),
    [threads]
  );

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setActiveQuery(searchInput.trim());
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
      await Promise.all([loadThread(selectedId), loadInbox()]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตอบกลับอีเมลไม่สำเร็จ");
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
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ส่งอีเมลไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function archiveSelected() {
    if (!selectedId) return;
    if (!window.confirm("Archive อีเมลชุดนี้ออกจาก Inbox? ยังค้นหาใน Gmail ได้ภายหลัง")) return;
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
      await loadInbox();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Archive อีเมลไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-2xl font-black text-slate-950">อีเมล Support</h2>
          <p className="mt-1 text-xs font-bold text-slate-500">
            {mailbox} · Inbox / Reply / Send · รีเฟรชอัตโนมัติทุก 30 วินาที
          </p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-2 text-xs font-black text-blue-700">
          ยังไม่อ่าน {unreadCount}
        </span>
        <button type="button" onClick={() => setComposeOpen((value) => !value)}
          className="rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white shadow-sm">
          {composeOpen ? "ปิดหน้าส่งใหม่" : "เขียนอีเมลใหม่"}
        </button>
        <button type="button" onClick={() => void loadInbox()} disabled={busy !== ""}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-black text-slate-700">
          รีเฟรช
        </button>
      </header>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">
          {error}
        </div>
      ) : null}

      {composeOpen ? (
        <section className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4 shadow-sm">
          <div className="text-sm font-black text-slate-900">ส่งจาก {mailbox}</div>
          <input value={composeTo} onChange={(event) => setComposeTo(event.target.value)}
            placeholder="ถึง: customer@example.com"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <input value={composeSubject} onChange={(event) => setComposeSubject(event.target.value)}
            placeholder="หัวข้อ"
            className="rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <textarea value={composeBody} onChange={(event) => setComposeBody(event.target.value)}
            rows={7} placeholder="ข้อความอีเมล"
            className="resize-y rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
          <div className="flex justify-end">
            <button type="button" onClick={() => void sendNewMail()}
              disabled={busy === "compose" || !composeTo.trim() || !composeSubject.trim() || !composeBody.trim()}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">
              {busy === "compose" ? "กำลังส่ง..." : "ส่งอีเมล"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="grid min-h-[720px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[370px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-slate-50/60">
          <form onSubmit={submitSearch} className="border-b border-slate-200 p-3">
            <div className="flex gap-2">
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)}
                placeholder="ค้นหา Gmail เช่น from:, subject:, คำค้น"
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
              <button type="submit" className="rounded-xl border border-slate-300 bg-white px-3 text-xs font-black text-slate-700">
                ค้นหา
              </button>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs font-bold text-slate-600">
              <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
              แสดงเฉพาะยังไม่อ่าน
            </label>
          </form>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {threads.length ? threads.map((thread) => (
              <button key={thread.id} type="button" onClick={() => setSelectedId(thread.id)}
                className={"block w-full border-b border-slate-100 p-3 text-left transition " +
                  (selectedId === thread.id ? "bg-blue-50" : "bg-white hover:bg-slate-50")}>
                <div className="flex items-start gap-2">
                  <strong className={"min-w-0 flex-1 truncate text-sm " + (thread.unread ? "text-slate-950" : "text-slate-700")}>
                    {thread.subject || "(ไม่มีหัวข้อ)"}
                  </strong>
                  {thread.unread ? <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" /> : null}
                </div>
                <div className="mt-1 truncate text-xs font-bold text-slate-600">{senderLabel(thread.from)}</div>
                <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{thread.snippet || "—"}</div>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                  <span>{thread.message_count} ข้อความ</span>
                  <span>{formatDate(thread.last_message_at)}</span>
                </div>
              </button>
            )) : (
              <div className="p-8 text-center text-xs font-bold text-slate-500">
                {busy === "inbox" ? "กำลังโหลดอีเมล..." : "ไม่พบอีเมลใน Inbox"}
              </div>
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {detail?.thread ? (
            <>
              <header className="flex flex-wrap items-start gap-3 border-b border-slate-200 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-base font-black text-slate-950">{detail.thread.subject || "(ไม่มีหัวข้อ)"}</h3>
                  <p className="mt-1 truncate text-xs text-slate-500">
                    ล่าสุด {formatDate(detail.thread.last_message_at)} · {detail.thread.message_count} ข้อความ
                  </p>
                </div>
                <button type="button" onClick={() => void archiveSelected()} disabled={busy === "archive"}
                  className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">
                  Archive
                </button>
              </header>

              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[#f7faff] p-4">
                {busy === "thread" && !detail.messages.length ? (
                  <div className="text-center text-xs text-slate-500">กำลังโหลด Thread...</div>
                ) : null}
                {detail.messages.map((message) => {
                  const mine = message.from.toLowerCase().includes(mailbox.toLowerCase());
                  return (
                    <article key={message.id}
                      className={"rounded-2xl border p-4 shadow-sm " +
                        (mine ? "ml-auto max-w-[84%] border-blue-200 bg-blue-50" : "mr-auto max-w-[84%] border-slate-200 bg-white")}>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                        <strong className="text-slate-800">{mine ? "CpIPOS Support" : senderLabel(message.from)}</strong>
                        <span>→ {message.to || "—"}</span>
                        <span className="ml-auto">{formatDate(message.date)}</span>
                      </div>
                      <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-800">
                        {message.body || "(ไม่มีข้อความ)"}
                      </div>
                    </article>
                  );
                })}
              </div>

              <div className="border-t border-slate-200 bg-white p-3">
                <textarea value={replyBody} onChange={(event) => setReplyBody(event.target.value)}
                  rows={5} placeholder="ตอบกลับ Thread นี้จาก cuttingpointtech.support@gmail.com"
                  className="w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm outline-none focus:border-blue-500" />
                <div className="mt-2 flex justify-end">
                  <button type="button" onClick={() => void sendReply()}
                    disabled={busy === "reply" || !replyBody.trim()}
                    className="rounded-xl bg-blue-600 px-5 py-2.5 text-xs font-black text-white disabled:opacity-50">
                    {busy === "reply" ? "กำลังตอบ..." : "ตอบกลับ"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex min-h-[560px] items-center justify-center p-8 text-center">
              <div>
                <div className="text-lg font-black text-slate-800">เลือกอีเมลจาก Inbox</div>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">
                  อ่านและตอบกลับลูกค้าได้จากหลังบ้าน IT โดยตรง ระบบไม่เปิดเผย Gmail credential ให้ Browser
                </p>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
