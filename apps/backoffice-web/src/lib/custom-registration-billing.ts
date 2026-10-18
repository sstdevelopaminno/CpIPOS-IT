export type CustomRegistrationPrices = {
  monthly_price: number;
  yearly_price: number;
  monthly_discount_percent: number;
  yearly_discount_percent: number;
};

export type CustomRegistrationBilling = {
  billing_interval: "monthly" | "yearly";
  amount_per_cycle: number;
};

// A CUSTOM contract can be monthly-only, yearly-only, or offer both.
// Prefer monthly when both valid prices exist to preserve existing onboarding behavior.
export function resolveCustomRegistrationBilling(prices: CustomRegistrationPrices): CustomRegistrationBilling | null {
  const offer = (amount: number, discount: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(discount) || discount < 0 || discount > 100) {
      return 0;
    }
    return Number((amount * (1 - discount / 100)).toFixed(2));
  };
  const monthly = offer(prices.monthly_price, prices.monthly_discount_percent);
  if (monthly > 0) return { billing_interval: "monthly", amount_per_cycle: monthly };
  const yearly = offer(prices.yearly_price, prices.yearly_discount_percent);
  if (yearly > 0) return { billing_interval: "yearly", amount_per_cycle: yearly };
  return null;
}
