import { MetricCard } from "@pos/ui";
import type { Language } from "@/lib/i18n";
import { t } from "@/lib/i18n";

export function DashboardCards({ lang }: { lang: Language }) {
  const cards = [
    { title: t(lang, "today_sales"), value: "THB 24,680", subtitle: "42 receipts" },
    { title: t(lang, "open_shift"), value: "1", subtitle: "Branch: NDL-BKK-01" },
    { title: t(lang, "pending_delivery"), value: "6", subtitle: "Grab/LINE MAN/Shopee" },
    { title: t(lang, "low_stock"), value: "8", subtitle: "Action needed" }
  ];

  return (
    <div className="grid cols-4">
      {cards.map((card) => (
        <MetricCard key={card.title} title={card.title} value={card.value} subtitle={card.subtitle} />
      ))}
    </div>
  );
}

