import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()],
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    fs: {
      allow: [".."],
    },
  },
  ssr: {
    // rrule は "exports" フィールドを持たない CommonJS パッケージであり、
    // Vite の既定の外部化判定では named export（rrulestr 等）を正しく解決できない
    // （SyntaxError: Named export 'rrulestr' not found）。noExternal で
    // Viteの変換パイプラインを通すことで interop を正しく機能させる。
    noExternal: ["rrule"],
  },
});
