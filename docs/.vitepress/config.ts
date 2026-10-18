import { defineConfig } from 'vitepress'

// VitePress既定のslugify（@mdit-vue/shared）と同じ変換後に、仮名の濁点・半濁点を合成する。
// https://github.com/mdit-vue/mdit-vue/blob/main/packages/shared/src/slugify.ts
const slugify = (text: string) => text
  .normalize('NFKD')
  .replace(/[\u0300-\u036F]/g, '')
  .replace(/[\u0000-\u001f]/g, '')
  .replace(/[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
  .replace(/-{2,}/g, '-')
  .replace(/^-+|-+$/g, '')
  .replace(/^(\d)/, '_$1')
  .toLowerCase()
  .normalize('NFC')

export default defineConfig({
  lang: 'ja',
  title: 'GLATasks',
  description: 'タスク管理とカウントダウンタイマーを統合した Web アプリ',
  base: '/GLATasks/',
  markdown: {
    anchor: { slugify },
  },

  themeConfig: {
    nav: [
      { text: 'ホーム', link: '/' },
      { text: 'はじめに', link: '/guide/getting-started' },
    ],

    sidebar: [
      {
        text: 'ガイド',
        items: [
          { text: 'はじめに', link: '/guide/getting-started' },
          { text: 'タスクとリスト', link: '/guide/tasks' },
          { text: 'タイマーとアラーム', link: '/guide/timers' },
          { text: '定期TODO', link: '/guide/schedules' },
          { text: '翻訳', link: '/guide/translate' },
          { text: 'カロリー', link: '/guide/calories' },
          { text: 'MCP連携', link: '/guide/mcp' },
          { text: 'Chrome拡張機能', link: '/guide/chrome-extension' },
          { text: 'Android共有', link: '/guide/android-share' },
        ],
      },
      {
        text: '開発',
        items: [
          { text: 'アーキテクチャ', link: '/development/architecture' },
          { text: '開発手順', link: '/development/development' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/ak110/GLATasks' },
    ],

    search: {
      provider: 'local',
    },

    docFooter: {
      prev: '前のページ',
      next: '次のページ',
    },
    darkModeSwitchLabel: '外観',
    returnToTopLabel: 'トップに戻る',
    outline: {
      label: '目次',
    },

    editLink: {
      pattern: 'https://github.com/ak110/GLATasks/edit/master/docs/:path',
      text: 'GitHubで編集する',
    },
  },
})
