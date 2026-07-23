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
  const taiwanTerminology = Object.freeze([
    ["拼写与语法检查", "拼字與文法檢查"],
    ["创建 AI 助手", "建立 AI 助理"],
    ["聊天机器人", "聊天機器人"],
    ["翻译", "翻譯"],
    ["建议", "建議"],
    ["设置", "設定"],
    ["拼写", "拼字"],
    ["语法", "文法"],
    ["检查", "檢查"],
    ["创建", "建立"],
    ["助手", "助理"],
    ["机器人", "機器人"],
    ["模型列表", "模型清單"],
    ["密钥", "金鑰"],
    ["实时", "即時"],
    ["图像", "影像"],
    ["代码", "程式碼"],
    ["配置", "設定"],
    ["演示文稿", "簡報"],
    ["幻燈片", "投影片"],
    ["工作簿", "活頁簿"],
    ["單元格", "儲存格"],
    ["文件夾", "資料夾"],
    ["服務器", "伺服器"],
    ["互聯網", "網際網路"],
    ["網絡", "網路"],
    ["視頻", "視訊"],
    ["軟件", "軟體"],
    ["程序", "程式"],
    ["默認", "預設"],
    ["設置", "設定"],
    ["打印", "列印"],
    ["保存", "儲存"],
    ["創建", "建立"],
    ["鏈接", "連結"],
    ["視圖", "檢視"],
    ["組件", "元件"],
    ["內存", "記憶體"],
    ["數據", "資料"],
    ["文檔", "文件"],
    ["信息", "資訊"],
    ["單擊", "按一下"],
    ["鼠標", "滑鼠"],
    ["宏", "巨集"],
  ]);

  function localizeTaiwanTerminology(value) {
    if (typeof value !== "string" || !value) return value;
    let localized = value;
    for (const [mainland, taiwan] of taiwanTerminology) {
      localized = localized.replaceAll(mainland, taiwan);
    }
    return localized;
  }

  function translateText(value) {
    if (typeof value !== "string" || !value) return value;
    if (numericFontSizes[value]) return numericFontSizes[value];
    if (translations[value]) return localizeTaiwanTerminology(translations[value]);

    const match = value.match(/^(\s*)(.*?)(\s*)$/s);
    if (!match || !match[2]) return value;
    const core = match[2];
    const translated = numericFontSizes[core] || translations[core];
    const result = translated ? `${match[1]}${translated}${match[3]}` : value;
    return localizeTaiwanTerminology(result);
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

  function preferLocalizedAiToolbar(hostWindow) {
    const document = hostWindow?.document;
    if (!document?.querySelector) return false;
    const localized = document.querySelector(
      'li.ribtab > a[data-title="其他 AI 模型"]',
    );
    if (!localized) return false;
    let hidden = false;
    for (const original of document.querySelectorAll('li.ribtab > a[data-title="AI"]')) {
      const tab = original.closest("li.ribtab");
      if (tab && tab.style.display !== "none") {
        tab.style.display = "none";
        tab.setAttribute("aria-hidden", "true");
        hidden = true;
      }
    }
    return hidden;
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
      preferLocalizedAiToolbar(hostWindow);
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
      preferLocalizedAiToolbar(hostWindow);
      hostWindow.document.documentElement.lang = "zh-Hant-TW";
    };
    hostWindow[stateKey] = { observer, refresh };
    refresh();
    for (const delay of [250, 1000, 3000, 7000]) hostWindow.setTimeout(refresh, delay);
    return true;
  }

  return {
    forceNumericFontSizes,
    install,
    localizeTaiwanTerminology,
    numericFontSizes,
    preferLocalizedAiToolbar,
    translateNode,
    translateText,
  };
});
