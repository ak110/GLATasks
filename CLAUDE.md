# カスタム指示（プロジェクト固有）

## 開発手順

- `make format`: 整形 + 軽量lint + 自動修正（開発時の手動実行用）
- `make test`: 全チェック実行（これを通過すればコミット可能）
- `make update`: 依存更新 + pinactアクション更新 + 全テスト実行
  - `make update-actions`: GitHub Actionsのハッシュピン更新のみ（mise経由でpinact実行）
- Markdownファイルのformat/lintの実行方法: `uvx pre-commit run --files <file>`
- vitestのenvironmentは `node`（`vitest.config.ts` @ repo root）。DOM API（`EventSource`, `localStorage` 等）を使うコードを
  テストするときは `globalThis` のプロパティにモック実装を代入する
- 現在の `COMPOSE_PROFILE` を確認したいときは `make -n deploy` のドライラン出力で判別できる（`.env` を直接読めないことがある）
- 本リポジトリはSvelte 5、Tailwind v4、tRPC v11、Vite 8など比較的新しいメジャーバージョンを使用している
- ドキュメントのみの変更（`*.md`や`docs/**`の更新）をコミットする場合、事前の手動`make test`は省略してよい。`git commit`時点で`pre-commit`の`pyfltr fast`フックが`markdownlint-fast`と`textlint-fast`を自動実行するため、Markdownの検証はそこで担保される
- コードやテストに手を入れた変更では従来どおり`make test`を通してからコミットする

## Claude Code向けコミット前検証

Claude Codeがコミット前に検証する際は、`make test`の代わりに以下を実行する。JSON Lines出力によりLLMがツール別診断を効率的に解釈できる。

```bash
uvx pyfltr run --output-format=jsonl | tail -30
```

バックアップ/E2E系に変更を入れた場合は`make test-backup test-e2e`も実行する。
人間の開発者は従来どおり`make test`を使用する。

注意: 本プロジェクトのDocker Compose環境は開発マシン上で常時稼働している。`make test`（backup/e2eテスト含む）は問題なく実行可能である。上記で`uvx pyfltr run`を使うのはJSON Lines出力で診断結果を効率的に解釈するためであり、環境制約によるものではない。

## 関連ドキュメント

- @README.md
- @docs/development/architecture.md
- @docs/development/development.md
