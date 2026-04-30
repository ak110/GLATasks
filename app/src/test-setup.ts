/**
 * @fileoverview DOM環境テスト用のグローバルセットアップ
 *
 * @testing-library/jest-dom のカスタムマッチャー（toBeInTheDocument 等）を
 * DOM環境プロジェクト全体で利用できるようにする。
 */
import "@testing-library/jest-dom/vitest";
