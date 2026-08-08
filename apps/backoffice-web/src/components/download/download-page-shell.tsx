import type { ReactNode } from "react";

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4 w-4 shrink-0">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5 shrink-0">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
    />
  </svg>
);

export type DownloadPageShellProps = {
  eyebrow: string;
  title: string;
  subtitle: string;
  illustration: ReactNode;
  features: string[];
  downloadUrl: string;
  downloadLabel: string;
  fileHint: string;
  separateNoticeTitle: string;
  separateNoticeBody: string[];
  stepsTitle: string;
  steps: string[];
  statusTitle: string;
  statusBody: string;
};

export function DownloadPageShell({
  eyebrow,
  title,
  subtitle,
  illustration,
  features,
  downloadUrl,
  downloadLabel,
  fileHint,
  separateNoticeTitle,
  separateNoticeBody,
  stepsTitle,
  steps,
  statusTitle,
  statusBody
}: DownloadPageShellProps) {
  return (
    <main className="min-h-dvh overflow-y-auto bg-slate-950 text-slate-100">
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_15%_-10%,rgba(56,189,248,0.18),transparent_45%),radial-gradient(circle_at_85%_0%,rgba(14,116,144,0.16),transparent_40%)]"
      />

      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="mb-8 flex items-center justify-between gap-3">
          <span className="text-sm font-black tracking-tight text-white">CpIPOS</span>
          <a
            href="https://cp-ipos-web.vercel.app"
            className="rounded-full border border-slate-700 bg-slate-900/60 px-3.5 py-1.5 text-xs font-semibold text-slate-300 transition hover:border-sky-700 hover:text-sky-200"
          >
            ไปที่ CpIPOS Web
          </a>
        </div>

        <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="mb-4 inline-flex rounded-full border border-sky-800 bg-sky-950/60 px-3 py-1 text-xs font-bold uppercase tracking-[0.24em] text-sky-300">
              {eyebrow}
            </p>
            <h1 className="text-3xl font-black leading-tight tracking-tight text-white sm:text-5xl">{title}</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">{subtitle}</p>

            <ul className="mt-6 flex flex-wrap gap-2.5">
              {features.map((feature) => (
                <li
                  key={feature}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/70 px-3.5 py-1.5 text-xs font-semibold text-slate-200"
                >
                  <span className="text-emerald-400">
                    <CheckIcon />
                  </span>
                  {feature}
                </li>
              ))}
            </ul>

            <div className="mt-8">
              <a
                href={downloadUrl}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-sky-500 px-7 py-4 text-base font-bold text-white shadow-xl shadow-sky-950/40 transition hover:-translate-y-0.5 hover:bg-sky-400 hover:shadow-sky-900/50"
              >
                <DownloadIcon />
                {downloadLabel}
              </a>
              <p className="mt-3 text-sm leading-6 text-slate-400">{fileHint}</p>
            </div>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="absolute inset-6 -z-10 rounded-full bg-gradient-to-br from-sky-500/30 via-blue-600/20 to-transparent blur-3xl"
            />
            {illustration}
          </div>
        </section>

        <section className="mt-14 rounded-2xl border border-sky-800/70 bg-sky-950/30 p-5 sm:p-6">
          <p className="font-bold text-sky-200">{separateNoticeTitle}</p>
          <div className="mt-1.5 space-y-1 text-sm leading-7 text-sky-100/90">
            {separateNoticeBody.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </div>
        </section>

        <section className="mt-8">
          <h2 className="mb-5 text-xl font-bold text-white sm:text-2xl">{stepsTitle}</h2>
          <ol className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((step, index) => (
              <li
                key={step}
                className="flex gap-3.5 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 leading-6 text-slate-200 shadow-sm"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-sm font-black text-white">
                  {index + 1}
                </span>
                <span className="text-sm leading-6">{step}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-8 rounded-2xl border border-amber-800 bg-amber-950/40 p-5 text-sm leading-7 text-amber-100 sm:p-6">
          <p className="font-bold text-amber-200">{statusTitle}</p>
          <p className="mt-1">{statusBody}</p>
        </section>

        <footer className="mt-12 border-t border-slate-800 pt-6 text-xs text-slate-500">
          © CpIPOS — เว็บแอปยังเป็นระบบหลักเสมอ หน้านี้ใช้สำหรับดาวน์โหลดเท่านั้น
        </footer>
      </div>
    </main>
  );
}
