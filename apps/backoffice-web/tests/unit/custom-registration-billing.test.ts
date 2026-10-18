import { describe, expect, it } from "vitest";
import { resolveCustomRegistrationBilling } from "../../src/lib/custom-registration-billing";

const offer = (monthly_price: number, yearly_price: number, monthly_discount_percent = 0, yearly_discount_percent = 0) =>
  resolveCustomRegistrationBilling({ monthly_price, yearly_price, monthly_discount_percent, yearly_discount_percent });

describe("CUSTOM store registration: monthly or annual billing", () => {
  it("accepts IMDC OPTICAL style yearly-only pricing", () => {
    expect(offer(0, 5000)).toEqual({ billing_interval: "yearly", amount_per_cycle: 5000 });
  });
  it("preserves monthly as default when both cycles have a valid price", () => {
    expect(offer(550, 5000)).toEqual({ billing_interval: "monthly", amount_per_cycle: 550 });
    expect(offer(350, 0)).toEqual({ billing_interval: "monthly", amount_per_cycle: 350 });
  });
  it("applies the appropriate annual discount", () => {
    expect(offer(0, 5000, 0, 10)).toEqual({ billing_interval: "yearly", amount_per_cycle: 4500 });
  });
  it("does not generate a zero-amount contract", () => {
    expect(offer(0, 0)).toBeNull();
    expect(offer(0, 5000, 0, 100)).toBeNull();
    expect(offer(-1, -5)).toBeNull();
    expect(offer(0, 5000, 0, 101)).toBeNull();
  });
  it("falls back to annual if monthly cycle is fully discounted", () => {
    expect(offer(550, 5000, 100, 0)).toEqual({ billing_interval: "yearly", amount_per_cycle: 5000 });
  });
});
