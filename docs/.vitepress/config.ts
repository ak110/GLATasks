import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'ja',
  title: 'GLATasks',
  description: 'タスクメモ管理とカウントダウンタイマーを統合した Web アプリ',
  base: '/GLATasks/',

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
          { text: 'Chrome 拡張機能', link: '/guide/chrome-extension' },
          { text: 'Android 共有', link: '/guide/android-share' },
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
