# リスト統合機能

## Context

タスク管理において、2つのリストを1つに統合したいケースがある（プロジェクト整理、重複リストの統合など）。アーカイブ済みタスクも含めて全タスクを移動先リストに移し、移動元リストを削除する。一度実行すると元に戻せない破壊的操作のため、確認ダイアログで明示的な同意を求める。

## 設計

### バックエンド

#### スキーマ (`app/src/lib/schemas.ts`)

`MergeListSchema` を追加:

```typescript
export const MergeListSchema = z.object({
  sourceListId: z.number().int().positive(),
  targetListId: z.number().int().positive(),
});
```

#### API (`app/src/lib/server/api.ts`)

新規関数 `mergeLists(userId, sourceListId, targetListId)`:

1. `sourceListId === targetListId` のバリデーション
2. `getOwnedList()` で両リストの所有権確認、両方アクティブであることを確認
3. トランザクション内で:
   - source の全タスクを `sort_order` 昇順で取得
   - target の全タスクを `sort_order` 昇順で取得
   - 各リストの `updated` を sort_order と整合するよう線形補間で補正し DB にも反映（後述のアルゴリズム参照）
   - 補正後の `updated` をキーにマージソートのマージステップで統合（降順）
     - 各リスト内の手動並び替え（sort_order）を完全に維持
     - リスト間のインターリーブは updated で自然に決定
   - マージ結果に sort_order を 0, 1000, 2000... で再割り当て
   - 全タスクの `list_id`, `sort_order`, `updated` を一括更新（source・target 両方）
   - source リストを削除
   - target の `last_updated` を更新

#### tRPC (`app/src/lib/server/trpc.ts`)

`lists.merge` mutation を追加:

- input: `MergeListSchema`（難読化デコード済み）
- `mergeLists()` を呼び出し
- SSEイベント: `lists:updated` と `tasks:updated` を送信

### フロントエンド

#### MergeListDialog (`app/src/lib/components/lists/MergeListDialog.svelte`)

既存の `TaskEditDialog` と同じダイアログパターンで新規作成:

- Props: `open`, `sourceList` (id + title), `allLists`, `onSubmit`, `onClose`
- 内容:
  - タイトル: 「リストの統合」
  - 統合元リスト名を表示
  - 統合先リストを `<select>` で選択（アクティブリスト、自分自身を除く）
  - 移動タスク数を表示
  - 警告文: 「この操作は元に戻せません」
  - 「統合」ボタン（赤系の危険色）で実行

#### ListItem (`app/src/lib/components/lists/ListItem.svelte`)

⋮メニューに「他のリストに統合」を追加（アーカイブ済みリストでは非表示）。

#### +page.svelte (`app/src/routes/+page.svelte`)

- `mergeListMutation` を追加
- `MergeListDialog` の状態管理（open/close、sourceList）
- 統合完了後: 統合先リストを自動選択、クエリ invalidate

### マージアルゴリズム詳細

```text
入力:
  targetTasks = [T1, T2, T3]  (sort_order 昇順)
  sourceTasks = [S1, S2, S3]  (sort_order 昇順)

Step 1: 各リストの updated を sort_order と整合するよう線形補間で補正
  (sort_order 昇順 = updated 降順 となるよう、矛盾箇所を線形補間で修正)

  for each list in [targetTasks, sourceTasks]:
    i = 1
    while i < len(list):
      if list[i].updated <= list[i-1].updated:
        i++; continue  // 矛盾なし
      // 矛盾発見: i以降で次の整合点を探す
      anchorStart = i - 1
      anchorStartVal = list[anchorStart].updated
      j = i + 1
      while j < len(list) && list[j].updated > anchorStartVal:
        j++
      // anchorStart+1 から j-1 を線形補間
      anchorEndVal = j < len(list) ? list[j].updated : anchorStartVal
      count = j - anchorStart
      for k = anchorStart+1 to j-1:
        t = (k - anchorStart) / count
        list[k].updated = lerp(anchorStartVal, anchorEndVal, t)
      i = j

  例:
    A[0] Oct,so=0   → Oct (そのまま)
    A[1] Dec,so=100 → lerp(Oct, Aug, 1/3) ≈ Sep  // 矛盾するので補間
    A[2] Jan,so=200 → lerp(Oct, Aug, 2/3) ≈ Aug  // 矛盾するので補間
    A[3] Aug,so=300 → Aug (整合点)

Step 2: マージソートのマージステップ（キー: updated 降順）
  i = 0, j = 0, result = []
  while i < len(targetTasks) && j < len(sourceTasks):
    if targetTasks[i].updated >= sourceTasks[j].updated:
      result.push(targetTasks[i++])
    else:
      result.push(sourceTasks[j++])
  result.push(...残り)

出力:
  result の各タスクに sort_order = index * 1000 を割り当て
  全タスクの list_id, sort_order, updated を DB に更新
  (注: 矛盾箇所の updated は実際の更新時刻から乖離するが、
   sort_order の整合性を優先する設計判断として許容する。
   updated はUI表示に直接使用されておらず影響は限定的。)
```

## 検証方法

1. `make format` でコード整形・lint
2. ユニットテスト: マージアルゴリズムのテスト（`mergeLists` 関数の動作確認）
3. `make test` で全テスト通過を確認
