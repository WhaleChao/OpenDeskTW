(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  let toolbarEventsBound = false;
  let magiResultWindow = null;
  let magiResultPayload = null;
  const numericFontSizes = [9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
  const taiwanFonts = [
    { id: "pmingliu", name: "PMingLiU", label: "新細明體" },
    { id: "mingliu", name: "MingLiU", label: "細明體" },
    { id: "biaukai", name: "BiauKaiTC", label: "標楷體" },
    { id: "noto-serif-tc", name: "Noto Serif CJK TC", label: "思源宋體 TC" },
    { id: "noto-sans-tc", name: "Noto Sans CJK TC", label: "思源黑體 TC" },
    { id: "pingfang-tc", name: "PingFang TC", label: "蘋方－繁" },
  ];
  const selectedTextOptions = {
    Numbering: false,
    Math: false,
    TableCellSeparator: "\t",
    TableRowSeparator: "\n",
    ParaSeparator: "\n",
    NewLineSeparator: "\n",
    TabSymbol: "\t",
  };

  function showMessage(message) {
    plugin.executeMethod("ShowError", [message, 0]);
  }

  function sendMagiWindowPayload() {
    if (magiResultWindow && magiResultPayload) {
      magiResultWindow.command("onMagiResult", magiResultPayload);
    }
  }

  function showMagiWindow(payload) {
    magiResultPayload = payload;
    if (!magiResultWindow) {
      magiResultWindow = new window.Asc.PluginWindow();
      magiResultWindow.attachEvent("onMagiResultReady", sendMagiWindowPayload);
      magiResultWindow.attachEvent("onClose", function () {
        if (magiResultWindow) magiResultWindow.close();
        magiResultWindow = null;
      });
    }
    magiResultWindow.show({
      url: "magi-result.html",
      description: "MAGI 文件助理",
      isVisual: true,
      isModal: false,
      EditorsSupport: ["word"],
      size: [620, 520],
      buttons: [{ text: "關閉", primary: false }],
    });
    window.setTimeout(sendMagiWindowPayload, 250);
  }

  function updateMagiWindow(payload) {
    magiResultPayload = payload;
    sendMagiWindowPayload();
  }

  function collectMagiText(callback) {
    plugin.executeMethod("GetSelectedText", [selectedTextOptions], function (selectedText) {
      if (selectedText && selectedText.trim()) {
        callback({ text: selectedText, source: "選取文字" });
        return;
      }
      plugin.callCommand(
        function () {
          const document = Api.GetDocument();
          const paragraphs = document.GetAllParagraphs();
          return paragraphs
            .map(function (paragraph) {
              return paragraph.GetText();
            })
            .join("\n");
        },
        false,
        false,
        function (text) {
          callback({ text: text || "", source: "整份文件" });
        },
      );
    });
  }

  function runMagiAnalysis(mode, label) {
    showMagiWindow({ state: "loading", title: label, source: "正在讀取目前文件…" });
    collectMagiText(async function (input) {
      if (!input.text.trim()) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: "目前文件沒有可供 MAGI 分析的文字。",
        });
        return;
      }
      const bridge = window.OpenDeskMagiBridge;
      if (!bridge?.url || !bridge?.token) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: "請先開啟「全能文件工作台」，再重新執行 MAGI 文件分析。",
        });
        return;
      }
      updateMagiWindow({
        state: "loading",
        title: label,
        source: `${input.source}・正在交給本機 MAGI V2／V3…`,
      });
      const controller = new AbortController();
      const timeout = window.setTimeout(function () {
        controller.abort();
      }, 110000);
      try {
        const response = await window.fetch(bridge.url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${bridge.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: input.text,
            mode,
            instruction: "",
            document_title: plugin.info?.documentTitle || "目前文件",
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok || !result.ok || !result.reply?.text) {
          throw new Error(result.error || `MAGI 橋接回應 ${response.status}`);
        }
        updateMagiWindow({
          state: "done",
          title: label,
          source: input.source,
          text: result.reply.text,
          version: String(result.reply.compatibility_version || "").toUpperCase(),
          model: result.reply.model || "",
          degraded: Boolean(result.reply.degraded),
        });
      } catch (error) {
        updateMagiWindow({
          state: "error",
          title: label,
          text:
            error?.name === "AbortError"
              ? "MAGI 分析逾時，請稍後再試。"
              : `MAGI 分析失敗：${error?.message || error}`,
        });
      } finally {
        window.clearTimeout(timeout);
      }
    });
  }

  function focusEditor() {
    plugin.executeMethod("FocusEditor", []);
  }

  function replaceSelection(text) {
    window.Asc.scope.replacementParagraphs = text.split("\n");
    plugin.callCommand(
      function () {
        return Api.ReplaceTextSmart(Asc.scope.replacementParagraphs);
      },
      false,
      true,
      focusEditor,
    );
  }

  function transformSelectionOrSentence(transform, unchangedMessage) {
    plugin.executeMethod("GetSelectedText", [selectedTextOptions], function (selectedText) {
      if (selectedText) {
        const transformed = transform(selectedText);
        if (transformed === selectedText) {
          showMessage(unchangedMessage);
          return;
        }
        replaceSelection(transformed);
        return;
      }
      plugin.executeMethod("GetCurrentSentence", [], function (sentence) {
        if (!sentence) {
          showMessage("請先選取文字，或把游標放在要整理的句子內。");
          return;
        }
        const transformed = transform(sentence);
        if (transformed === sentence) {
          showMessage(unchangedMessage);
          return;
        }
        plugin.executeMethod("ReplaceCurrentSentence", [transformed, "entirely"], focusEditor);
      });
    });
  }

  function applyDistributedAlignment() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const selection = document.GetRangeBySelect?.();
        let paragraphs = selection?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        let distributedCount = 0;
        let justifiedCount = 0;
        paragraphs.forEach(function (paragraph) {
          const rawText = String(paragraph.GetText?.() || "");
          const text = rawText.replace(/[\r\n]/g, "");
          const characters = Array.from(text);
          if (characters.length < 2) return;

          const paragraphLogic = paragraph.Ha;
          const widthMm = Number(paragraphLogic?.Ie) - Number(paragraphLogic?.ha);
          const entireRange = paragraph.GetRange?.(0, text.length);
          const textPr = entireRange?.GetTextPr?.();
          const fontHalfPoints = Number(textPr?.GetFontSize?.() || 22);
          const glyphUnits = characters.reduce(function (total, character) {
            if (/[\u2E80-\u9FFF\uF900-\uFAFF\uFF01-\uFF60]/u.test(character)) {
              return total + 1;
            }
            if (/\s/u.test(character)) return total + 0.45;
            return total + 0.56;
          }, 0);
          const availableTwips =
            Number.isFinite(widthMm) && widthMm > 0 ? (widthMm * 1440) / 25.4 : 0;
          const estimatedTextTwips = glyphUnits * fontHalfPoints * 10;
          const spacingTwips = Math.max(
            0,
            Math.min(
              800,
              Math.floor((availableTwips * 0.95 - estimatedTextTwips) / characters.length),
            ),
          );

          if (entireRange?.SetSpacing && spacingTwips >= 5) {
            paragraph.SetJc?.("left");
            entireRange.SetSpacing(spacingTwips);
            distributedCount += 1;
            return;
          }

          paragraph.SetJc?.("both");
          justifiedCount += 1;
        });
        if (distributedCount || justifiedCount) {
          return {
            applied: distributedCount + justifiedCount,
            distributed: distributedCount,
            justified: justifiedCount,
          };
        }
        return { applied: 0, distributed: 0, justified: 0 };
      },
      false,
      true,
      function (result) {
        if (!result?.applied) {
          showMessage("請先選取至少兩個字，或把游標放在要分散對齊的段落內。");
        }
        focusEditor();
      },
    );
  }

  function copyFormatting() {
    plugin.callCommand(
      function () {
        const logicDocument = Api.GetDocument()?.Document;
        if (!logicDocument || typeof logicDocument.Dne !== "function") return false;
        logicDocument.Dne();
        return true;
      },
      false,
      false,
      function (copied) {
        if (!copied) showMessage("這個編輯器版本無法複製目前選取範圍的格式。");
        focusEditor();
      },
    );
  }

  function pasteFormatting() {
    plugin.callCommand(
      function () {
        const logicDocument = Api.GetDocument()?.Document;
        const copied = logicDocument?.yb?.ocb?.();
        if (!copied || typeof logicDocument?.Cl?.DT !== "function") return false;
        const canGroupHistory =
          typeof AscDFH !== "undefined" &&
          typeof AscDFH.FPg !== "undefined" &&
          typeof logicDocument.Cd === "function" &&
          typeof logicDocument.td === "function";
        if (canGroupHistory) logicDocument.Cd(AscDFH.FPg);
        logicDocument.Cl.DT(copied);
        logicDocument.Kc?.();
        logicDocument.sj?.();
        logicDocument.rq?.();
        if (canGroupHistory) logicDocument.td();
        return true;
      },
      false,
      true,
      function (pasted) {
        if (!pasted) showMessage("尚未複製格式；請先選取來源文字並按 Ctrl+Alt+C／⌘⌥C。");
        focusEditor();
      },
    );
  }

  function applyLineSpacing(multiplier) {
    window.Asc.scope.wordLineSpacing = Math.round(Number(multiplier) * 240);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        paragraphs.forEach(function (paragraph) {
          paragraph.SetSpacingLine(Asc.scope.wordLineSpacing, "auto");
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function toggleVerticalAlignment(alignment) {
    window.Asc.scope.wordVerticalAlignment = alignment;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (!range || !range.GetText()) {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        const current = range.GetTextPr()?.GetVertAlign?.() || "baseline";
        range.SetVertAlign(
          current === Asc.scope.wordVerticalAlignment
            ? "baseline"
            : Asc.scope.wordVerticalAlignment,
        );
        return true;
      },
      false,
      true,
      focusEditor,
    );
  }

  function adjustHangingIndent(direction) {
    window.Asc.scope.wordHangingIndentDirection = Number(direction);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        paragraphs.forEach(function (paragraph) {
          const left = Number(paragraph.GetIndLeft?.() || 0);
          const first = Number(paragraph.GetIndFirstLine?.() || 0);
          if (Asc.scope.wordHangingIndentDirection > 0) {
            paragraph.SetIndLeft(left + 720);
            paragraph.SetIndFirstLine(first > -720 ? -720 : first);
          } else {
            const nextLeft = Math.max(0, left - 720);
            paragraph.SetIndLeft(nextLeft);
            paragraph.SetIndFirstLine(nextLeft === 0 ? 0 : Math.min(first, -720));
          }
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function applyParagraphStyle(styleName) {
    window.Asc.scope.wordParagraphStyle = styleName;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const style = document.GetStyle(Asc.scope.wordParagraphStyle);
        const range = document.GetRangeBySelect();
        let paragraphs = range?.GetAllParagraphs?.() || [];
        if (!paragraphs.length) {
          const current = document.GetCurrentParagraph?.();
          paragraphs = current ? [current] : [];
        }
        if (!style) return 0;
        paragraphs.forEach(function (paragraph) {
          paragraph.SetStyle(style);
        });
        return paragraphs.length;
      },
      false,
      true,
      focusEditor,
    );
  }

  function toggleTrackRevisions() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const enabled = !document.IsTrackRevisions();
        document.SetTrackRevisions(enabled);
        return enabled;
      },
      false,
      true,
      function (enabled) {
        showMessage(enabled ? "已開啟追蹤修訂。" : "已關閉追蹤修訂。");
        focusEditor();
      },
    );
  }

  function addNativeComment(hostWindow) {
    try {
      const controller = hostWindow?.DE?.getController?.("DocumentHolder");
      if (controller?.addComment) {
        controller.addComment();
        return true;
      }
    } catch (_) {
      // Fall through to the documented plugin method.
    }
    showMessage("目前編輯器無法開啟原生註解輸入框；請使用「校閱 → 新增註解」。");
    return false;
  }

  function renumberHeadingsInDocument() {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const paragraphs = document.GetAllParagraphs();
        const counters = [0, 0, 0, 0, 0];
        const financialDigits = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];
        const commonDigits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
        function chineseNumber(value, financial) {
          const digits = financial ? financialDigits : commonDigits;
          if (value < 10) return digits[value];
          if (value < 20) return `${financial ? "拾" : "十"}${value % 10 ? digits[value % 10] : ""}`;
          if (value < 100) {
            const tens = `${digits[Math.floor(value / 10)]}${financial ? "拾" : "十"}`;
            return `${tens}${value % 10 ? digits[value % 10] : ""}`;
          }
          return String(value);
        }
        function headingMatch(text) {
          const patterns = [
            [1, /^\s*([壹貳參肆伍陸柒捌玖拾佰]+)、/],
            [1, /^\s*[〔【\[]([壹貳參肆伍陸柒捌玖拾佰]+)、[〕】\]]/],
            [2, /^\s*([一二三四五六七八九十百]+)、/],
            [2, /^\s*[〔【\[]([一二三四五六七八九十百]+)、[〕】\]]/],
            [3, /^\s*[（(]([一二三四五六七八九十百]+)[）)]/],
            [3, /^\s*[〔【\[]([一二三四五六七八九十百]+)[〕】\]]/],
            [4, /^\s*(\d+)[.．、]/],
          ];
          for (let index = 0; index < patterns.length; index += 1) {
            const match = String(text || "").match(patterns[index][1]);
            if (match) return { level: patterns[index][0], match: match };
          }
          return null;
        }
        let changed = 0;
        const preview = [];
        paragraphs.forEach(function (paragraph) {
          const text = paragraph.GetText({ Numbering: false, ParaSeparator: "" });
          const heading = headingMatch(text);
          if (!heading) return;
          counters[heading.level] += 1;
          for (let level = heading.level + 1; level <= 4; level += 1) counters[level] = 0;
          const next =
            heading.level === 1
              ? chineseNumber(counters[heading.level], true)
              : heading.level < 4
                ? chineseNumber(counters[heading.level], false)
                : String(counters[heading.level]);
          const oldPrefix = heading.match[0];
          const newPrefix = oldPrefix.replace(heading.match[1], next);
          const prefixRange = paragraph.GetRange(0, oldPrefix.length);
          if (!prefixRange) return;
          prefixRange.Delete();
          const insertion = paragraph.GetRange(0, 0);
          if (!insertion || !insertion.AddText(newPrefix, "before")) return;
          const style = document.GetStyle(`Heading ${heading.level}`);
          if (style) paragraph.SetStyle(style);
          if (preview.length < 4) preview.push(`${oldPrefix.trim()} → ${newPrefix.trim()}`);
          changed += 1;
        });
        return { changed: changed, preview: preview };
      },
      false,
      true,
      function (result) {
        if (!result?.changed) {
          showMessage("沒有在段落開頭找到「壹、」、「一、」、「（一）」或「1.」等標題；內文中的相同文字不會處理。");
        } else {
          showMessage(
            `已在目前文件安全重編 ${result.changed} 個標題並套用標題樣式。\n${result.preview.join("\n")}\n可按 Ctrl／⌘+Z 一次復原。`,
          );
        }
        focusEditor();
      },
    );
  }

  function installWordCompatibilityShortcuts(hostWindow) {
    try {
      if (!hostWindow?.document) return false;
      const stateKey = "__OpenDeskTwWordShortcuts";
      const previous = hostWindow[stateKey];
      if (previous?.handler) {
        hostWindow.document.removeEventListener("keydown", previous.handler, true);
      }
      const handler = function (event) {
        if (!event || event.repeat || event.isComposing || event.defaultPrevented) return;
        const target = event.target;
        if (
          target &&
          (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || "") || target.isContentEditable)
        ) return;
        const key = String(event.key || "").toLowerCase();
        const command = event.ctrlKey || event.metaKey;
        let action = null;
        if (command && event.shiftKey && !event.altKey && (key === "j" || event.code === "KeyJ")) {
          action = applyDistributedAlignment;
        } else if (command && event.shiftKey && event.altKey && (key === "r" || event.code === "KeyR")) {
          action = renumberHeadingsInDocument;
        } else if (command && event.altKey && !event.shiftKey && key === "c") {
          action = copyFormatting;
        } else if (command && event.altKey && !event.shiftKey && key === "v") {
          action = pasteFormatting;
        } else if (command && !event.shiftKey && !event.altKey && ["1", "2", "5"].includes(key)) {
          action = function () {
            applyLineSpacing(key === "5" ? 1.5 : Number(key));
          };
        } else if (command && event.altKey && !event.shiftKey && ["1", "2", "3"].includes(key)) {
          action = function () {
            applyParagraphStyle(`Heading ${key}`);
          };
        } else if (command && event.shiftKey && !event.altKey && key === "n") {
          action = function () {
            applyParagraphStyle("Normal");
          };
        } else if (command && !event.shiftKey && key === "q" && (!event.metaKey || event.altKey)) {
          action = function () {
            applyParagraphStyle("Normal");
          };
        } else if (command && event.shiftKey && !event.altKey && key === "e") {
          action = toggleTrackRevisions;
        } else if (
          command &&
          event.shiftKey &&
          !event.altKey &&
          (key === "+" || event.code === "Equal")
        ) {
          action = function () {
            toggleVerticalAlignment("superscript");
          };
        } else if (
          command &&
          event.shiftKey &&
          !event.altKey &&
          (key === "_" || event.code === "Minus")
        ) {
          action = function () {
            toggleVerticalAlignment("subscript");
          };
        } else if (command && !event.altKey && key === "t") {
          action = function () {
            adjustHangingIndent(event.shiftKey ? -1 : 1);
          };
        } else if (
          (event.ctrlKey && event.altKey && !event.shiftKey && key === "m") ||
          (event.metaKey && event.altKey && !event.shiftKey && key === "a")
        ) {
          action = function () {
            addNativeComment(hostWindow);
          };
        }
        if (!action) return;
        event.preventDefault();
        event.stopPropagation();
        action();
      };
      hostWindow.document.addEventListener("keydown", handler, true);
      hostWindow[stateKey] = { guid: plugin.guid, handler };
      return true;
    } catch (_) {
      return false;
    }
  }

  function applyNumericFontSize(size) {
    window.Asc.scope.numericFontSize = Number(size);
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (!range || range.GetText() === "") {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        range.SetFontSize(Asc.scope.numericFontSize);
        return true;
      },
      false,
      true,
      focusEditor,
    );
  }

  function applyTaiwanFont(font) {
    window.Asc.scope.taiwanFontName = font.name;
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (!range || range.GetText() === "") {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        range.SetFontFamily(Asc.scope.taiwanFontName);
        return true;
      },
      false,
      true,
      function (applied) {
        if (!applied) showMessage("請先選取文字，或把游標放在要變更字型的文字內。");
        focusEditor();
      },
    );
  }

  function completePairedPunctuation() {
    transformSelectionOrSentence(
      window.OpenDeskTwTypography.completePairs,
      "這段文字的括號與引號已經成對，不需要補齊。",
    );
  }

  function normalizeTaiwanPunctuation() {
    transformSelectionOrSentence(
      window.OpenDeskTwTypography.normalizeTaiwanPunctuation,
      "這段文字已符合台灣常用標點，不需要調整。",
    );
  }

  function showShortcuts() {
    showMessage(
      [
        "格式複製：Windows／Linux Ctrl+Alt+C；macOS ⌘⌥C",
        "套用格式：Windows／Linux Ctrl+Alt+V；macOS ⌘⌥V",
        "只貼文字：Ctrl／⌘+Shift+V",
        "清除格式：Ctrl+Space；macOS ⌘+Fn+Space",
        "字級顯示：一律使用 9、10.5、12 等數字，不混用初號、五號等名稱",
        "粗體／斜體／底線：Ctrl／⌘+B、I、U",
        "靠左／置中／左右對齊：Ctrl／⌘+L、E、J",
        "分散對齊：Windows／Linux Ctrl+Shift+J；macOS ⇧⌘J",
        "行距：Ctrl／⌘+1 單行、+2 雙行、+5 1.5 倍",
        "標題樣式：Ctrl+Alt+1／2／3；macOS ⌘⌥1／2／3",
        "一般樣式：Ctrl／⌘+Shift+N；追蹤修訂：Ctrl／⌘+Shift+E",
        "新增註解：Windows Ctrl+Alt+M；macOS ⌘⌥A",
        "更多內容請在全能文件工作台開啟「快捷鍵總覽」。",
      ].join("\n"),
    );
  }

  function addTraditionalChineseToolbar() {
    plugin.executeMethod("AddToolbarMenuItem", [
      {
        guid: plugin.guid,
        tabs: [
          {
            id: "home",
            text: "常用",
            items: [
              {
                id: "opendesk-distributed",
                type: "button",
                text: "分散對齊",
                hint: "分散對齊（Ctrl+Shift+J／⇧⌘J）",
                lockInViewMode: true,
                icons: "resources/distributed.svg",
              },
              {
                id: "opendesk-taiwan-fonts",
                type: "button",
                text: "臺灣字型",
                hint: "快速套用新細明體、標楷體、思源字型與蘋方繁體",
                lockInViewMode: true,
                split: false,
                icons: "resources/font-size.svg",
                items: taiwanFonts.map(function (font) {
                  return {
                    id: `opendesk-font-${font.id}`,
                    text: font.label,
                    data: font.name,
                  };
                }),
              },
              {
                id: "opendesk-complete-pairs",
                type: "button",
                text: "智慧補齊",
                hint: "依巢狀順序補上）、」、】、〕等正確結尾",
                lockInViewMode: true,
                icons: "resources/pairs.svg",
              },
              {
                id: "opendesk-renumber-headings",
                type: "button",
                text: "標題重編",
                hint: "只重編段落開頭的中文標題；內文不處理，Ctrl／⌘+Z 可復原",
                lockInViewMode: true,
                icons: "resources/shortcuts.svg",
              },
              {
                id: "opendesk-home-magi-summary",
                type: "button",
                text: "MAGI 摘要",
                hint: "不離開常用頁籤，直接摘要選取文字或整份文件",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
            ],
          },
          {
            id: "opendesk-tw-tab",
            text: "全能文件",
            items: [
              {
                id: "opendesk-normalize-punctuation",
                type: "button",
                text: "台灣標點",
                hint: "整理選取文字或目前句子的引號與中文標點",
                lockInViewMode: true,
                icons: "resources/punctuation.svg",
              },
              {
                id: "opendesk-font-size",
                type: "button",
                text: "數字字級",
                hint: "字級一律顯示為數字；可直接套用常用字級",
                lockInViewMode: true,
                split: false,
                icons: "resources/font-size.svg",
                items: numericFontSizes.map(function (size) {
                  return {
                    id: `opendesk-font-size-${String(size).replace(".", "-")}`,
                    text: String(size),
                    data: String(size),
                  };
                }),
              },
              {
                id: "opendesk-shortcuts",
                type: "button",
                text: "快捷鍵",
                hint: "顯示格式複製與常用文字快捷鍵",
                lockInViewMode: false,
                icons: "resources/shortcuts.svg",
              },
            ],
          },
          {
            id: "opendesk-magi-tab",
            text: "MAGI",
            items: [
              {
                id: "opendesk-magi-summary",
                type: "button",
                text: "文件摘要",
                hint: "以本機 MAGI 摘要選取文字；未選取時分析整份文件",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-review",
                type: "button",
                text: "校對檢查",
                hint: "找出語句、數字、日期、邏輯與前後矛盾",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-structure",
                type: "button",
                text: "結構分析",
                hint: "檢查標題層級、段落順序與可讀性",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
              {
                id: "opendesk-magi-risk",
                type: "button",
                text: "完整檢查",
                hint: "分析內容、結構、風險與可執行改善建議",
                lockInViewMode: false,
                icons: "resources/opendesk.svg",
              },
            ],
          },
        ],
      },
    ]);
  }

  plugin.init = function () {
    window.OpenDeskTwUiPatch?.install?.(window.parent);
    if (plugin.info.editorType !== "word") return;
    installWordCompatibilityShortcuts(window.parent);
    if (!toolbarEventsBound) {
      this.attachToolbarMenuClickEvent("opendesk-distributed", applyDistributedAlignment);
      this.attachToolbarMenuClickEvent("opendesk-complete-pairs", completePairedPunctuation);
      this.attachToolbarMenuClickEvent("opendesk-renumber-headings", renumberHeadingsInDocument);
      this.attachToolbarMenuClickEvent("opendesk-home-magi-summary", function () {
        runMagiAnalysis("summary", "MAGI 文件摘要");
      });
      this.attachToolbarMenuClickEvent(
        "opendesk-normalize-punctuation",
        normalizeTaiwanPunctuation,
      );
      this.attachToolbarMenuClickEvent("opendesk-shortcuts", showShortcuts);
      this.attachToolbarMenuClickEvent("opendesk-magi-summary", function () {
        runMagiAnalysis("summary", "MAGI 文件摘要");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-review", function () {
        runMagiAnalysis("review", "MAGI 校對檢查");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-structure", function () {
        runMagiAnalysis("structure", "MAGI 結構分析");
      });
      this.attachToolbarMenuClickEvent("opendesk-magi-risk", function () {
        runMagiAnalysis("risk", "MAGI 完整檢查");
      });
      for (const size of numericFontSizes) {
        this.attachToolbarMenuClickEvent(
          `opendesk-font-size-${String(size).replace(".", "-")}`,
          function () {
            applyNumericFontSize(size);
          },
        );
      }
      for (const font of taiwanFonts) {
        this.attachToolbarMenuClickEvent(`opendesk-font-${font.id}`, function () {
          applyTaiwanFont(font);
        });
      }
      toolbarEventsBound = true;
    }
    addTraditionalChineseToolbar();
  };

  plugin.button = function (_id, windowId) {
    if (magiResultWindow && magiResultWindow.id === windowId) {
      magiResultWindow.close();
      magiResultWindow = null;
    }
  };
})(window);
