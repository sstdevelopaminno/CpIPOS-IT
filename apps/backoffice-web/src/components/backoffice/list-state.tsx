"use client";

export function LoadingState({ label = "Loading..." }: { label?: string }) {
  return (
    <div className="surface">
      <p>{label}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="surface" style={{ borderColor: "#d66" }}>
      <h3 style={{ marginTop: 0 }}>Error</h3>
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({ label }: { label: string }) {
  return (
    <div className="surface">
      <p>{label}</p>
    </div>
  );
}
