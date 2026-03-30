// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

export default defineConfig({
    site: "https://ak110.github.io",
    base: "/GLATasks",
    integrations: [
        starlight({
            title: "GLATasks",
            description: "タスクメモ管理＆カウントダウンタイマーアプリ",
            social: [
                {
                    icon: "github",
                    label: "GitHub",
                    href: "https://github.com/ak110/GLATasks",
                },
            ],
            editLink: {
                baseUrl: "https://github.com/ak110/GLATasks/edit/master/docs/",
            },
            sidebar: [
                {
                    label: "ガイド",
                    items: [
                        { slug: "guide/getting-started" },
                        { slug: "guide/chrome-extension" },
                        { slug: "guide/android-share" },
                    ],
                },
                {
                    label: "開発",
                    items: [
                        { slug: "development/architecture" },
                        { slug: "development/development" },
                    ],
                },
            ],
        }),
    ],
});
