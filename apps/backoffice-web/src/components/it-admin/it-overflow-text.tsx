"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./it-overflow-text.module.css";

type Props = {
  title: string;
  text: string | number | null | undefined;
  language?: "th" | "en";
  maxLength?: number;
  className?: string;
  empty?: ReactNode;
};

/**
 * Short, copyable summaries on dense pages. Long text opens in a read-only
 * accessible dialog with its heading kept above the scrollable detail.
 * No existing row/menu navigation or form action is performed by the dialog.
 */
export function ItOverflowText({
  title, text, language = "th", maxLength = 108, className, empty = "—"
}: Props) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const value = text === null || text === undefined ? "" : String(text).trim();
  const long = value.length > maxLength;
  const excerpt = long ? value.slice(0, maxLength).trimEnd() + "…" : value;
  const detailLabel = language === "th" ? "ดูข้อความทั้งหมด" : "View full text";
  const closeLabel = language === "th" ? "ปิด" : "Close";

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    closeRef.current?.focus();
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open]);

  if (!value) return <span className={className}>{empty}</span>;

  return (
    <span className={[styles.summary, className].filter(Boolean).join(" ")}>
      <span className={styles.excerpt}>{excerpt}</span>
      {long ? (
        <button
          ref={triggerRef}
          type="button"
          className={styles.readMore}
          aria-label={title + " — " + detailLabel}
          onClick={(event) => {
            event.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {detailLabel}
        </button>
      ) : null}
      {long && open ? createPortal(
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={headingId}>
            <header className={styles.dialogHeader}>
              <h2 id={headingId}>{title}</h2>
              <button ref={closeRef} type="button" onClick={() => setOpen(false)} aria-label={closeLabel}>
                ×
              </button>
            </header>
            <div className={styles.dialogBody}>
              <p>{value}</p>
            </div>
          </section>
        </div>,
        document.body
      ) : null}
    </span>
  );
}
