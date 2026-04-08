import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ out: "build" }),
    // CSRF 対策は hooks.server.ts の Sec-Fetch-Site チェックで行うため、
    // SvelteKit 組み込みの Origin チェックは無効化する（リバースプロキシ経由で誤検知するため）
    csrf: { trustedOrigins: ["*"] },
  },
};

export default config;
