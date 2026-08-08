import type { NextConfig } from "next";

// Deploy marker: production-readiness hardening after database housekeeping (2026-08-08).

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  allowedDevOrigins: ["127.0.0.1"],
  experimental: {
    lockDistDir: false,
    webpackBuildWorker: false
  },
  transpilePackages: ["@pos/shared-types", "@pos/pos-domain", "@pos/ui"],
  // The transactional RPC path is the production baseline. These explicit
  // build-time defaults override the legacy service-module defaults that used
  // direct multi-request fallbacks when the variables were absent. Emergency
  // compatibility can still be opted into deliberately with Vercel env vars.
  env: {
    POS_FORCE_DIRECT_CREATE_NON_DELIVERY: process.env.POS_FORCE_DIRECT_CREATE_NON_DELIVERY ?? "false",
    POS_FORCE_DIRECT_PAYMENT_COMPLETE: process.env.POS_FORCE_DIRECT_PAYMENT_COMPLETE ?? "false",
    POS_SOFT_BYPASS_INSUFFICIENT_STOCK: process.env.POS_SOFT_BYPASS_INSUFFICIENT_STOCK ?? "false"
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;