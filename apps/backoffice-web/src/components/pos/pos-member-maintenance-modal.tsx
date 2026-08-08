"use client";

import Image from "next/image";

type Props = {
  open: boolean;
  lang: "th" | "en";
  title?: string;
  message?: string;
  closeLabel?: string;
  onCloseHref?: string;
  onClose?: () => void;
};

export function PosMemberMaintenanceModal({ open, lang, title, message, closeLabel, onCloseHref, onClose }: Props) {
  if (!open) return null;

  const defaultCopy =
    lang === "th"
      ? {
          title: "สมาชิก",
          message: "กำลังอยู่ระหว่างพัฒนาและปรับปรุงเพิ่มเติม",
          close: "ปิด"
        }
      : {
          title: "Members",
          message: "This feature is being developed and improved.",
          close: "Close"
        };
  const copy = {
    ...defaultCopy,
    title: title ?? defaultCopy.title,
    message: message ?? defaultCopy.message,
    close: closeLabel ?? defaultCopy.close
  };

  function close() {
    if (onClose) {
      onClose();
      return;
    }
    window.location.assign(onCloseHref ?? "/preview/pos");
  }

  return (
    <div className="posui-payment-modal-backdrop" role="dialog" aria-modal="true" aria-label={copy.title} onClick={close}>
      <section className="posui-payment-modal posui-payment-modal--review max-w-md text-center" onClick={(event) => event.stopPropagation()}>
        <div className="mx-auto flex justify-center">
          <Image src="/brand/cpipos-logo.png" alt="CpIPOS" width={150} height={96} className="h-auto w-[150px] object-contain" priority />
        </div>
        <div className="mt-3">
          <h3 className="text-xl font-black text-slate-950">{copy.title}</h3>
          <p className="mt-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4 text-sm font-bold leading-6 text-blue-900">
            {copy.message}
          </p>
        </div>
        <div className="mt-5 flex justify-center">
          <button type="button" className="posui-btn posui-btn--primary min-w-28" onClick={close}>
            {copy.close}
          </button>
        </div>
      </section>
    </div>
  );
}
