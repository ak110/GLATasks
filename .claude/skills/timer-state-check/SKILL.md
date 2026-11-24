---
verified-digest: a68f792c64971f9e13f6b27dae722f1f1b7785020c910e2667949eb125191faf
name: timer-state-check
description: >
  タイマーの保存状態または並行操作を変更した時に、実装を使って有限個の操作順序と保存契約を検査する。
verifies:
  - app/src/lib/server/timer-state.ts
  - app/src/lib/server/api/timers.ts
  - app/src/lib/server/api/timers-concurrency.test.ts
---

# タイマーの有界網羅検査

## 性質と影響

- `timerStateColumns`の保存列では残秒数が非負で、満了なら0になる。
  実行中は開始時刻があり未満了、それ以外では開始時刻がない。崩れると表示と満了通知が一致しなくなる。
  期限超過を差し引く`timerRemainingSeconds`の中間値は対象外。
- 実行中の`setTimerTime`と`updateTimer`のモード変更は`timer_is_running`で拒否し、保存値を変えない。
  拒否されなければ、動いているタイマーのカウントが不意に変わる。
- `startedAt`が保存中の実行と異なる`stopTimer`はその実行を満了にしない。
  破れると前の実行の遅延要求が再開したタイマーを止める。引数のない`stopTimer`と`updateTimer`にはこの照合を要求しない。
- `deleteTimer`後の更新は不存在として拒否し、書き込みを試みない。破れると消したタイマーを再表示するおそれがある。

## 対象と探索範囲

実装は`app/src/lib/server/timer-state.ts`の状態遷移・保存列変換と、
`app/src/lib/server/api/timers.ts`の`changeTimer`、`getOwnedTimer`および下記8操作。
共有状態は同じ所有者の同じIDのタイマー行1件（状態列、モード・時間設定を含む）。
Vitestで実際のAPI関数を呼び、DB境界のみ差し替える。依存ツールを増やさず、実装の変更を検出する。

1手順は、`SELECT ... FOR UPDATE`から保存までのトランザクション、または`deleteTimer`の1 SQL文。
この粒度で直列化されると仮定し、1つの行を対象に2要求の順序を全て列挙する。
`startTimer`、`pauseTimer`、`resetTimer`、`adjustTimer`（±1分）、
`stopTimer`（指定なし・初期行の開始時刻・固定の旧時刻）を扱う。ほかに`setTimerTime`（0秒・60秒）、
`updateTimer`（初期モードからの変更・名前変更）、`deleteTimer`の13入力を使う。
2要求は初期行を見て送信される。初期状態は2モード × 4保存状態（停止0秒、停止60秒、実行中60秒、満了）、
最初の操作時刻は基準時刻の1秒後と61秒後の2通り。次はその1秒後とする。
計2,704列・5,408手順を検査する。既存の競合ケースも同じファイル内で実行する。

MariaDBの行ロックそのもの、ネットワーク分断時の無限再送、別実行で同じ`started_at`となる場合の識別、
3要求以上、別行・別ユーザー、一覧取得による自動満了、列挙外の入力は保証しない。

## 再実行と追従

型生成済みの作業ツリーで実行する。通常の単体テストにも含まれる。

```bash
pnpm --dir app exec vitest run --project node src/lib/server/api/timers-concurrency.test.ts
```

前回検証した版から対象関数と保存列を書き込む呼出側の差分を読み、ロック境界や入力の代表値が変われば探索の前提を更新する。
失敗したらエラーが示すモード・初期状態・時刻・操作列を再生し、DB境界の仮定で起こり得る順序か確認する。
起こらないなら検査を直し、起こるなら不変条件を弱めず実装の不具合として扱う。
追従時は隔離worktreeで`transitionTimer`の開始時刻比較を一時的に反転して失敗を確認し、元に戻して再実行する。
対象実装と検査の一致を確認してから、リポジトリのルートで検証記録を更新する。

```bash
uvx --exclude-newer-package pyfltr=false pyfltr verification-sync --update .claude/skills/timer-state-check/SKILL.md
```
