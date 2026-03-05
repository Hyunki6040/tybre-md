/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Noto Sans",
          "Pretendard",
          "sans-serif",
        ],
      },
      colors: {
        // Paper (light) theme
        paper: {
          bg: "#FAFAF8",
          surface: "#F0EFEB",
          border: "#E0DED8",
          text: "#2C2C2C",
          muted: "#9B9B97",
          accent: "#4A7FBF",
        },
        // Ink (dark) theme
        ink: {
          bg: "#1C1C1E",
          surface: "#2C2C2E",
          border: "#3A3A3C",
          text: "#E4E4E4",
          muted: "#8E8E93",
          accent: "#6BA3D6",
        },
      },
      maxWidth: {
        editor: "800px",
      },
      transitionDuration: {
        150: "150ms",
        200: "200ms",
      },
    },
  },
  plugins: [],
};
