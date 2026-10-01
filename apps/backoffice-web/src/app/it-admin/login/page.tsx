"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";

function getCopy(lang: AppLanguage) {
  if (lang === "en") {
    return {
      subtitle: "IT Control Plane sign in",
      emailLabel: "Email",
      emailPlaceholder: "Enter email",
      emailPreviewLabel: "Entered email",
      passwordLabel: "Password",
      passwordPlaceholder: "Enter password",
      showPassword: "Show password",
      forgotPassword: "Forgot password?",
      forgotEmailRequired: "Enter your email first.",
      forgotSending: "Sending temporary password...",
      forgotSent: "A temporary password has been sent to your email. Sign in with it, then set a new password in Settings.",
      forgotError: "Unable to send a temporary password right now.",
      submit: "Log in",
      submitting: "Signing in...",
      requiredError: "Please enter email and password.",
      invalidCredentialsError: "Invalid email or password.",
      notAuthorizedError: "This account does not have IT Admin or IT Support access.",
      defaultError: "Unable to sign in right now."
    };
  }

  return {
    subtitle: "เข้าสู่ระบบ IT Control Plane",
    emailLabel: "อีเมล",
    emailPlaceholder: "กรอกอีเมล",
    emailPreviewLabel: "อีเมลที่กรอก",
    passwordLabel: "รหัสผ่าน",
    passwordPlaceholder: "กรอกรหัสผ่าน",
    showPassword: "แสดงรหัสผ่าน",
    forgotPassword: "ลืมรหัสผ่าน?",
    forgotEmailRequired: "กรุณากรอกอีเมลก่อนขอรหัสผ่านชั่วคราว",
    forgotSending: "กำลังส่งรหัสผ่านชั่วคราว...",
    forgotSent: "ส่งรหัสผ่านชั่วคราวไปยังอีเมลแล้ว ใช้รหัสดังกล่าวล็อกอิน จากนั้นตั้งรหัสใหม่ที่เมนู ตั้งค่า",
    forgotError: "ไม่สามารถส่งรหัสผ่านชั่วคราวได้ในขณะนี้",
    submit: "ล็อกอิน",
    submitting: "กำลังเข้าสู่ระบบ...",
    requiredError: "กรุณากรอกอีเมลและรหัสผ่าน",
    invalidCredentialsError: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    notAuthorizedError: "บัญชีนี้ไม่มีสิทธิ์ IT Admin หรือ IT Support",
    defaultError: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"
  };
}

const fullWidthInputBoxStyle = {
  gridTemplateColumns: "minmax(0, 1fr)",
  width: "100%"
} as const;

export default function ItAdminLoginPage() {
  const { lang, setLanguage } = useAppLanguage("th");
  const copy = useMemo(() => getCopy(lang), [lang]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotLoading, setForgotLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError(copy.requiredError);
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/it-admin/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
        cache: "no-store"
      });
      const result = (await response.json().catch(() => null)) as { code?: string; password_change_required?: boolean } | null;

      if (!response.ok) {
        if (response.status === 401 || result?.code === "invalid_credentials") {
          setError(copy.invalidCredentialsError);
        } else if (response.status === 403 || result?.code === "not_authorized") {
          setError(copy.notAuthorizedError);
        } else {
          setError(copy.defaultError);
        }
        return;
      }

      // Force a fresh document request after the Route Handler has written the
      // Supabase auth cookies. This avoids reusing a cached unauthenticated RSC
      // navigation state immediately after login.
      window.location.assign(result?.password_change_required ? "/it-admin/settings/password" : "/it-admin");
    } catch {
      setError(copy.defaultError);
    } finally {
      setLoading(false);
    }
  }

  async function handleForgotPassword() {
    if (forgotLoading) return;
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError(copy.forgotEmailRequired);
      setNotice("");
      return;
    }

    setForgotLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/it-admin/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail }),
        cache: "no-store"
      });
      if (!response.ok) {
        setError(copy.forgotError);
        return;
      }
      setNotice(copy.forgotSent);
    } catch {
      setError(copy.forgotError);
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <main className="store-v2-page">
      <section className="store-v2-card">
        <div className="store-v2-topbar">
          <AppLanguageSwitcher lang={lang} onChange={setLanguage} />
        </div>

        <div className="store-v2-logo-wrap">
          <Image
            src="/brand/cpipos-logo.png"
            alt="CpIPOS Logo"
            className="store-v2-logo"
            width={1448}
            height={1086}
            style={{ width: "220px", height: "165px", objectFit: "contain" }}
            priority
          />
        </div>

        <form className="store-v2-form" onSubmit={handleSubmit}>
          <label htmlFor="email">{copy.emailLabel}</label>
          <div className="store-v2-input-box" style={fullWidthInputBoxStyle}>
            <input
              id="email"
              type="email"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (error) setError("");
              }}
              placeholder={copy.emailPlaceholder}
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              dir="ltr"
              aria-invalid={Boolean(error)}
              style={{ minWidth: 0, width: "100%", fontSize: "15px", letterSpacing: 0, textAlign: "left" }}
            />
          </div>
          {email.trim() ? (
            <p
              aria-live="polite"
              style={{
                margin: "-6px 0 2px",
                color: "#64748b",
                fontSize: "12px",
                lineHeight: 1.45,
                overflowWrap: "anywhere"
              }}
            >
              {copy.emailPreviewLabel}: <span dir="ltr">{email.trim()}</span>
            </p>
          ) : null}

          <label htmlFor="password">{copy.passwordLabel}</label>
          <div className="store-v2-input-box" style={fullWidthInputBoxStyle}>
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                if (error) setError("");
              }}
              placeholder={copy.passwordPlaceholder}
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
              style={{ minWidth: 0, width: "100%" }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginTop: "-4px" }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "8px",
                fontSize: "12px",
                color: "#64748b",
                cursor: "pointer"
              }}
            >
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(event) => setShowPassword(event.target.checked)}
                style={{ width: "16px", height: "16px" }}
              />
              {copy.showPassword}
            </label>
            <button
              type="button"
              onClick={() => void handleForgotPassword()}
              disabled={forgotLoading}
              style={{
                border: 0,
                background: "transparent",
                padding: "4px 0",
                color: "#176fe8",
                fontSize: "12px",
                fontWeight: 800,
                cursor: forgotLoading ? "wait" : "pointer"
              }}
            >
              {forgotLoading ? copy.forgotSending : copy.forgotPassword}
            </button>
          </div>

          <button type="submit" className="store-v2-login-btn" disabled={loading || forgotLoading || !email.trim() || !password}>
            {loading ? copy.submitting : copy.submit}
          </button>
          {notice ? (
            <p role="status" aria-live="polite" style={{ margin: "4px 0 0", color: "#15803d", fontSize: "12px", lineHeight: 1.55 }}>
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className="store-v2-error" role="alert" aria-live="assertive">
              {error}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
