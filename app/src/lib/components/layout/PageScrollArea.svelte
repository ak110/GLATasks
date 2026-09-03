<script lang="ts">
    /**
     * @fileoverview ヘッダー下のスクロール領域
     *
     * ルートレイアウトの縦flexの残り高を占め、内側だけをスクロールさせる。
     * `Header.svelte`を置く画面のページ本体は、最上位要素としてこのコンポーネントを使う。
     */

    import type { Snippet } from "svelte";

    const { children }: { children: Snippet } = $props();
</script>

<!--
    relativeは絶対配置の子孫の含有ブロックをこの領域へ固定する。
    位置指定の祖先が無い絶対配置の要素は初期包含ブロックを基準に配置される。
    この場合はsr-onlyのような要素がスクロール領域の外側へ出て、文書ルートの高さを増やす。
-->
<div
    class="relative flex min-h-0 flex-1 flex-col overflow-y-auto"
    data-testid="page-scroll-area"
>
    {@render children()}
</div>
