"use client";

import { useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type Props = {
  currentLanguage: Language;
  label: string;
  thaiLabel: string;
  englishLabel: string;
  compact?: boolean;
};

export function LanguageSwitcher({ currentLanguage, label, thaiLabel, englishLabel, compact = false }: Props) {
  const [lang, setLang] = useState<Language>(currentLanguage);

  const options = useMemo(
    () => [
      { code: "th" as const, label: thaiLabel },
      { code: "en" as const, label: englishLabel }
    ],
    [thaiLabel, englishLabel]
  );

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: compact ? 6 : 8 }}>
      <span style={{ fontSize: compact ? 11 : 14, color: "var(--muted)" }}>{label}</span>
      <select
        value={lang}
        onChange={(event) => {
          const nextLang = event.target.value as Language;
          setLang(nextLang);
          document.cookie = `pos_lang=${nextLang}; path=/; max-age=31536000`;
          localStorage.setItem("pos_lang", nextLang);
          window.location.reload();
        }}
        style={{
          borderRadius: compact ? 9 : 10,
          border: "1px solid var(--border)",
          padding: compact ? "8px 10px" : "10px 12px",
          background: "#fff",
          minHeight: 44,
          fontSize: compact ? 12 : 14
        }}
      >
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

