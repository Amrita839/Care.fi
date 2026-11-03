import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ['"DM Serif Display"', "Georgia", "serif"],
      },
      colors: {
        canvas: "#FFFFFF",
        line: "#ECEAF2",
        ink: { DEFAULT: "#111827", soft: "#4B5563", muted: "#6B7280" },
        primary: {
          DEFAULT: "#111111",
          hover: "#000000",
          soft: "#F1EDFA",
          ring: "#B5A6DE",
        },
        brand: {
          lavender: "#B5A6DE",
          purple: "#7E57C2",
        },
      },
      borderRadius: { card: "12px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)",
        pop: "0 8px 24px rgba(16,24,40,0.08)",
      },
    },
  },
  plugins: [],
};
export default config;
