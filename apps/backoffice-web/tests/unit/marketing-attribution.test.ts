import { describe, expect, it } from "vitest";
import { sanitizeMarketingAttribution } from "../../src/lib/server/marketing-attribution";

describe("public CpiPOS signup marketing attribution", () => {
  it("leaves untagged visitors explicitly unknown", () => {
    expect(sanitizeMarketingAttribution(undefined)).toEqual({});
    expect(sanitizeMarketingAttribution(null)).toEqual({});
    expect(sanitizeMarketingAttribution("facebook")).toEqual({});
    expect(sanitizeMarketingAttribution([])).toEqual({});
  });

  it("allows validated tags for search, Facebook and Google Business", () => {
    expect(sanitizeMarketingAttribution({
      utm_source: "  facebook  ",
      utm_medium: "organic_social",
      utm_campaign: "cpipos_retail_20261121",
      utm_content: "post_1",
      utm_term: "retail-pos",
    })).toEqual({
      utm_source: "facebook",
      utm_medium: "organic_social",
      utm_campaign: "cpipos_retail_20261121",
      utm_content: "post_1",
      utm_term: "retail-pos",
    });
    expect(sanitizeMarketingAttribution({
      utm_source: "google",
      utm_medium: "organic_gbp",
    })).toEqual({ utm_source: "google", utm_medium: "organic_gbp" });
    expect(sanitizeMarketingAttribution({
      utm_source: "seo",
      utm_medium: "pos_pillar",
    })).toEqual({ utm_source: "seo", utm_medium: "pos_pillar" });
  });

  it("drops privileged fields, unexpected keys, oversized and PII-like values", () => {
    expect(sanitizeMarketingAttribution({
      utm_source: "facebook",
      source: "trusted_internal",
      tenant_id: "attempted-privilege-change",
      owner_email: "owner@example.com",
      utm_medium: "https://example.com",
      utm_campaign: "a".repeat(121),
      utm_term: "someone@example.com",
      utm_content: "name with spaces",
    })).toEqual({ utm_source: "facebook" });
  });

  it("does not allow browser-supplied objects to become arbitrary metadata", () => {
    expect(sanitizeMarketingAttribution({ nested: { email: "private" }, utm_source: { bad: true } })).toEqual({});
  });
});
