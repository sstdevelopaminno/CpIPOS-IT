import Link from "next/link";
import { t, type Language, type TranslationKey } from "@/lib/i18n";

type Props = {
  lang: Language;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  actionHref: string;
  actionKey: TranslationKey;
};

export function PosPreviewSectionPage({ lang, titleKey, descKey, actionHref, actionKey }: Props) {
  return (
    <section className="pos-section-card rounded-xl border border-slate-300 bg-slate-50 p-4 lg:p-5">
      <h2 className="text-xl font-extrabold text-slate-900 lg:text-2xl">{t(lang, titleKey)}</h2>
      <p className="mt-2 text-sm text-slate-600 lg:text-base">{t(lang, descKey)}</p>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-xs text-slate-500 lg:text-sm">{t(lang, "pos_section_status")}</p>
          <p className="mt-1 text-base font-bold text-slate-900 lg:text-lg">{t(lang, "pos_section_status_ready")}</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-xs text-slate-500 lg:text-sm">{t(lang, "pos_section_view")}</p>
          <p className="mt-1 text-base font-bold text-slate-900 lg:text-lg">{t(lang, "pos_section_view_front_staff")}</p>
        </div>
        <div className="rounded-lg border border-slate-300 bg-white p-3">
          <p className="text-xs text-slate-500 lg:text-sm">{t(lang, "pos_section_mode")}</p>
          <p className="mt-1 text-base font-bold text-slate-900 lg:text-lg">{t(lang, "pos_section_preview_mode")}</p>
        </div>
      </div>

      <div className="mt-4">
        <Link
          href={actionHref}
          className="inline-flex min-h-10 items-center rounded-lg border border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-600 transition hover:bg-orange-100"
        >
          {t(lang, actionKey)}
        </Link>
      </div>
    </section>
  );
}
