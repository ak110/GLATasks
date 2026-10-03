# 観測記録

本ファイルは、エージェント向け文書（`.claude/skills/`配下など）や開発者向け文書の条文のうち、依存ツールの挙動を現物で観測して確かめたものについて、確認した日付、観測した版数および再検証の手段を保持する。
条文の側には観測事象だけを置き、本ファイルのH2見出しで索引する。
条文が前提とする挙動と異なる観測を得た場合は、その条文が指すH2見出しを読み、記載された手段で再検証してから条文の失効を判定する。
H2見出しは索引元の条文が指す文字列と一致させる。

## `.claude/skills/e2etest/SKILL.md`：失敗時の診断成果物の保持：2026年10月3日

2026-10-03、Playwright 1.63.0の`lib/runner/index.js`の開始処理を読んだ。
`createGlobalSetupTasks`が呼ぶ`createRemoveOutputDirsTask`は、通常の開始時に選択されたprojectのoutputDirを削除する。
一時ディレクトリへ同じ`createRemoveOutputDirsTask`と`removeFolders`を適用した対照では、通常設定で指定ディレクトリが消え、出力先の外へ置いた複製は残った。
同日のE2E失敗の調査では、初回の実行が1件失敗して`test-results`配下へスクリーンショット・`error-context.md`・`trace.zip`を出力した。
同じ出力先での再実行後には`.last-run.json`だけが残った。
同日、`make test-e2e`の1回目の後に`test-results`へ目印のファイルを置いて外側へ`cp -a`で複製し、2回目を実行すると、元の目印は消えて複製側には残った。

再検証の手順は次のとおり。

1. 導入済みの`node_modules/playwright/lib/runner/index.js`で`createRemoveOutputDirsTask`の呼び出し条件を読む
2. `make test-e2e`を実行した後、出力先へ目印のファイルを置き、出力先の外へ複製する
3. 同じ出力先で`make test-e2e`を再実行し、元の目印が削除されることと、複製が残ることを確かめる
