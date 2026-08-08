"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { BrowserPrintAgent } from "@/components/printing/browser-print-agent";
import { PosShellSidebar } from "@/components/pos-preview/pos-shell-sidebar";
import type { Language } from "@/lib/i18n";

type MainMenuPlacement = "left" | "top" | "bottom";

const POS_MAIN_MENU_PLACEMENT_KEY = "pos_main_menu_bar_position_v2";
const POS_MAIN_MENU_PLACEMENT_EVENT = "pos-main-menu-placement-updated";

function normalizeMenuPlacement(value: string | null | undefined): MainMenuPlacement {
  if (value === "top" || value === "bottom") return value;
  return "left";
}

export function PosShellFrame({
  children,
  lang,
  settingsLabel
}: {
  children: ReactNode;
  lang: Language;
  settingsLabel: string;
}) {
  const [placement, setPlacement] = useState<MainMenuPlacement>("left");

  useEffect(() => {
    const readPlacement = () => {
      try {
        setPlacement(normalizeMenuPlacement(window.localStorage.getItem(POS_MAIN_MENU_PLACEMENT_KEY)));
      } catch {
        setPlacement("left");
      }
    };
    const onPlacementUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ placement?: string | null }>).detail;
      setPlacement(normalizeMenuPlacement(detail?.placement));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === POS_MAIN_MENU_PLACEMENT_KEY) {
        setPlacement(normalizeMenuPlacement(event.newValue));
      }
    };

    readPlacement();
    window.addEventListener(POS_MAIN_MENU_PLACEMENT_EVENT, onPlacementUpdated as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(POS_MAIN_MENU_PLACEMENT_EVENT, onPlacementUpdated as EventListener);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const sidebar = <PosShellSidebar lang={lang} settingsLabel={settingsLabel} placement={placement} />;
  const content = (
    <section className={`pos-app-content-area pos-app-content-area--${placement} flex min-h-0 min-w-0 flex-1 overflow-hidden`}>
      {children}
    </section>
  );

  return (
    <div className={`pos-app-frame pos-app-frame--${placement} flex h-full min-h-0 w-full overflow-hidden`} data-menu-placement={placement}>
      <BrowserPrintAgent />
      {placement === "bottom" ? (
        <>
          {content}
          {sidebar}
        </>
      ) : (
        <>
          {sidebar}
          {content}
        </>
      )}
    </div>
  );
}
