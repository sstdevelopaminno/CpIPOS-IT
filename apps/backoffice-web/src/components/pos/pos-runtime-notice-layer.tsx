"use client";

import { useEffect, useState } from "react";

type PosRuntimeNoticeLayerProps = {
  lang: string;
};

export function PosRuntimeNoticeLayer({ lang }: PosRuntimeNoticeLayerProps) {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason ?? "");

      if (!reason) return;

      setMessage(
        lang === "th"
          ? "พบข้อผิดพลาดขณะทำงานในระบบ POS Preview"
          : "A runtime issue occurred in POS Preview."
      );

      console.error("[POS Runtime Notice] Unhandled rejection:", event.reason);
    };

    const handleError = (event: ErrorEvent) => {
      const reason = event.message ?? "";

      if (!reason) return;

      setMessage(
        lang === "th"
          ? "พบข้อผิดพลาดขณะทำงานในระบบ POS Preview"
          : "A runtime issue occurred in POS Preview."
      );

      console.error("[POS Runtime Notice] Runtime error:", event.error ?? event.message);
    };

    window.addEventListener("unhandledrejection", handleUnhandledRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      window.removeEventListener("error", handleError);
    };
  }, [lang]);

  if (!message) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg">
      <div className="font-semibold">
        {lang === "th" ? "แจ้งเตือนระบบ" : "System Notice"}
      </div>

      <div className="mt-1 text-xs leading-relaxed">{message}</div>

      <button
        type="button"
        onClick={() => setMessage(null)}
        className="mt-3 rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200"
      >
        {lang === "th" ? "ปิด" : "Close"}
      </button>
    </div>
  );
}