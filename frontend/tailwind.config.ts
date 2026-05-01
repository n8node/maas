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
      },
    },
  },
  plugins: [],
};
