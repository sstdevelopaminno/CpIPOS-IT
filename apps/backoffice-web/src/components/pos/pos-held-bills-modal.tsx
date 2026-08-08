"use client";

import Image from "next/image";
import type { OrderType } from "@pos/shared-types";

type DeliveryPendingStatus = "pending" | "editing" | "sending" | "sent" | "cancelled";

type DeliveryPendingStatusHistoryEntry = {
  status: DeliveryPendingStatus;
  at: string;
  note?: string | null;
};

type HeldBillItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type HeldBill = {
  id: string;
  held_at: string;
  label: string;
  order_type: OrderType;
  table_code?: string | null;
  delivery_app_id?: DeliveryApp["id"] | null;
  delivery_external_code?: string | null;
  queue_status?: DeliveryPendingStatus;
  status_history?: DeliveryPendingStatusHistoryEntry[];
  items: HeldBillItem[];
  subtotal: number;
};

type DeliveryApp = {
  id: "lineman" | "grabfood" | "shopeefood";
  nameTh: string;
  nameEn: string;
  logoOfficial: string;
  logoFallback: string;
};

type Props = {
  open: boolean;
  text: any;
  lang: "th" | "en";
  isDeliveryPendingPanelMode: boolean;
  heldBillSearch: string;
  heldBillPool: HeldBill[];
  filteredHeldBills: HeldBill[];
  deliveryApps: DeliveryApp[];
  deliveryLogoFallback: Record<DeliveryApp["id"], boolean>;
  deliveryActionBusyById: Record<string, "send" | "cancel">;
  isBusy: boolean;
  formatMoney: (value: number) => string;
  formatHeldAt: (value: string, lang: "th" | "en") => string;
  getDeliveryPendingStatusLabel: (status: DeliveryPendingStatus | undefined) => string;
  normalizeHeldBillStatusHistory: (entry: HeldBill) => DeliveryPendingStatusHistoryEntry[];
  onClose: () => void;
  onHeldBillSearchChange: (value: string) => void;
  onRestoreLatestHeldBill: () => void;
  onRestoreHeldBill: (heldBill: HeldBill) => void;
  onRemoveHeldBill: (heldBillId: string) => void;
  onSendPendingDeliveryBill: (heldBill: HeldBill) => void;
  onCancelPendingDeliveryBill: (heldBill: HeldBill) => void;
  onDeliveryLogoError: (appId: DeliveryApp["id"]) => void;
};

