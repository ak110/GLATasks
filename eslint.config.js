import js from "@eslint/js";
import ts from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import globals from "globals";

export default [
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs["flat/recommended"],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: { parser: ts.parser },
    },
  },
  {
    files: ["chrome_extension/**/*.js"],
    ...ts.configs.disableTypeChecked,
  },
  {
    ignores: [
      "app/.svelte-kit/**",
      "app/build/**",
      "app/tests/**",
      "node_modules/**",
      ".cache/**",
      "docs/**",
    ],
  },
];
