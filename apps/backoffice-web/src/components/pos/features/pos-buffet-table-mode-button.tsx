"use client";

import type { ReactNode } from "react";

type Props = {
  label: string;
  hint: string;
  active: boolean;
  locked: boolean;
  icon?: ReactNode;
  lockTitle?: string;
  onClick: () => void;
};

function BuffetTableModeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7">
      <path
        d="M12 3.75a1.05 1.05 0 0 1 1.05 1.05v.78a7.02 7.02 0 0 1 6.22 6.97H4.73a7.02 7.02 0 0 1 6.22-6.97V4.8A1.05 1.05 0 0 1 12 3.75Z"
        fill="currentColor"
      />
      <path
        d="M3.75 14.4h16.5v1.15a3.7 3.7 0 0 1-3.7 3.7h-9.1a3.7 3.7 0 0 1-3.7-3.7V14.4Z"
        fill="currentColor"
      />
      <path
        d="M7.1 10.85c.62-1.6 2.43-2.74 4.9-2.74s4.28 1.14 4.9 2.74"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.55"
      />
      <path
        d="M6.5 20.5h11"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.7"
      />
    </svg>
  );
}

export function PosBuffetTableModeButton({ label, hint, active, locked, lockTitle, onClick }: Props) {
  return (
    <button
      type="button"
      className={`posui-mode-option ${active ? "is-active" : ""} ${locked ? "is-locked" : ""}`}
      onClick={onClick}
      aria-disabled={locked}
      title={locked ? lockTitle : undefined}
    >
      <span className="posui-mode-option__icon" aria-hidden="true">
        <BuffetTableModeIcon />
      </span>
      <span className="posui-mode-option__copy">
        <strong>{label}</strong>
        <small>{hint}</small>
      </span>
      <span className="posui-mode-option__check" aria-hidden="true">
        ✓
      </span>
    </button>
  );
}
