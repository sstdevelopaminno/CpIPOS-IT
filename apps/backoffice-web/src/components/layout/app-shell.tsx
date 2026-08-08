import Link from "next/link";
import type { ReactNode } from "react";
import { LanguageSwitcher } from "@/components/language/language-switcher";
import type { Language } from "@/lib/i18n";

type NavItem = {
  href: string;
  label: string;
};

export function AppShell({
  title,
  nav,
  language,
  languageLabel,
  thaiLabel,
  englishLabel,
  children
}: {
  title: string;
  nav: NavItem[];
  language: Language;
  languageLabel: string;
  thaiLabel: string;
  englishLabel: string;
  children: ReactNode;
}) {
  return (
    <main className="page">
      <header style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
          <h1 style={{ marginBottom: 8 }}>{title}</h1>
          <LanguageSwitcher
            currentLanguage={language}
            label={languageLabel}
            thaiLabel={thaiLabel}
            englishLabel={englishLabel}
          />
        </div>
        <nav style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              style={{
                border: "1px solid var(--border)",
                padding: "10px 14px",
                borderRadius: 999,
                background: "#fff",
                minHeight: 44,
                display: "inline-flex",
                alignItems: "center"
              }}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </header>
      {children}
    </main>
  );
}

