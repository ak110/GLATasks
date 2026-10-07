import { createMainDialogs } from "./main-dialogs.svelte.ts";
import { SvelteSet } from "svelte/reactivity";

export function createMainState() {
  let selectedListId = $state<number | null>(null);
  let showType = $state<"active" | "archived" | "all">("active");
  // 他端末で更新されたタスクのIDセット（リスト切り替えでクリア）
  let updatedTaskIds = new SvelteSet<number>();
  let addListTitle = $state("");
  let addTaskText = $state("");
  let openMenuId = $state<number | null>(null);
  let dragOverListId = $state<number | null>(null);
  let hasHash = $state(false);
  let searchQuery = $state("");
  let debouncedQuery = $state("");
  let taskList = $state<{ scrollToTop: () => void }>();

  const dialogs = createMainDialogs();

  return {
    dialogs,
    get selectedListId() {
      return selectedListId;
    },
    set selectedListId(value: typeof selectedListId) {
      selectedListId = value;
    },
    get showType() {
      return showType;
    },
    set showType(value: typeof showType) {
      showType = value;
    },
    get updatedTaskIds() {
      return updatedTaskIds;
    },
    set updatedTaskIds(value: typeof updatedTaskIds) {
      updatedTaskIds = value;
    },
    get addListTitle() {
      return addListTitle;
    },
    set addListTitle(value: typeof addListTitle) {
      addListTitle = value;
    },
    get addTaskText() {
      return addTaskText;
    },
    set addTaskText(value: typeof addTaskText) {
      addTaskText = value;
    },
    get openMenuId() {
      return openMenuId;
    },
    set openMenuId(value: typeof openMenuId) {
      openMenuId = value;
    },
    get dragOverListId() {
      return dragOverListId;
    },
    set dragOverListId(value: typeof dragOverListId) {
      dragOverListId = value;
    },
    get hasHash() {
      return hasHash;
    },
    set hasHash(value: typeof hasHash) {
      hasHash = value;
    },
    get searchQuery() {
      return searchQuery;
    },
    set searchQuery(value: typeof searchQuery) {
      searchQuery = value;
    },
    get debouncedQuery() {
      return debouncedQuery;
    },
    set debouncedQuery(value: typeof debouncedQuery) {
      debouncedQuery = value;
    },
    get taskList() {
      return taskList;
    },
    set taskList(value: typeof taskList) {
      taskList = value;
    },
  };
}
export type MainState = ReturnType<typeof createMainState>;
