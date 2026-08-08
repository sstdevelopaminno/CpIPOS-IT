"use client";

import { useEffect, useState } from "react";

export function PwaBootstrap() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((registration) => registration.unregister()));
          if ("caches" in window) {
            const keys = await window.caches.keys();
            await Promise.all(keys.map((key) => window.caches.delete(key)));
          }
          if (navigator.serviceWorker.controller && !window.sessionStorage.getItem("cpipos_dev_sw_cleared_v1")) {
            window.sessionStorage.setItem("cpipos_dev_sw_cleared_v1", "1");
            window.location.reload();
          }
        } catch {
          // Local PWA cleanup must not block development.
        }
      })();
      return;
    }

    let reloadedForUpdate = false;
    const handleControllerChange = () => {
      if (reloadedForUpdate) return;
      reloadedForUpdate = true;
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener("controllerchange", handleControllerChange);

    void (async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const nextWorker = registration.installing;
          if (!nextWorker) return;

          nextWorker.addEventListener("statechange", () => {
            if (nextWorker.state === "installed" && navigator.serviceWorker.controller) {
              setWaitingWorker(nextWorker);
            }
          });
        });

        await registration.update();
      } catch {
        // PWA update checks should never block login/POS usage.
      }
    })();

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", handleControllerChange);
    };
  }, []);

  if (!waitingWorker) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        zIndex: 10000,
        maxWidth: 360,
        borderRadius: 12,
        border: "1px solid rgba(14, 165, 233, 0.28)",
        background: "rgba(5, 14, 28, 0.96)",
        boxShadow: "0 18px 48px rgba(2, 8, 23, 0.35)",
        color: "#f8fafc",
        padding: 14,
        fontFamily: "var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif)"
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700 }}>มีอัปเดต CpIPOS พร้อมใช้งาน</div>
      <div style={{ marginTop: 4, fontSize: 12, lineHeight: 1.5, color: "#cbd5e1" }}>กดอัปเดตเพื่อใช้ชื่อระบบและไอคอนใหม่ทันที</div>
      <button
        type="button"
        onClick={() => {
          setIsRefreshing(true);
          waitingWorker.postMessage({ type: "SKIP_WAITING" });
        }}
        disabled={isRefreshing}
        style={{
          marginTop: 10,
          minHeight: 36,
          width: "100%",
          border: 0,
          borderRadius: 8,
          background: isRefreshing ? "#64748b" : "#0ea5e9",
          color: "#ffffff",
          cursor: isRefreshing ? "default" : "pointer",
          fontSize: 13,
          fontWeight: 700
        }}
      >
        {isRefreshing ? "กำลังอัปเดต..." : "อัปเดตระบบ"}
      </button>
    </div>
  );
}
