const config = {
  plugins: {
    "@tailwindcss/postcss": {},
    // Tailwind 4 emits @layer, :is(), :where() and other modern CSS that older
    // smart-TV browsers (VIDAA) drop wholesale. Lower it so the TV gets styles.
    "postcss-preset-env": { browsers: "chrome >= 64" },
    "./postcss-unwrap-where.cjs": {},
  },
};

export default config;
