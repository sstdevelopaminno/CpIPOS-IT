"use client";

import type { AppLanguage } from "@/lib/app-language-client";

type Props = {
  lang: AppLanguage;
  onChange: (nextLang: AppLanguage) => void;
  className?: string;
};

export function AppLanguageSwitcher({ lang, onChange, className }: Props) {
  return (
    <div className={className ?? "ipos-language-switcher"} role="group" aria-label="Language switcher">
      <button
        type="button"
        className={`ipos-language-chip ${lang === "th" ? "is-active" : ""}`}
        onClick={() => onChange("th")}
        aria-pressed={lang === "th"}
      >
        ไทย
      </button>
      <button
        type="button"
        className={`ipos-language-chip ${lang === "en" ? "is-active" : ""}`}
        onClick={() => onChange("en")}
        aria-pressed={lang === "en"}
      >
        EN
      </button>
    </div>
  );
}
