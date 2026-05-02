/* global chrome */

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToGLATasks",
    title: "GLATasksに保存する",
    contexts: ["page", "selection", "link"],
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToGLATasks") {
    const title = encodeURIComponent(tab.title || "");
    const url = encodeURIComponent(tab.url || "");
    const targetUrl = `https://glatasks.tqzh.tk/share/ingest?title=${title}&url=${url}`;

    chrome.tabs.create({
      url: targetUrl,
    });
  }
});
