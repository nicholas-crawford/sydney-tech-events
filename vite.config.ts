import { defineConfig } from "vite-plus";

export default defineConfig({
  // Relative asset URLs so the same build works at / locally and /sydney-tech-events/ on GitHub Pages.
  base: "./",
  test: {
    include: ["scripts/**/*.test.ts", "src/**/*.test.ts"],
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
