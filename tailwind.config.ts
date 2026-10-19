import type { Config } from "tailwindcss";

/** TW3 仅作底座；业务界面样式以 app/globals.css 语义化 class 为准 */
const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};

export default config;
