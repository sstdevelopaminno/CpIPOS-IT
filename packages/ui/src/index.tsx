import type { ReactNode } from "react";

type CardProps = {
  title: string;
  value: string;
  subtitle?: string;
};

export function MetricCard({ title, value, subtitle }: CardProps) {
  return (
    <div style={{ border: "1px solid #d6d6d6", borderRadius: 12, padding: 16, background: "#fff" }}>
      <p style={{ margin: 0, color: "#555", fontSize: 14 }}>{title}</p>
      <p style={{ margin: "8px 0", fontWeight: 700, fontSize: 24 }}>{value}</p>
      {subtitle ? <p style={{ margin: 0, color: "#666", fontSize: 13 }}>{subtitle}</p> : null}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 24 }}>
      <h2 style={{ marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

