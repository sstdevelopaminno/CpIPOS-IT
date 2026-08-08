"use client";

import type { Language } from "@/lib/i18n";
import { getTableUiText } from "@/components/tables/table-i18n";

type Props = {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetViewport: () => void;
  onAddCounter?: () => void;
  onAddObject?: () => void;
  onSaveLayout?: () => void;
  onResetLayout?: () => void;
  saving?: boolean;
  canEdit?: boolean;
  canSaveLayout?: boolean;
  canResetLayout?: boolean;
  dirty?: boolean;
  lang?: Language;
};

export function FloorPlanToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetViewport,
  onAddCounter,
  onAddObject,
  onSaveLayout,
  onResetLayout,
  saving = false,
  canEdit = false,
  canSaveLayout = true,
  canResetLayout = true,
  dirty = false,
  lang = "en"
}: Props) {
  const text = getTableUiText(lang);
  const busy = saving;
  return (
    <div className="floor-toolbar">
      <div className="floor-toolbar__left">
        <button type="button" className="floor-toolbar__zoom-btn" onClick={onZoomOut} disabled={busy}>
          -
        </button>
        <span className="floor-toolbar__zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" className="floor-toolbar__zoom-btn" onClick={onZoomIn} disabled={busy}>
          +
        </button>
        <button type="button" className="floor-toolbar__ghost-btn" onClick={onResetViewport} disabled={busy}>
          {text.resetView}
        </button>
      </div>
      {canEdit ? (
        <div className="floor-toolbar__right" aria-busy={busy}>
          <span className={`floor-toolbar__dirty-pill ${dirty ? "is-dirty" : "is-saved"}`}>
            {dirty ? (lang === "th" ? "มีการแก้ไข" : "Unsaved changes") : lang === "th" ? "บันทึกล่าสุดแล้ว" : "All changes saved"}
          </span>
          <button type="button" className="floor-toolbar__ghost-btn" onClick={onAddCounter} disabled={busy}>
            {text.addCounter}
          </button>
          <button type="button" className="floor-toolbar__ghost-btn" onClick={onAddObject} disabled={busy}>
            {text.addFloorObject}
          </button>
          <button type="button" className="floor-toolbar__warn-btn" onClick={onResetLayout} disabled={busy || !canResetLayout}>
            {text.resetLayout}
          </button>
          <button type="button" onClick={onSaveLayout} disabled={busy || !canSaveLayout} className="floor-toolbar__primary-btn">
            {busy ? text.saving : text.saveLayout}
          </button>
        </div>
      ) : null}
    </div>
  );
}
