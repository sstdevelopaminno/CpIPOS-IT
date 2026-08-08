import Link from "next/link";
import type { CSSProperties } from "react";

const sectionLinks = [
  { href: "branches", label: "Branches" },
  { href: "users", label: "Users & Roles" },
  { href: "devices", label: "Devices" },
  { href: "login-policies", label: "Login Policies" },
  { href: "sessions", label: "Sessions" },
  { href: "shifts", label: "Shifts" },
  { href: "features", label: "Features" }
] as const;

export function TenantAdminNav({ tenantId }: { tenantId: string }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
      <Link href="/tenants" style={pillStyle}>
        All tenants
      </Link>
      {sectionLinks.map((item) => (
        <Link key={item.href} href={`/tenants/${tenantId}/${item.href}`} style={pillStyle}>
          {item.label}
        </Link>
      ))}
    </div>
  );
}

const pillStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "8px 12px",
  background: "#fff",
  minHeight: 40,
  display: "inline-flex",
  alignItems: "center"
};
