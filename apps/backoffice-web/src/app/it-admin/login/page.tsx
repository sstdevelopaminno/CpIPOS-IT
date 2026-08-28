"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { AppLanguageSwitcher } from "@/components/i18n/app-language-switcher";
import { useAppLanguage, type AppLanguage } from "@/lib/app-language-client";

function getCopy(lang: AppLanguage) {
  if (lang === "en") {
    return {
      subtitle: "IT Admin sign in",
      emailLabel: "Email",
      emailPlaceholder: "Enter email",
      emailPreviewLabel: "Entered email",
      passwordLabel: "Password",
      passwordPlaceholder: "Enter password",
      showPassword: "Show password",
      submit: "Log in",
      submitting: "Signing in...",
      requiredError: "Please enter email and password.",
      invalidCredentialsError: "Invalid email or password.",
      notAuthorizedError: "This account does not have IT admin access.",
      defaultError: "Unable to sign in right now."
    };
  }

  return {
    subtitle: "เข้าสู่ระบบ IT Admin",
    emailLabel: "อีเมล",
    emailPlaceholder: "กรอกอีเมล",
    emailPreviewLabel: "อีเมลที่กรอก",
    passwordLabel: "รหัสผ่าน",
    passwordPlaceholder: "กรอกรหัสผ่าน",
    showPassword: "แสดงรหัสผ่าน",
    submit: "ล็อกอิน",
    submitting: "กำลังเข้าสู่ระบบ...",
    requiredError: "กรุณากรอกอีเมลและรหัสผ่าน",
    invalidCredentialsError: "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    notAuthorizedError: "บัญชีนี้ไม่มีสิทธิ์เข้าถึงระบบ IT Admin",
    defaultError: "ไม่สามารถเข้าสู่ระบบได้ในขณะนี้"
  };
}

export default function ItAdminLoginPage() {
  const router = useRouter();
  const { lang, setLanguage } = useAppLanguage("th");
  const copy = useMemo(() => getCopy(lang), [lang]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
      const result = (await response.json().catch(() => null)) as { code?: string } | null;

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

      router.push("/it-admin");
      router.refresh();
    } catch {
      setError(copy.defaultError);
    } finally {
      setLoading(false);
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
          <div className="store-v2-input-box">
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
              style={{ fontSize: "15px", letterSpacing: 0, textAlign: "left" }}
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
          <div className="store-v2-input-box">
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
            />
          </div>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "-4px",
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

          <button type="submit" className="store-v2-login-btn" disabled={loading || !email.trim() || !password}>
            {loading ? copy.submitting : copy.submit}
          </button>
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
