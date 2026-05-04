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
    rules: {
      // `_` プレフィックス付きの引数・変数・catchハンドラは意図的な未使用としてlint対象外にする
      // （TypeScript/typescript-eslintコミュニティの一般的慣例）
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
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
      "node_modules/**",
      ".cache/**",
      "docs/**",
    ],
  },
];
