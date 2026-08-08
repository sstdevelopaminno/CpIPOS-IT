export type DeliveryPricingChannel = "grab" | "line_man" | "shopee" | "foodpanda" | "merchant_app" | "other";

export type DeliveryChannelConfig = {
  channel: DeliveryPricingChannel;
  commissionRatePct: number;
  commissionVatRatePct: number;
  orderCodeRule: "free_text" | "regex";
  orderCodeRegex: string | null;
  orderCodeExample: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  sourceCheckedAt: string | null;
};

export type DeliveryPricingBreakdown = {
  appSubtotal: number;
  commissionRatePct: number;
  commissionAmount: number;
  commissionVatRatePct: number;
  commissionVatAmount: number;
  platformFeeAmount: number;
  netPayoutAmount: number;
};

function roundMoney(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}

export function calculateDeliveryPricingBreakdown(input: {
  appSubtotal: number;
  commissionRatePct: number;
  commissionVatRatePct: number;
}): DeliveryPricingBreakdown {
  const appSubtotal = roundMoney(input.appSubtotal);
  const commissionRatePct = Number(input.commissionRatePct);
  const commissionVatRatePct = Number(input.commissionVatRatePct);
  const commissionAmount = roundMoney((appSubtotal * Math.max(0, commissionRatePct)) / 100);
  const commissionVatAmount = roundMoney((commissionAmount * Math.max(0, commissionVatRatePct)) / 100);
  const platformFeeAmount = roundMoney(commissionAmount + commissionVatAmount);
  const netPayoutAmount = roundMoney(Math.max(0, appSubtotal - platformFeeAmount));

  return {
    appSubtotal,
    commissionRatePct,
    commissionAmount,
    commissionVatRatePct,
    commissionVatAmount,
    platformFeeAmount,
    netPayoutAmount
  };
}

export function parseDeliveryChannel(value: string | null | undefined): DeliveryPricingChannel | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "grab") return "grab";
  if (normalized === "line_man") return "line_man";
  if (normalized === "shopee") return "shopee";
  if (normalized === "foodpanda") return "foodpanda";
  if (normalized === "merchant_app") return "merchant_app";
  if (normalized === "other") return "other";
  return null;
}

export function validateExternalOrderCode(input: {
  channel: DeliveryPricingChannel;
  orderCode: string;
  rule: "free_text" | "regex";
  regex: string | null;
}): { ok: boolean; message: string | null } {
  function normalizeForInternalPrefix(channel: DeliveryPricingChannel, orderCode: string): string {
    const trimmed = orderCode.trim();
    const upper = trimmed.toUpperCase();
    if (channel === "line_man" && upper.startsWith("LM-")) {
      return trimmed.slice(3).trim();
    }
    if (channel === "grab" && upper.startsWith("GF-")) {
      return trimmed.slice(3).trim();
    }
    if (channel === "shopee" && upper.startsWith("SF-")) {
      return trimmed.slice(3).trim();
    }
    return trimmed;
  }

  const code = input.orderCode.trim();
  if (!code) {
    return { ok: false, message: "External order code is required." };
  }

  if (input.rule === "regex" && input.regex) {
    try {
      const pattern = new RegExp(input.regex, "i");
      const normalizedCode = normalizeForInternalPrefix(input.channel, code);
      if (!pattern.test(code) && !pattern.test(normalizedCode)) {
        return { ok: false, message: `Order code format does not match channel rule (${input.channel}).` };
      }
    } catch {
      return { ok: false, message: "Order code rule regex is invalid. Please update delivery channel config." };
    }
  }

  return { ok: true, message: null };
}

export const DEFAULT_DELIVERY_CHANNEL_CONFIGS: DeliveryChannelConfig[] = [
  {
    channel: "line_man",
    commissionRatePct: 30,
    commissionVatRatePct: 7,
    orderCodeRule: "regex",
    orderCodeRegex: "^[0-9]{4,}$",
    orderCodeExample: "1234",
    sourceTitle: "Wongnai for Business GP calculation article (historical/public reference)",
    sourceUrl: "https://www.wongnai.com/business-owners/delivery-gross-profit",
    sourceCheckedAt: "2026-05-22"
  },
  {
    channel: "grab",
    commissionRatePct: 30,
    commissionVatRatePct: 7,
    orderCodeRule: "regex",
    orderCodeRegex: "^GF-[A-Z0-9-]+$",
    orderCodeExample: "GF-545",
    sourceTitle: "Grab merchant contract + #AskGrab article (rate is contract-based)",
    sourceUrl:
      "https://www.grab.com/th/en/terms-policies/general-terms-and-conditions-of-grabfood-merchant-contract/",
    sourceCheckedAt: "2026-05-22"
  },
  {
    channel: "shopee",
    commissionRatePct: 30,
    commissionVatRatePct: 7,
    orderCodeRule: "regex",
    orderCodeRegex: "^[0-9]{8,}$",
    orderCodeExample: "230001245678",
    sourceTitle: "ShopeeFood Partner GP help article (rate in onboarding confirmation email/contract)",
    sourceUrl:
      "https://help.shopee.co.th/portal/1/article/141994-[ShopeeFood-Partner]-%E0%B8%A7%E0%B8%B4%E0%B8%98%E0%B8%B5%E0%B8%81%E0%B8%B2%E0%B8%A3%E0%B8%84%E0%B8%B3%E0%B8%99%E0%B8%A7%E0%B8%93%E0%B8%84%E0%B9%88%E0%B8%B2%E0%B8%98%E0%B8%A3%E0%B8%A3%E0%B8%A1%E0%B9%80%E0%B8%99%E0%B8%B5%E0%B8%A2%E0%B8%A1-(GP)",
    sourceCheckedAt: "2026-05-22"
  },
  {
    channel: "foodpanda",
    commissionRatePct: 32,
    commissionVatRatePct: 7,
    orderCodeRule: "regex",
    orderCodeRegex: "^[a-z0-9-]{4,}$",
    orderCodeExample: "fp-ab12 / 807c225f-ac6d-445d-a074-ea960c892ca7",
    sourceTitle: "foodpanda public partner/dev docs (public pages do not publish fixed % by market)",
    sourceUrl: "https://www.foodpanda.com/partners/",
    sourceCheckedAt: "2026-05-22"
  },
  {
    channel: "merchant_app",
    commissionRatePct: 0,
    commissionVatRatePct: 7,
    orderCodeRule: "free_text",
    orderCodeRegex: null,
    orderCodeExample: "APP-0001",
    sourceTitle: "Internal channel",
    sourceUrl: null,
    sourceCheckedAt: "2026-05-22"
  },
  {
    channel: "other",
    commissionRatePct: 0,
    commissionVatRatePct: 7,
    orderCodeRule: "free_text",
    orderCodeRegex: null,
    orderCodeExample: "OTHER-0001",
    sourceTitle: "Internal channel",
    sourceUrl: null,
    sourceCheckedAt: "2026-05-22"
  }
];
