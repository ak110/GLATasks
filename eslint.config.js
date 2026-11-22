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
      "no-empty": ["error", { allowEmptyCatch: true }],
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
    // 再読み込みと完全な画面遷移の検出。通信断の間はService Workerのオフライン画面へ移り、表示中の画面を失う。
    // 自動処理へ書くと、AndroidのPWAで復帰直後の通信断のようにオフライン画面へ切り替わる原因になる。
    files: ["app/src/**/*.{js,ts,svelte}"],
    ignores: ["app/src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        ...fullNavigationSelectors().map((selector) => ({
          selector,
          message:
            "再読み込み・完全な画面遷移は、通信断の間はService Workerのオフライン画面へ移り、表示中の画面を失う。通信断でも実行してよい理由を抑止コメント（eslint-disable-next-line no-restricted-syntax -- <理由>）に書くか、処置を変える。",
        })),
      ],
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

function fullNavigationSelectors() {
  const isLocation =
    ":matches([object.type='Identifier'][object.name='location'], [object.type='MemberExpression'][object.property.name='location'][object.object.name=/^(window|globalThis)$/])";
  return [
    `CallExpression > MemberExpression.callee${isLocation}[property.name=/^(reload|assign|replace)$/]`,
    `AssignmentExpression > MemberExpression.left${isLocation}[property.name='href']`,
  ];
}
