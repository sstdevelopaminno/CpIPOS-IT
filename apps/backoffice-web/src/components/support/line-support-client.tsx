"use client";

import Image from "next/image";
import Script from "next/script";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

type LiffApi = {
  init(input: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(input?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

declare global {
  interface Window {
    liff?: LiffApi;
  }
}

type Store = {
  code: string;
  name: string;
  logo_url: string | null;
};

type AuthResult =
  | { state: "ready"; store: Store }
  | {
      state: "verification_required";
      challenge_id: string;
      masked_email: string;
      expires_in_seconds: number;
      store: Store;
    };

type Conversation = {
  id: string;
  status: string;
  store_name?: string;
  subject?: string;
  assigned_user_name?: string | null;
  assigned_role?: string | null;
};

type Message = {
  id: string;
  sender_type: "store" | "it" | "system";
  sender_name?: string;
  message_body: string;
  created_at: string;
};

type ChatDetail = {
  conversation: Conversation;
  messages: Message[];
};

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

const LIFF_SCRIPT = "https://static.line-scdn.net/liff/edge/2/sdk.js";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message || "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
  }
  return body.data;
}

function thaiTime(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("th-TH", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}

function statusText(status: string) {
  if (status === "new" || status === "unassigned") return "รอทีม Support รับเรื่อง";
  if (status === "in_progress") return "ทีม Support กำลังดูแล";
  if (status === "waiting_store") return "รอข้อความจากคุณ";
  if (status === "waiting_it") return "ส่งข้อความแล้ว · รอทีม Support";
  if (status === "closed") return "จบการสนทนาแล้ว";
  return "กำลังเชื่อมต่อ";
}

export function LineSupportClient() {
  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || "";
  const bootedRef = useRef(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState<"boot" | "store" | "otp" | "chat">("boot");
  const [idToken, setIdToken] = useState("");
  const [storeCode, setStoreCode] = useState("");
  const [store, setStore] = useState<Store | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const loadConversation = useCallback(async (conversationId: string) => {
    const detail = await api<ChatDetail>(
      "/api/support/line/chat?conversation_id=" + encodeURIComponent(conversationId)
    );
    setConversation(detail.conversation);
    setMessages(detail.messages);
    return detail;
  }, []);

  const openChat = useCallback(async () => {
    setBusy("open");
    setError("");
    try {
      const detail = await api<ChatDetail>("/api/support/line/chat", {
        method: "POST",
        body: JSON.stringify({ action: "open" })
      });
      setConversation(detail.conversation);
      setMessages(detail.messages);
      setStage("chat");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปิดแชทไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }, []);

  const boot = useCallback(async () => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    setError("");

    try {
      if (!liffId) throw new Error("ระบบยังไม่ได้ตั้งค่า LIFF ID");
      if (!window.liff) throw new Error("โหลด LINE LIFF ไม่สำเร็จ");
      await window.liff.init({ liffId });

      if (!window.liff.isLoggedIn()) {
        window.liff.login({ redirectUri: window.location.href });
        return;
      }

      const token = window.liff.getIDToken();
      if (!token) throw new Error("LINE Login ไม่ได้อนุญาต openid กรุณาเปิด Support ใหม่");
      setIdToken(token);
      const remembered = window.localStorage.getItem("cpipos_line_support_store_code") || "";
      if (/^\d{6}$/.test(remembered)) setStoreCode(remembered);
      setStage("store");
    } catch (cause) {
      bootedRef.current = false;
      setStage("store");
      setError(cause instanceof Error ? cause.message : "เริ่ม LINE Support ไม่สำเร็จ");
    }
  }, [liffId]);

  useEffect(() => {
    if (window.liff) void boot();
  }, [boot]);

  useEffect(() => {
    if (stage !== "chat" || !conversation?.id || conversation.status === "closed") return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadConversation(conversation.id).catch(() => null);
    }, 10_000);

    const refresh = () => {
      if (document.visibilityState === "visible") {
        void loadConversation(conversation.id).catch(() => null);
      }
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [stage, conversation?.id, conversation?.status, loadConversation]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length]);

  useEffect(() => {
    const logoutOnExit = () => {
      if (stage !== "chat") return;
      const body = new Blob([JSON.stringify({ action: "logout" })], { type: "application/json" });
      navigator.sendBeacon("/api/support/line/auth", body);
    };
    window.addEventListener("pagehide", logoutOnExit);
    return () => window.removeEventListener("pagehide", logoutOnExit);
  }, [stage]);

  async function startAccess(event: FormEvent) {
    event.preventDefault();
    if (!idToken) {
      setError("กรุณาเปิดหน้านี้จาก LINE Official Account");
      return;
    }
    if (!/^\d{6}$/.test(storeCode)) {
      setError("กรุณากรอกรหัสร้าน 6 หลัก");
      return;
    }

    setBusy("auth");
    setError("");
    try {
      const result = await api<AuthResult>("/api/support/line/auth", {
        method: "POST",
        body: JSON.stringify({ action: "start", id_token: idToken, store_code: storeCode })
      });
      setStore(result.store);
      window.localStorage.setItem("cpipos_line_support_store_code", storeCode);

      if (result.state === "verification_required") {
        setChallengeId(result.challenge_id);
        setMaskedEmail(result.masked_email);
        setStage("otp");
        return;
      }
      await openChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตรวจสอบร้านค้าไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setBusy("verify");
    setError("");
    try {
      const result = await api<AuthResult>("/api/support/line/auth", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          id_token: idToken,
          store_code: storeCode,
          challenge_id: challengeId,
          otp
        })
      });
      setStore(result.store);
      await openChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยืนยัน OTP ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!conversation?.id || !message || conversation.status === "closed") return;

    setBusy("send");
    setError("");
    setDraft("");
    try {
      await api("/api/support/line/chat", {
        method: "POST",
        body: JSON.stringify({
          action: "send",
          conversation_id: conversation.id,
          message
        })
      });
      await loadConversation(conversation.id);
    } catch (cause) {
      setDraft(message);
      setError(cause instanceof Error ? cause.message : "ส่งข้อความไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function logout(closeWindow = true) {
    await fetch("/api/support/line/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "logout" }),
      keepalive: true
    }).catch(() => null);

    if (closeWindow && window.liff?.isInClient()) {
      window.liff.closeWindow();
      return;
    }
    setConversation(null);
    setMessages([]);
    setStage("store");
  }

  async function closeConversation() {
    if (!conversation?.id) return;
    setBusy("close");
    setError("");
    try {
      await api("/api/support/line/chat", {
        method: "POST",
        body: JSON.stringify({ action: "close", conversation_id: conversation.id })
      });
      await logout(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "จบการสนทนาไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <Script src={LIFF_SCRIPT} strategy="afterInteractive" onLoad={() => void boot()} />
      <main className="min-h-dvh bg-slate-100 px-4 py-5 text-slate-950">
        <section className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-md flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl">
          <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
            <Image
              src="/brand/cpipos-symbol-sidebar.png"
              alt="CpIPOS"
              width={44}
              height={44}
              className="h-11 w-11 rounded-2xl border border-slate-200 bg-white object-contain"
            />
            <div className="min-w-0 flex-1">
              <div className="text-base font-black">CpIPOS Support</div>
              <div className="truncate text-xs text-slate-500">
                {store ? store.name + " · " + store.code : "ติดต่อทีม IT ผ่าน LINE"}
              </div>
            </div>
            {stage === "chat" ? (
              <button
                type="button"
                onClick={() => void logout(true)}
                className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600"
              >
                ออก
              </button>
            ) : null}
          </header>

          {stage === "boot" ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-slate-200 border-t-blue-600" />
                <div className="mt-4 text-sm font-bold">กำลังเชื่อมต่อ LINE…</div>
              </div>
            </div>
          ) : null}

          {stage === "store" ? (
            <div className="flex flex-1 flex-col justify-center p-6">
              <div className="text-2xl font-black">ติดต่อ Support</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                กรอกรหัสร้าน 6 หลักเพื่อเปิดแชทกับทีม IT โดยตรง
              </p>
              <form onSubmit={startAccess} className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black text-slate-600">รหัสร้าน</span>
                  <input
                    value={storeCode}
                    onChange={(event) => setStoreCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-center text-2xl font-black tracking-[0.28em] outline-none focus:border-blue-500"
                  />
                </label>
                {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
                <button
                  type="submit"
                  disabled={busy === "auth" || !idToken}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy === "auth" ? "กำลังตรวจสอบ…" : "เปิดแชท Support"}
                </button>
              </form>
              <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">
                ครั้งแรกระบบจะส่ง OTP ไปยังอีเมล Owner ของร้านเพื่อยืนยันการผูก LINE
              </p>
            </div>
          ) : null}

          {stage === "otp" ? (
            <div className="flex flex-1 flex-col justify-center p-6">
              <div className="text-2xl font-black">ยืนยันครั้งแรก</div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                ส่ง OTP ไปที่ <span className="font-black text-slate-800">{maskedEmail}</span> แล้ว
              </p>
              <form onSubmit={verifyOtp} className="mt-6 space-y-4">
                <input
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="OTP 6 หลัก"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-center text-2xl font-black tracking-[0.28em] outline-none focus:border-blue-500"
                />
                {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
                <button
                  type="submit"
                  disabled={busy === "verify" || otp.length !== 6}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy === "verify" ? "กำลังยืนยัน…" : "ยืนยันและเข้าแชท"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setOtp("");
                    setError("");
                    setStage("store");
                  }}
                  className="w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm font-bold text-slate-600"
                >
                  กลับไปกรอกรหัสร้าน
                </button>
              </form>
            </div>
          ) : null}

          {stage === "chat" && conversation ? (
            <>
              <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
                <div className="text-xs font-black text-blue-700">{statusText(conversation.status)}</div>
                {conversation.assigned_user_name ? (
                  <div className="mt-1 text-[11px] text-slate-500">
                    ผู้ดูแล: {conversation.assigned_user_name}
                  </div>
                ) : null}
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5">
                {messages.map((message) => {
                  if (message.sender_type === "system") {
                    return (
                      <div key={message.id} className="text-center text-[11px] text-slate-400">
                        {message.message_body}
                      </div>
                    );
                  }
                  const mine = message.sender_type === "store";
                  return (
                    <div key={message.id} className={"flex " + (mine ? "justify-end" : "justify-start")}>
                      <div className={"max-w-[82%] rounded-2xl px-4 py-3 " + (mine ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-800")}>
                        {!mine ? <div className="mb-1 text-[10px] font-black opacity-70">{message.sender_name || "IT Support"}</div> : null}
                        <div className="whitespace-pre-wrap break-words text-sm leading-6">{message.message_body}</div>
                        <div className={"mt-1 text-right text-[10px] " + (mine ? "text-blue-100" : "text-slate-400")}>
                          {thaiTime(message.created_at)}
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div ref={endRef} />
              </div>

              {error ? <div className="mx-4 mb-2 rounded-xl bg-red-50 px-4 py-2 text-xs font-semibold text-red-700">{error}</div> : null}

              {conversation.status === "closed" ? (
                <div className="border-t border-slate-100 p-4">
                  <button
                    type="button"
                    onClick={() => void openChat()}
                    disabled={busy === "open"}
                    className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black text-white"
                  >
                    เริ่มสนทนาใหม่
                  </button>
                </div>
              ) : (
                <div className="border-t border-slate-100 p-3">
                  <form onSubmit={sendMessage} className="flex items-end gap-2">
                    <textarea
                      value={draft}
                      onChange={(event) => setDraft(event.target.value.slice(0, 4000))}
                      rows={1}
                      placeholder="พิมพ์ข้อความถึงทีม IT…"
                      className="max-h-32 min-h-12 flex-1 resize-none rounded-2xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500"
                    />
                    <button
                      type="submit"
                      disabled={busy === "send" || !draft.trim()}
                      className="h-12 rounded-2xl bg-blue-600 px-4 text-sm font-black text-white disabled:opacity-50"
                    >
                      ส่ง
                    </button>
                  </form>
                  <button
                    type="button"
                    onClick={() => void closeConversation()}
                    disabled={busy === "close"}
                    className="mt-2 w-full py-2 text-xs font-bold text-slate-400"
                  >
                    จบการสนทนา
                  </button>
                </div>
              )}
            </>
          ) : null}
        </section>
      </main>
    </>
  );
}