export function PosHeldBillsModal({
  open,
  text,
  lang,
  isDeliveryPendingPanelMode,
  heldBillSearch,
  heldBillPool,
  filteredHeldBills,
  deliveryApps,
  deliveryLogoFallback,
  deliveryActionBusyById,
  isBusy,
  formatMoney,
  formatHeldAt,
  getDeliveryPendingStatusLabel,
  normalizeHeldBillStatusHistory,
  onClose,
  onHeldBillSearchChange,
  onRestoreLatestHeldBill,
  onRestoreHeldBill,
  onRemoveHeldBill,
  onSendPendingDeliveryBill,
  onCancelPendingDeliveryBill,
  onDeliveryLogoError
}: Props) {
  if (!open) return null;

  return (
    <div
      className="posui-held-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={isDeliveryPendingPanelMode ? text.deliveryPendingBillsTitle : text.heldBillsTitle}
      onClick={onClose}
    >
      <section className="posui-held-modal" onClick={(event) => event.stopPropagation()}>
        <header className="posui-held-modal__header">
          <h3>{isDeliveryPendingPanelMode ? text.deliveryPendingBillsTitle : text.heldBillsTitle}</h3>
          <button type="button" className="posui-btn" onClick={onClose}>
            {text.close}
          </button>
        </header>
        <div className="posui-held-modal__toolbar">
          <input
            type="search"
            className="posui-held-modal__search"
            placeholder={isDeliveryPendingPanelMode ? text.deliveryPendingSearchPlaceholder : text.heldBillsSearchPlaceholder}
            value={heldBillSearch}
            onChange={(event) => onHeldBillSearchChange(event.target.value)}
          />
          <button
            type="button"
            className="posui-btn posui-btn--primary"
            onClick={onRestoreLatestHeldBill}
            disabled={heldBillPool.length === 0 || isBusy}
          >
            {text.heldBillsRestoreLatest}
          </button>
        </div>

        {heldBillPool.length === 0 ? (
          <p className="posui-held-modal__empty">{isDeliveryPendingPanelMode ? text.deliveryPendingBillNoMatch : text.heldBillsEmpty}</p>
        ) : filteredHeldBills.length === 0 ? (
          <p className="posui-held-modal__empty">{isDeliveryPendingPanelMode ? text.deliveryPendingBillNoMatch : text.heldBillsNoMatch}</p>
        ) : (
          <div className="posui-held-modal__list">
            {filteredHeldBills.map((heldBill) => {
              const app = heldBill.delivery_app_id ? deliveryApps.find((entry) => entry.id === heldBill.delivery_app_id) ?? null : null;
              const queueStatus = heldBill.queue_status ?? "pending";
              const statusHistory = normalizeHeldBillStatusHistory(heldBill);
              const latestStatusHistory = statusHistory[statusHistory.length - 1] ?? null;
              const canDispatch = queueStatus === "pending" || queueStatus === "editing";
              const canEdit = queueStatus !== "cancelled" && queueStatus !== "sent";
              const canCancel = queueStatus !== "cancelled" && queueStatus !== "sent";
              const busyAction = deliveryActionBusyById[heldBill.id];
              const actionLocked = Boolean(busyAction);
              return (
                <article key={heldBill.id} className={`posui-held-item ${isDeliveryPendingPanelMode ? "is-delivery-pending" : ""}`}>
                  <div>
                    <p className="posui-held-item__title">{heldBill.label}</p>
                    <p className="posui-held-item__meta">
                      {heldBill.order_type} | {heldBill.table_code ?? "-"} | {heldBill.items.length} {text.items} | {formatMoney(heldBill.subtotal)}
                    </p>
                    {isDeliveryPendingPanelMode ? (
                      <div className="posui-held-item__delivery-meta">
                        {app ? (
                          <Image
                            src={deliveryLogoFallback[app.id] ? app.logoFallback : app.logoOfficial}
                            alt={lang === "th" ? app.nameTh : app.nameEn}
                            width={84}
                            height={32}
                            unoptimized
                            className="posui-held-item__delivery-logo"
                            onError={() => onDeliveryLogoError(app.id)}
                          />
                        ) : null}
                        <p className="posui-held-item__meta">
                          {text.deliveryPendingBillCode}: <strong>{heldBill.delivery_external_code ?? "-"}</strong>
                        </p>
                        <p className="posui-held-item__meta">
                          {text.deliveryPendingStatusLabel}: <strong>{getDeliveryPendingStatusLabel(queueStatus)}</strong>
                        </p>
                        {latestStatusHistory ? (
                          <p className="posui-held-item__meta">
                            {text.deliveryPendingStatusChangedAt}: <strong>{formatHeldAt(latestStatusHistory.at, lang)}</strong>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    <p className="posui-held-item__meta">
                      {text.heldBillsHeldAt}: {formatHeldAt(heldBill.held_at, lang)}
                    </p>
                    {isDeliveryPendingPanelMode && statusHistory.length > 0 ? (
                      <div className="posui-held-item__history">
                        <p className="posui-held-item__meta">{text.deliveryPendingHistoryLabel}</p>
                        <ul>
                          {statusHistory.slice(-4).reverse().map((historyEntry, index) => (
                            <li key={`${heldBill.id}-status-${historyEntry.at}-${historyEntry.status}-${index}`}>
                              <strong>{getDeliveryPendingStatusLabel(historyEntry.status)}</strong>
                              <span>{formatHeldAt(historyEntry.at, lang)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                  <div className="posui-held-item__actions">
                    {isDeliveryPendingPanelMode ? (
                      <>
                        <button
                          type="button"
                          className="posui-btn posui-btn--primary"
                          onClick={() => onSendPendingDeliveryBill(heldBill)}
                          disabled={isBusy || !canDispatch || actionLocked}
                        >
                          {text.deliveryPendingBillSend}
                        </button>
                        <button
                          type="button"
                          className="posui-btn"
                          onClick={() => onRestoreHeldBill(heldBill)}
                          disabled={isBusy || !canEdit || queueStatus === "sending" || actionLocked}
                        >
                          {text.deliveryPendingBillEdit}
                        </button>
                        <button
                          type="button"
                          className="posui-btn posui-btn--danger"
                          onClick={() => onCancelPendingDeliveryBill(heldBill)}
                          disabled={isBusy || !canCancel || queueStatus === "sending" || actionLocked}
                        >
                          {text.deliveryPendingBillCancel}
                        </button>
                      </>
                    ) : (
                      <>
                        <button type="button" className="posui-btn posui-btn--primary" onClick={() => onRestoreHeldBill(heldBill)}>
                          {text.heldBillsRestore}
                        </button>
                        <button type="button" className="posui-btn" onClick={() => onRemoveHeldBill(heldBill.id)}>
                          {text.heldBillsDelete}
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
