import { LanguageSwitcher } from "@/components/language/language-switcher";
import { getCurrentLanguage, t } from "@/lib/i18n";

export default async function ItAdminLanguageSettingsPage() {
  const lang = await getCurrentLanguage();

  return (
    <section className="surface">
      <h2>{t(lang, "language_settings_title")}</h2>
      <p>{t(lang, "language_settings_desc")}</p>
      <LanguageSwitcher
        currentLanguage={lang}
        label={t(lang, "language")}
        thaiLabel={t(lang, "thai")}
        englishLabel={t(lang, "english")}
      />
    </section>
  );
}

