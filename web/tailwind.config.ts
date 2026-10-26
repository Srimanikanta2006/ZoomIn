import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        border: "#e5e0d8",
        background: "#fbf9f4",
        foreground: "#1b1c19",
        primary: { DEFAULT: "#1f3a5f", foreground: "#ffffff" },
        secondary: { DEFAULT: "#f5f3ee", foreground: "#1b1c19" },
        muted: { DEFAULT: "#f5f3ee", foreground: "#526071" },
        accent: { DEFAULT: "#fc9923", foreground: "#653800" },
        destructive: { DEFAULT: "#ba1a1a", foreground: "#ffffff" },
        ring: "#1f3a5f",
      },
      borderRadius: { lg: "0.75rem", md: "0.5rem", sm: "0.25rem" },
      fontFamily: {
        sans: ["Inter", "Arial", "sans-serif"],
        display: ["Newsreader", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};

export default config;
