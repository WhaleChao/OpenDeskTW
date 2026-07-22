(function (root, factory) {
  "use strict";
  const tools = factory(root);
  if (typeof module === "object" && module.exports) module.exports = tools;
  root.OpenDeskTwUiPatch = tools;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const translations = root.OpenDeskTwUiOverrides?.translations || {};
  const numericFontSizes = Object.freeze({
    初号: "42",
    初號: "42",
    小初: "36",
    一号: "26",
    一號: "26",
    小一: "24",
    二号: "22",
    二號: "22",
    小二: "18",
    三号: "16",
    三號: "16",
    小三: "15",
    四号: "14",
    四號: "14",
    小四: "12",
    五号: "10.5",
    五號: "10.5",
    小五: "9",
    六号: "7.5",
    六號: "7.5",
    小六: "6.5",
    七号: "5.5",
    七號: "5.5",
    八号: "5",
    八號: "5",
  });
  const translatedAttributes = [
    "aria-label",
    "data-hint",
    "data-original-title",
    "placeholder",
    "title",
  ];

  function translateText(value) {
    if (typeof value !== "string" || !value) return value;
    if (numericFontSizes[value]) return numericFontSizes[value];
    if (translations[value]) return translations[value];

    const match = value.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2]) return value;
    const core = match[2];
    const translated = numericFontSizes[core] || translations[core];
    return translated ? `${match[1]}${translated}${match[3]}` : value;
  }

  function shouldSkipTextNode(node) {
    const parent = node.parentElement;
    return Boolean(
      parent?.closest?.(
        'script, style, textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"]',
      ),
    );
  }

  function translateNode(startNode) {
    if (!startNode) return 0;
    const queue = [startNode];
    let changes = 0;

    while (queue.length) {
      const node = queue.pop();
      if (!node) continue;

      if (node.nodeType === 3) {
        if (shouldSkipTextNode(node)) continue;
        const translated = translateText(node.nodeValue);
        if (translated !== node.nodeValue) {
          node.nodeValue = translated;
          changes += 1;
        }
        continue;
      }

      if (node.nodeType !== 1 && node.nodeType !== 9 && node.nodeType !== 11) continue;
      if (node.nodeType === 1) {
        for (const attribute of translatedAttributes) {
          if (!node.hasAttribute?.(attribute)) continue;
          const original = node.getAttribute(attribute);
          const translated = translateText(original);
          if (translated !== original) {
            node.setAttribute(attribute, translated);
            changes += 1;
          }
        }
      }

      for (const child of node.childNodes || []) queue.push(child);
    }
    return changes;
  }

  function forceNumericFontSizes(hostWindow) {
    let changed = false;
    try {
      hostWindow.localStorage?.setItem("de-settings-western-font-size", "1");
      root.localStorage?.setItem("de-settings-western-font-size", "1");
    } catch (_error) {
      // 某些沙箱會限制直接存取 localStorage，下面仍會使用 ONLYOFFICE 設定層。
    }

    try {
      const common = hostWindow.Common;
      common?.localStorage?.setBool?.("de-settings-western-font-size", true);
      common?.localStorage?.save?.();
      common?.Utils?.InternalSettings?.set?.("de-settings-western-font-size", true);

      const controller = hostWindow.DE?.getController?.("Toolbar");
      const toolbar = controller?.getView?.("Toolbar") || controller?.getView?.();
      if (toolbar?._fontSizeWestern?.length && toolbar?.cmbFontSize?.setData) {
        toolbar.cmbFontSize.setData(toolbar._fontSizeWestern);
        const rawValue = toolbar.cmbFontSize.getRawValue?.();
        const numericValue = numericFontSizes[rawValue];
        if (numericValue) toolbar.cmbFontSize.setRawValue?.(numericValue);
        changed = true;
      }
      if (controller?._state) controller._state.type_fontsize = "number";
    } catch (_error) {
      // 編輯器可能仍在初始化；安裝流程會於稍後自動重試。
    }
    return changed;
  }

  function install(hostWindow) {
    if (!hostWindow?.document?.documentElement) return false;
    const stateKey = "__openDeskTwTraditionalUiPatchV2";
    if (hostWindow[stateKey]) {
      hostWindow[stateKey].refresh();
      return true;
    }

    const pending = new Set();
    let scheduled = false;
    const flush = function () {
      scheduled = false;
      for (const node of pending) translateNode(node);
      pending.clear();
      forceNumericFontSizes(hostWindow);
    };
    const schedule = function (node) {
      if (node) pending.add(node);
      if (scheduled) return;
      scheduled = true;
      (hostWindow.requestAnimationFrame || hostWindow.setTimeout)(flush);
    };
    const observer = new hostWindow.MutationObserver(function (mutations) {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") schedule(mutation.target);
        else if (mutation.type === "attributes") schedule(mutation.target);
        else for (const node of mutation.addedNodes) schedule(node);
      }
    });

    observer.observe(hostWindow.document.documentElement, {
      attributes: true,
      attributeFilter: translatedAttributes,
      characterData: true,
      childList: true,
      subtree: true,
    });

    const refresh = function () {
      translateNode(hostWindow.document.documentElement);
      forceNumericFontSizes(hostWindow);
      hostWindow.document.documentElement.lang = "zh-Hant-TW";
    };
    hostWindow[stateKey] = { observer, refresh };
    refresh();
    for (const delay of [250, 1000, 3000, 7000]) hostWindow.setTimeout(refresh, delay);
    return true;
  }

  return { forceNumericFontSizes, install, numericFontSizes, translateNode, translateText };
});
