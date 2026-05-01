/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#ffffff",
        bg2: "#f8f8f7",
        bg3: "#f3f2ef",
        ink: "#1a1a1a",
        muted: "#5f5e5a",
        subtle: "#888780",
        border: "#e8e7e3",
        border2: "#d3d1c7",
        accent: "#185fa5",
        "accent-bg": "#e6f1fb",
        featured: "#b5d4f4",
        success: "#639922",
        "success-text": "#3b6d11",
        "success-bg": "#eaf3de",
        warn: "#ba7517",
        "warn-bg": "#faeeda",
        "warn-border": "#f5c57a",
        "warn-text": "#633806",
        error: "#a32d2d",
        "error-bg": "#fcebeb",
        "error-border": "#f09595",
      },
      borderRadius: {
        lg: "12px",
      },
    },
  },
  plugins: [],
};
