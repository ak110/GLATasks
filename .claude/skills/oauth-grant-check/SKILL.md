---
verified-digest: d1ae7a2cf1582a06f61e66625d0d46e253aa6c300c22886b64bed01e16ab2fab
name: oauth-grant-check
description: >
  MCPのOAuthで認可コードの交換、トークンの更新・検証を変更したとき、発行時の権限が保たれることを確かめる。
verifies:
  - app/src/routes/oauth/token/+server.ts
  - app/src/lib/server/mcp/store.ts
  - app/src/lib/server/mcp/oauth.ts
  - app/src/lib/server/mcp/client-auth.ts
  - app/src/lib/server/mcp/oauth-grants-exhaustive.test.ts
---

# MCPのOAuthトークンの検証

認可コードの交換と更新で、利用者・クライアント・スコープが発行時の値から変わらないことを確かめる。
権限が変わると、別の利用者のタスクを読み書きできるおそれがある。

## 対象と範囲

Vitestはテスト用のデータと時計でトークンルートと検証関数を呼ぶ。
認可コードの交換では、利用者2人とクライアント2種を使い、クライアントの認証情報、
戻り先、PKCE、期限を変えた要求を同じコードに対して最大2件送る。
コードが未消費で条件を満たす場合だけ交換でき、成功は高々1回となる。
クライアント認証と必須項目の確認を通った提示は、交換に失敗してもコードを消費する。
失敗後の再試行には、同じコードではなく新しい認可が必要になる。

更新では用途、期限、発行先クライアントとスコープを確認する。
アクセス用と更新用のトークンは互いの用途では使えない。
別プロセス間の状態共有、認可画面、3件以上の要求、鍵漏えいは対象外。

合成した許可・拒否の結果を、実ルートの応答にも使う判定器に渡す。
期待と異なる結果では違反を返し、一致する結果では違反を返さないことを確かめる。
この試験では製品の関数を差し替えない。

## 再実行

型生成済みの作業ツリーで実行する。

```bash
pnpm --dir app exec vitest run --project node src/lib/server/mcp/oauth-grants-exhaustive.test.ts
```

失敗した場合は、出力が示した入力と期待値を、トークン発行時の権限と比較する。
対象実装と検査の一致を確認した後、リポジトリのルートで記録を更新する。

```bash
uvx --exclude-newer-package pyfltr=false pyfltr verification-sync --update .claude/skills/oauth-grant-check/SKILL.md
```
