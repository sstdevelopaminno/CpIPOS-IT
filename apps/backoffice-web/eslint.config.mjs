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
  }
];

export default config;
