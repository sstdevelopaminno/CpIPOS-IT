"use client";

type BillData = {
  session: {
    id: string;
    status: string;
    opened_at: string;
  } | null;
  order: {
    id: string;
    order_no: string;
    total_amount: number;
    status: string;
    customer_name: string | null;
    notes: string | null;
  } | null;
  items: Array<{
    id: string;
    quantity: number;
    line_total: number;
    products?: { name?: string } | null;
  }>;
  payments: Array<{
    id: string;
    method: string;
    amount: number;
  }>;
};

export function TableBillSummaryPanel({ data }: { data: BillData | null }) {
  if (!data) {
    return (
      <aside className="table-bill-panel">
        <h4>Bill Summary</h4>
        <p>Select a table to view bill details.</p>
      </aside>
    );
  }

  return (
    <aside className="table-bill-panel">
      <h4>Bill Summary</h4>
      <p>Session: {data.session?.status ?? "-"}</p>
      <p>Opened: {data.session?.opened_at ? new Date(data.session.opened_at).toLocaleString() : "-"}</p>
      <p>Order: {data.order?.order_no ?? "-"}</p>
      <p>Status: {data.order?.status ?? "-"}</p>
      <p>Total: ฿{Number(data.order?.total_amount ?? 0).toFixed(2)}</p>
      <div className="table-bill-panel__items">
        {data.items.map((item) => (
          <p key={item.id}>
            {item.products?.name ?? "Item"} x{Number(item.quantity)} - ฿{Number(item.line_total).toFixed(2)}
          </p>
        ))}
      </div>
      <div className="table-bill-panel__payments">
        {data.payments.map((payment) => (
          <p key={payment.id}>
            {payment.method}: ฿{Number(payment.amount).toFixed(2)}
          </p>
        ))}
      </div>
    </aside>
  );
}
