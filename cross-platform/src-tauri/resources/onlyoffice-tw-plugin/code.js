(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  let toolbarEventsBound = false;
  let magiResultWindow = null;
  let magiResultPayload = null;
  const numericFontSizes = [9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
  const traditionalFonts = [
    { id: "pmingliu", name: "PMingLiU", text: "新細明體（PMingLiU）" },
    { id: "mingliu", name: "MingLiU", text: "細明體（MingLiU）" },
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

  function reloadMagiBridgeConfig() {
    return new Promise(function (resolve) {
      if (!window.document?.head || !window.document.createElement) {
        resolve(window.OpenDeskMagiBridge);
        return;
      }
      const script = window.document.createElement("script");
      let settled = false;
      const finish = function () {
        if (settled) return;
        settled = true;
        script.remove?.();
        resolve(window.OpenDeskMagiBridge);
      };
      script.src = `magi-bridge-config.js?${Date.now()}`;
      script.onload = finish;
      script.onerror = finish;
      window.document.head.appendChild(script);
      window.setTimeout(finish, 1500);
    });
  }

  function magiBridgeConnectionMessage(status) {
    if (status === 401) {
      return "MAGI 橋接權杖已過期。請保持「全能文件工作台」開啟，完全關閉 ONLYOFFICE 後再重新開啟。";
    }
    if (status === 403) {
      return "目前 ONLYOFFICE 來源未獲 MAGI 橋接允許，請更新至最新版全能文件工作台後重試。";
    }
    return "無法連線到本機 MAGI 橋接。請先開啟或重新啟動「全能文件工作台」，保持工作台開啟，再按一次分析。";
  }

  async function verifyMagiBridge(bridge) {
    const healthUrl =
      bridge.healthUrl || String(bridge.url || "").replace(/\/v1\/analyze$/, "/v1/health");
    if (!healthUrl) return { ok: false, message: magiBridgeConnectionMessage() };
    const controller = new AbortController();
    const timeout = window.setTimeout(function () {
      controller.abort();
    }, 4000);
    try {
      const response = await window.fetch(healthUrl, {
        method: "GET",
        headers: { Authorization: `Bearer ${bridge.token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const result = await response.json().catch(function () {
        return {};
      });
      if (!response.ok || !result.ok) {
        return {
          ok: false,
          message: result.error || magiBridgeConnectionMessage(response.status),
        };
      }
      return { ok: true };
    } catch (_) {
      return { ok: false, message: magiBridgeConnectionMessage() };
    } finally {
      window.clearTimeout(timeout);
    }
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
      const bridge = await reloadMagiBridgeConfig();
      if (!bridge?.url || !bridge?.token) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: "請先開啟「全能文件工作台」，再重新執行 MAGI 文件分析。",
        });
        return;
      }
      const bridgeStatus = await verifyMagiBridge(bridge);
      if (!bridgeStatus.ok) {
        updateMagiWindow({
          state: "error",
          title: label,
          text: bridgeStatus.message,
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
              : error?.name === "TypeError" ||
                  /failed to fetch|networkerror|load failed/i.test(String(error?.message || error))
                ? magiBridgeConnectionMessage()
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
        try {
          const document = Api.GetDocument();
          const selection = document.GetRangeBySelect();
          let paragraphs = selection?.GetAllParagraphs?.() || [];
          if (!paragraphs.length) {
            const current = document.GetCurrentParagraph?.();
            paragraphs = current ? [current] : [];
          }
          if (!paragraphs.length) return { applied: 0 };

          const nativeDistributed =
            typeof AscCommon !== "undefined" &&
            Number.isFinite(AscCommon.align_Distributed)
              ? AscCommon.align_Distributed
              : 4;
          const nativeParagraphs = paragraphs.filter(function (paragraph) {
            return paragraph.Paragraph && typeof paragraph.Paragraph.Vt === "function";
          });
          if (nativeParagraphs.length === paragraphs.length) {
            nativeParagraphs.forEach(function (paragraph) {
              paragraph.Paragraph.Vt(nativeDistributed);
            });
            return {
              applied: paragraphs.length,
              method: "paragraph.Vt",
              value: nativeDistributed,
            };
          }
          if (
            typeof Asc !== "undefined" &&
            Asc.editor &&
            typeof Asc.editor.put_PrAlign === "function"
          ) {
            Asc.editor.put_PrAlign(nativeDistributed);
            return {
              applied: paragraphs.length,
              method: "put_PrAlign",
              value: nativeDistributed,
            };
          }
          const logicDocument = document.Document;
          if (logicDocument && typeof logicDocument.Vt === "function") {
            logicDocument.Vt(nativeDistributed, { rej: true });
            return {
              applied: paragraphs.length,
              method: "logicDocument",
              value: nativeDistributed,
            };
          }
          return {
            applied: 0,
            error: "這個編輯器版本沒有提供原生分散對齊介面。",
          };
        } catch (error) {
          return {
            applied: 0,
            error: `${error?.name || "Error"}: ${error?.message || error}`,
          };
        }
      },
      false,
      true,
      function (result) {
        if (result?.error) {
          showMessage(`分散對齊發生錯誤：${result.error}`);
        } else if (!result?.applied) {
          showMessage("目前沒有可分散對齊的段落。");
        }
        focusEditor();
      },
    );
  }

  function applyTraditionalFont(fontName) {
    window.Asc.scope.traditionalFontName = String(fontName);
    plugin.callCommand(
      function () {
        const name = Asc.scope.traditionalFontName;
        if (!name) return false;
        const document = Api.GetDocument();
        let range = document.GetRangeBySelect();
        if (range?.GetText?.()) {
          range.SetFontFamily(name);
          return name;
        }
        if (
          typeof Asc !== "undefined" &&
          Asc.editor &&
          typeof Asc.editor.put_TextPrFontName === "function"
        ) {
          Asc.editor.put_TextPrFontName(name);
          return name;
        }
        range = document.GetRangeBySelect();
        if (!range || !range.GetText()) {
          document.SelectCurrentWord();
          range = document.GetRangeBySelect();
        }
        if (!range) return false;
        range.SetFontFamily(name);
        return name;
      },
      false,
      true,
      function (applied) {
        if (!applied) {
          showMessage("目前游標位置無法套用字型。");
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

  function insertContextualQuote(input) {
    plugin.callCommand(
      function () {
        const document = Api.GetDocument();
        const paragraph = document.GetCurrentParagraph?.();
        const internal = paragraph?.Paragraph;
        const caretPosition = internal?.Get_ParaContentPos?.(false, false);
        if (!paragraph || !internal || !caretPosition) return "";

        const targetRun = internal.GetClassByPos?.(caretPosition);
        const depth = caretPosition.GetDepth?.();
        const runPosition =
          typeof depth === "number" ? caretPosition.Get(depth) : undefined;
        if (!targetRun || !internal.CheckRunContent || !Number.isFinite(runPosition)) {
          return "";
        }

        let offset = 0;
        let first = true;
        let caretOffset = null;
        internal.CheckRunContent(function (run) {
          if (caretOffset !== null) return;
          if (!first) offset += 1;
          first = false;
          if (run === targetRun) {
            caretOffset = offset + runPosition;
            return;
          }
          offset += run.Content?.length || 0;
        });
        if (!Number.isFinite(caretOffset) || caretOffset <= 0) return "";
        return paragraph.GetRange(0, caretOffset)?.GetText?.() || "";
      },
      false,
      false,
      function (paragraphTextBefore) {
        if (paragraphTextBefore) {
          insertContextualQuoteFromText(paragraphTextBefore, input);
          return;
        }
        plugin.executeMethod("GetCurrentSentence", ["before"], function (sentenceTextBefore) {
          insertContextualQuoteFromText(sentenceTextBefore, input);
        });
      },
    );
  }

  function insertContextualQuoteFromText(textBefore, input) {
    const replacement = window.OpenDeskTwTypography.smartQuoteForContext(
      textBefore || "",
      input,
    );
    plugin.executeMethod("InputText", [replacement || input], focusEditor);
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
        const rawKey = String(event.key || "");
        const key = rawKey.toLowerCase();
        const command = event.ctrlKey || event.metaKey;
        let action = null;
        if (
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          ['"', "'", "”", "’", "」", "』"].includes(rawKey)
        ) {
          action = function () {
            insertContextualQuote(rawKey);
          };
        } else if (command && event.shiftKey && !event.altKey && (key === "j" || event.code === "KeyJ")) {
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
      hostWindow[stateKey] = {
        guid: plugin.guid,
        handler: handler,
        applyDistributedAlignment: applyDistributedAlignment,
        applyTraditionalFont: applyTraditionalFont,
        insertContextualQuote: insertContextualQuote,
      };
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
        "智慧下引號：輸入引號時，會依目前尚未閉合的「／『自動選擇」或』",
        "台灣字型：全能文件 → 台灣字型，可直接選新細明體或細明體",
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
                id: "opendesk-font-family",
                type: "button",
                text: "台灣字型",
                hint: "直接套用新細明體（PMingLiU）或細明體（MingLiU）",
                lockInViewMode: true,
                split: false,
                icons: "resources/font-size.svg",
                items: traditionalFonts.map(function (font) {
                  return {
                    id: `opendesk-font-family-${font.id}`,
                    text: font.text,
                    data: font.name,
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
      for (const font of traditionalFonts) {
        this.attachToolbarMenuClickEvent(`opendesk-font-family-${font.id}`, function () {
          applyTraditionalFont(font.name);
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
