export const UI_LAYERS = {
  menu: "z-20",
  banner: "z-40",
  dialog: "z-50",
  notification: "z-[60]",
} as const;
// 通知はnotificationLayerでtop layerへ載せ、開いているモーダルの前へ表示する。

export const menuFrameClass = `absolute top-full right-0 min-w-max rounded border border-gray-200 bg-white py-1 text-left shadow-lg dark:border-gray-600 dark:bg-gray-800 ${UI_LAYERS.menu}`;
export const menuItemClass =
  "block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:text-gray-500";
export const menuBlueItemClass =
  "block w-full cursor-pointer px-4 py-1.5 text-left text-blue-600 hover:bg-gray-100 dark:text-blue-400 dark:hover:bg-gray-700";
export const menuDangerItemClass =
  "block w-full cursor-pointer px-4 py-1.5 text-left text-red-600 hover:bg-red-50 disabled:cursor-default disabled:text-gray-400 disabled:hover:bg-transparent dark:text-red-400 dark:hover:bg-red-900/30 dark:disabled:text-gray-500";

// エンドユーザーが入力した任意の名前と操作ボタンを同じ行へ並べる場合の幅配分。
// 名前の領域は縮小でき、分割不能な長い文字列も任意の位置で折り返して全文を表示する。
// 操作の領域は縮小しないため、名前が長くても操作は行の内側に残る。
export const nameAreaClass = "min-w-0 flex-1 wrap-anywhere";
export const actionAreaClass = "shrink-0";

export const grayButtonClass =
  "cursor-pointer rounded bg-gray-100 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600";
export const dialogInputClass =
  "rounded border border-gray-200 px-3 py-2 focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
export const closeButtonClass =
  "cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300";

export const inputClass =
  "rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-800 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";

export const timerInputClass =
  "rounded border border-gray-200 px-3 py-2 focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";
