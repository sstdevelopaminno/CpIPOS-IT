import type { ReactNode } from "react";
import { IposBrand } from "@/components/pre-entry/ipos-brand";

type FlowMode = "multi" | "single";

type PreEntryShellProps = {
  mode: FlowMode;
  activeStep: number;
  title: string;
  subtitle?: string;
  compact?: boolean;
  layout?: "default" | "store";
  showModePill?: boolean;
  showStepbar?: boolean;
  children: ReactNode;
};

export function PreEntryShell({
  mode,
  activeStep,
  title,
  subtitle,
  compact = false,
  layout = "default",
  showModePill = true,
  showStepbar = true,
  children
}: PreEntryShellProps) {
  const steps = mode === "multi" ? ["ร้าน", "สาขา", "พนักงาน", "เครื่อง", "พร้อมขาย"] : ["ร้าน", "พนักงาน", "เครื่อง", "พร้อมขาย"];

  return (
    <main className="ipos-entry-page">
      <div className={`ipos-entry-shell ${compact ? "ipos-entry-shell-compact" : ""} ${layout === "store" ? "ipos-entry-shell-store" : ""}`}>
        <section className={`ipos-entry-card ${mode === "single" ? "is-single" : ""} ${layout === "store" ? "ipos-entry-card-store" : ""}`}>
          <IposBrand compact={compact} />

          {showModePill ? <div className="ipos-mode-pill">{mode === "single" ? "ร้านสาขาเดียว" : "หลายสาขา"}</div> : null}

          {showStepbar ? (
            <div className="ipos-stepbar">
              {steps.map((label, index) => {
                const step = index + 1;
                const stateClass = step < activeStep ? "done" : step === activeStep ? "active" : "";
                return (
                  <div key={label} className={`ipos-stepbar-item ${stateClass}`}>
                    <span>{step}</span>
                    <p>{label}</p>
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="ipos-flow-content">
            {title ? <h2>{title}</h2> : null}
            {subtitle ? <p className="ipos-subtitle">{subtitle}</p> : null}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

