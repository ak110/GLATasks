<script lang="ts">
    interface Props {
        expanded: boolean;
        onclick: () => void;
    }
    let { expanded, onclick }: Props = $props();
</script>

<button
    {onclick}
    class="shrink-0 cursor-pointer rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-400"
    aria-label={expanded ? "notesを折りたたむ" : "notesを展開"}
    title={expanded ? "折りたたむ" : "展開"}>{expanded ? "▲" : "▼"}</button
>
