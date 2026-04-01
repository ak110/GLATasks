# カスタム指示 (プロジェクト固有)

## 開発手順

- Markdownファイルのformat/lintの実行方法: `uvx pre-commit run --files <file>`
- 作業完了時は`make test`を必ず実行すること (`make format`ではだめ)
- `make update-actions`: GitHub Actionsのハッシュピン更新（mise経由でpinact実行）

## 関連ドキュメント

- @README.md
- @docs/src/content/docs/development/architecture.md
- @docs/src/content/docs/development/development.md
