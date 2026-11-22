/* global chrome */

document.addEventListener("DOMContentLoaded", async function () {
  const BASE_URL = "https://glatasks.tqzh.tk";
  const contentFrame = document.querySelector("#contentFrame");

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const currentTab = tabs[0];
  const title = encodeURIComponent(currentTab.title || "");
  const url = encodeURIComponent(currentTab.url || "");
  const targetUrl = `${BASE_URL}/share/ingest?title=${title}&url=${url}&in_popup=1`;

  contentFrame.src = targetUrl;
});
