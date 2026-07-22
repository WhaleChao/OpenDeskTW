(function (window) {
  "use strict";

  const plugin = window.Asc.plugin;
  let toolbarEventsBound = false;
  const numericFontSizes = [9, 10, 10.5, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];
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
        if (
          typeof Asc === "undefined" ||
          !Asc.editor ||
          typeof Asc.editor.put_PrAlign !== "function" ||
          typeof AscCommon === "undefined" ||
          typeof AscCommon.align_Distributed === "undefined"
        ) {
          return false;
        }
        Asc.editor.put_PrAlign(AscCommon.align_Distributed);
        return true;
      },
      false,
      true,
      focusEditor,
    );
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
        "更多內容請在 OpenDesk TW 開啟「快捷鍵總覽」。",
      ].join("\n"),
    );
  }

  function addTraditionalChineseToolbar() {
    plugin.executeMethod("AddToolbarMenuItem", [
      {
        guid: plugin.guid,
        tabs: [
          {
            id: "opendesk-tw-tab",
            text: "OpenDesk TW",
            items: [
              {
                id: "opendesk-distributed",
                type: "button",
                text: "分散對齊",
                hint: "將選取段落套用分散對齊",
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
        ],
      },
    ]);
  }

  plugin.init = function () {
    window.OpenDeskTwUiPatch?.install?.(window.parent);
    if (plugin.info.editorType !== "word") return;
    if (!toolbarEventsBound) {
      this.attachToolbarMenuClickEvent("opendesk-distributed", applyDistributedAlignment);
      this.attachToolbarMenuClickEvent("opendesk-complete-pairs", completePairedPunctuation);
      this.attachToolbarMenuClickEvent(
        "opendesk-normalize-punctuation",
        normalizeTaiwanPunctuation,
      );
      this.attachToolbarMenuClickEvent("opendesk-shortcuts", showShortcuts);
      for (const size of numericFontSizes) {
        this.attachToolbarMenuClickEvent(
          `opendesk-font-size-${String(size).replace(".", "-")}`,
          function () {
            applyNumericFontSize(size);
          },
        );
      }
      toolbarEventsBound = true;
    }
    addTraditionalChineseToolbar();
  };

  plugin.button = function () {};
})(window);
