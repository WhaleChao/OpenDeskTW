(function installOpenDeskTwHomePatch() {
  "use strict";

  const patchKey = "__OpenDeskTwHomePatch";
  const translations = new Map([
    ["Home", "首頁"],
    ["樣板", "範本"],
    ["模板", "範本"],
    ["Clouds", "雲端"],
    ["AI 智能体", "AI 助理"],
    ["AI 智能體", "AI 助理"],
    ["File name", "檔案名稱"],
    ["Location", "位置"],
    ["Last opened", "上次開啟時間"],
    ["接口缩放", "介面縮放"],
    ["自动", "自動"],
    ["可以访问pro功能", "可使用 Pro 功能"],
    ["可以访问 Pro 功能", "可使用 Pro 功能"],
    ["和系统一致", "跟隨系統"],
    ["暗色对比", "深色高對比"],
    ["应用程序已为最新版本", "應用程式已是最新版本"],
    ["点击下载", "按一下下載"],
    ["点击安装", "按一下安裝"],
    ["点击停止", "按一下停止"],
  ]);
  const attributes = ["aria-label", "placeholder", "title"];

  function translate(value) {
    const source = String(value || "");
    const trimmed = source.trim();
    if (!trimmed) return source;
    const direct = translations.get(trimmed);
    if (direct) {
      const leading = source.slice(0, source.indexOf(trimmed));
      const trailing = source.slice(source.indexOf(trimmed) + trimmed.length);
      return `${leading}${direct}${trailing}`;
    }
    let output = source;
    for (const [from, to] of translations) {
      if (output.includes(from)) output = output.split(from).join(to);
    }
    return output;
  }

  function patchTextNode(node) {
    const next = translate(node.nodeValue);
    if (next !== node.nodeValue) node.nodeValue = next;
  }

  function patchElement(element) {
    for (const attribute of attributes) {
      if (!element.hasAttribute?.(attribute)) continue;
      const current = element.getAttribute(attribute);
      const next = translate(current);
      if (next !== current) element.setAttribute(attribute, next);
    }
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) patchTextNode(node);
  }

  function patchNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      patchTextNode(node);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE || node.nodeType === Node.DOCUMENT_NODE) {
      patchElement(node);
    }
  }

  window[patchKey]?.observer?.disconnect?.();
  patchNode(document);
  const observer = new MutationObserver(function (records) {
    for (const record of records) {
      if (record.type === "characterData") patchTextNode(record.target);
      for (const node of record.addedNodes) patchNode(node);
      if (record.type === "attributes") patchElement(record.target);
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: attributes,
    characterData: true,
    childList: true,
    subtree: true,
  });
  window[patchKey] = {
    observer,
    version: "1.0.0",
    installed: true,
  };
  return {
    installed: true,
    version: window[patchKey].version,
    text: document.body?.innerText || "",
  };
})();
