# カスタム指示 (プロジェクト固有)

## 開発手順

- `make format`: 整形 + 軽量lint + 自動修正（開発時の手動実行用）
- `make test`: 全チェック実行（これが通ればコミットしてOK）
- `make update`: 依存更新 + 全テスト実行
  - `make update-actions`: GitHub Actionsのハッシュピン更新のみ（mise経由でpinact実行）
- Markdownファイルのformat/lintの実行方法: `uvx pre-commit run --files <file>`

## 関連ドキュメント

- @README.md
- @docs/src/content/docs/development/architecture.md
- @docs/src/content/docs/development/development.md
