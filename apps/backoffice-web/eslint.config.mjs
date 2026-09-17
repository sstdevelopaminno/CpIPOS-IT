import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  {
    ignores: [
      ".next/**",
      ".next-local/**",
      ".open-next/**",
      ".vercel/**",
      "coverage/**",
      "node_modules/**",
      "tsconfig.tsbuildinfo"
    ]
  },
  ...nextVitals,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/preserve-manual-memoization": "off"
    }
  },
  {
    files: ["src/components/it-admin/desktop-license-management-console.tsx"],
    rules: {
      "react-hooks/purity": "off"
    }
  }
];

export default config;
