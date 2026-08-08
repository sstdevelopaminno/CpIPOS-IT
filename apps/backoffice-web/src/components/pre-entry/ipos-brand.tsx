import Image from "next/image";

export function IposBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`ipos-brand ${compact ? "ipos-brand-compact" : ""}`}>
      <Image src="/brand/cpipos-logo.png" alt="CpIPOS" width={compact ? 220 : 320} height={compact ? 165 : 240} style={{ height: "auto" }} priority />
    </div>
  );
}
