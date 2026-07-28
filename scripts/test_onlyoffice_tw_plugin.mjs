import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

await import("../cross-platform/src-tauri/resources/onlyoffice-tw-plugin/ui-overrides.js");
await import("../cross-platform/src-tauri/resources/onlyoffice-tw-plugin/ui-patch.js");
await import("../cross-platform/src-tauri/resources/onlyoffice-tw-plugin/typography.js");

const tools = globalThis.OpenDeskTwTypography;
const uiPatch = globalThis.OpenDeskTwUiPatch;
assert.ok(tools, "應載入繁中標點工具");
assert.ok(uiPatch, "應載入繁中介面熱修");
assert.equal(tools.completePairs("公文（附件【第一項"), "公文（附件【第一項】）");
assert.equal(tools.completePairs("公告「附件〔壹、"), "公告「附件〔壹、〕」");
assert.equal(tools.completePairs("法規《總則〈目的"), "法規《總則〈目的〉》");
assert.equal(tools.completePairs("公告「附件【第一項」"), "公告「附件【第一項】」");
assert.equal(tools.completePairs("說明（詳見〔附件一）"), "說明（詳見〔附件一〕）");
assert.equal(tools.completePairs("文字「已完成」"), "文字「已完成」");
assert.equal(tools.completePairs("〔壹、〕標題"), "〔壹、〕標題");
assert.equal(tools.normalizeTaiwanPunctuation('他說"測試"'), "他說「測試」");
assert.equal(tools.normalizeTaiwanPunctuation("他說：“可以!”"), "他說：「可以！」");
assert.equal(tools.normalizeTaiwanPunctuation("是否正確?"), "是否正確？");
assert.equal(tools.normalizeTaiwanPunctuation("版本2.2.1"), "版本2.2.1");
assert.equal(tools.normalizeTaiwanPunctuation("don't change"), "don't change");
assert.equal(
  tools.normalizeTaiwanPunctuation('他說："外層\'內層\'"'),
  "他說：「外層『內層』」",
);
assert.deepEqual(tools.quoteStack("他說「外層『內層"), ["」", "』"]);
assert.equal(tools.smartQuoteForContext("他說「外層『內層", '"'), "』");
assert.equal(tools.smartQuoteForContext("他說「外層『內層』", '"'), "」");
assert.equal(tools.smartQuoteForContext("他說：「你好。", '"'), "」");
assert.equal(tools.smartQuoteForContext("don", "'"), "'");
assert.equal(tools.distributionGlyphCount("甲乙丙丁"), 4);
assert.equal(tools.calculateDistributedSpacing(100, 20, 5), 20);
assert.equal(uiPatch.translateText("Multipage view"), "多頁檢視");
assert.equal(
  uiPatch.translateText("Work with multiple pages at once for easier navigation."),
  "同時檢視多個頁面，讓導覽更方便。",
);
assert.equal(uiPatch.translateText("五號"), "10.5");
assert.equal(uiPatch.translateText(" 小四 "), " 12 ");
assert.equal(uiPatch.translateText("單擊鏈接以保存文檔"), "按一下連結以儲存文件");
assert.equal(uiPatch.translateText("工作簿的單元格數據"), "活頁簿的儲存格資料");
assert.equal(uiPatch.translateText("打印演示文稿"), "列印簡報");
assert.equal(uiPatch.translateText("聊天机器人"), "聊天機器人");
assert.equal(uiPatch.translateText("AI 模型列表與密钥配置"), "AI 模型清單與金鑰設定");
assert.equal(uiPatch.translateText("翻译"), "翻譯");
assert.equal(uiPatch.translateText("拼写与语法检查"), "拼字與文法檢查");
assert.equal(uiPatch.translateText("创建 AI 助手"), "建立 AI 助理");
assert.ok(
  Object.keys(globalThis.OpenDeskTwUiOverrides.translations).length > 10000,
  "應隨附完整繁中介面覆寫字典",
);

const pluginCode = await readFile(
  new URL("../cross-platform/src-tauri/resources/onlyoffice-tw-plugin/code.js", import.meta.url),
  "utf8",
);
assert.match(pluginCode, /id: "home"/);
assert.match(pluginCode, /id: "opendesk-distributed"/);
assert.match(pluginCode, /installWordCompatibilityShortcuts\(window\.parent\)/);
assert.match(pluginCode, /event\.code === "KeyJ"/);
assert.match(pluginCode, /AscCommon\.align_Distributed/);
assert.match(pluginCode, /OpenDeskTW\.DistributedParagraphs/);
assert.match(pluginCode, /restoreDistributedAlignment\(\)/);
assert.match(pluginCode, /method: "word-paragraph-width"/);
assert.match(pluginCode, /Get_StartRangePos2/);
assert.match(pluginCode, /availableWidth - occupiedWidth/);
assert.match(pluginCode, /layoutSafetyMm/);
assert.match(pluginCode, /Math\.floor\(\(spacingMm \* 1440\) \/ 25\.4\)/);
assert.match(pluginCode, /wrapCorrections/);
assert.match(pluginCode, /SetSpacing\(job\.spacing\)/);
assert.match(pluginCode, /marker\.dynamicSpacings/);
assert.match(pluginCode, /installDistributedLayoutRefresh\(window\.parent\)/);
assert.match(pluginCode, /AscCommon\?\.Ne\?\.Ug\?\.\(internalId\)/);
assert.match(pluginCode, /Object\.values\(paragraph\)\.find/);
assert.ok(
  pluginCode.indexOf("availableWidth - occupiedWidth") <
    pluginCode.indexOf('method: "word-paragraph-width"'),
  "文字等距分布必須先按實際可用寬度計算，而不是只寫固定對齊值",
);
assert.match(pluginCode, /id: "opendesk-font-family"/);
assert.match(pluginCode, /PMingLiU/);
assert.match(pluginCode, /MingLiU/);
assert.match(pluginCode, /put_TextPrFontName/);
assert.match(pluginCode, /Get_ParaContentPos/);
assert.match(pluginCode, /GetCurrentSentence", \["before"\]/);
assert.match(pluginCode, /executeMethod\("InputText"/);
assert.match(pluginCode, /applyLineSpacing\(key === "5" \? 1\.5 : Number\(key\)\)/);
assert.match(pluginCode, /applyParagraphStyle\(`Heading \$\{key\}`\)/);
assert.match(pluginCode, /logicDocument\.Dne\(\)/);
assert.match(pluginCode, /logicDocument\.Cl\.DT\(copied\)/);
assert.match(pluginCode, /toggleTrackRevisions/);
assert.match(pluginCode, /id: "opendesk-renumber-headings"/);
assert.match(pluginCode, /id: "opendesk-home-magi-summary"/);
assert.match(pluginCode, /id: "opendesk-magi-tab"/);
assert.match(pluginCode, /runMagiAnalysis\("summary"/);
assert.match(pluginCode, /reloadMagiBridgeConfig/);
assert.match(pluginCode, /verifyMagiBridge/);
assert.match(pluginCode, /healthUrl/);
assert.match(pluginCode, /無法連線到本機 MAGI 橋接/);
assert.match(pluginCode, /Authorization: `Bearer \$\{bridge\.token\}`/);
assert.ok(
  pluginCode.indexOf('id: "opendesk-distributed"') <
    pluginCode.indexOf('id: "opendesk-tw-tab"'),
  "分散對齊不應繼續放在獨立的全能文件頁籤",
);

let keydownHandler;
let toolbarDefinition;
let distributedSpacing;
let internalDistributedValue;
let editorDistributedValue;
let paragraphAlignment;
let appliedFont;
let currentSentence = "";
let insertedText = "";
let lineSpacing;
let appliedStyle;
let tracked = false;
let nativeComments = 0;
let copiedFormatting = false;
let pastedFormatting = false;
let magiFetchMode = "success";
const magiFetches = [];
const magiPayloads = [];
const messages = [];
const toolbarHandlers = new Map();
const customProperties = new Map();
function makeParagraph(
  initialText,
  initialParaId = 0x1bcdef01,
  simulateQuantizationWrap = false,
) {
  let text = initialText;
  let paraId = initialParaId;
  const run = { Content: Array.from(initialText) };
  const layoutRange = { X: 0, XEnd: 100, W: 20 };
  function contentPosition(position) {
    return {
      GetDepth() {
        return 1;
      },
      Get(depth) {
        return depth === 0 ? 0 : position;
      },
    };
  }
  const paragraph = {
    Paragraph: {
      Lines: [{ Ranges: [layoutRange] }],
      Vt(value) {
        paragraphAlignment = value;
      },
      Get_ParaContentPos() {
        return contentPosition(Array.from(text).length);
      },
      Get_StartRangePos2() {
        return contentPosition(0);
      },
      Get_EndRangePos2() {
        return contentPosition(Array.from(text).length);
      },
      GetClassByPos() {
        return run;
      },
      CheckRunContent(callback) {
        callback(run);
      },
    },
    GetText() {
      return text;
    },
    SetTextForTest(value) {
      text = String(value);
      run.Content = Array.from(text);
    },
    GetParaId() {
      return paraId;
    },
    SetParaId(value) {
      if (
        typeof value !== "number" ||
        !Number.isInteger(value) ||
        value <= 0 ||
        value >= 0x80000000
      ) {
        throw new Error("ParaId must be a numerical");
      }
      paraId = value;
    },
    SetParaIdForTest(value) {
      paraId = value;
    },
    GetRange(start, end) {
      return {
        GetText() {
          return Array.from(text).slice(start, end).join("");
        },
        Delete() {
          text = text.slice(0, start) + text.slice(end);
          return true;
        },
        AddText(value, position) {
          if (position === "before") text = text.slice(0, start) + value + text.slice(start);
          else text = text.slice(0, end) + value + text.slice(end);
          return true;
        },
        SetSpacing(value) {
          distributedSpacing = value;
          layoutRange.W =
            value === 0 ? 20 : layoutRange.XEnd - layoutRange.X;
          if (simulateQuantizationWrap) {
            paragraph.Paragraph.Lines =
              value > 370
                ? [
                    { Ranges: [layoutRange] },
                    { Ranges: [{ X: 0, XEnd: 100, W: 10 }] },
                  ]
                : [{ Ranges: [layoutRange] }];
          }
          return true;
        },
      };
    },
    SetJc(value) {
      paragraphAlignment = value;
    },
    SetSpacing(value) {
      if (value === 0) layoutRange.W = 20;
    },
    SetStyle(style) {
      appliedStyle = style;
      this.style = style;
      return true;
    },
    SetSpacingLine(value, rule) {
      lineSpacing = [value, rule];
      return true;
    },
    GetIndLeft() {
      return 0;
    },
    GetIndFirstLine() {
      return 0;
    },
    SetIndLeft() {},
    SetIndFirstLine() {},
  };
  return paragraph;
}
const headingParagraphs = [
  makeParagraph("玖、第一章"),
  makeParagraph("本文提到壹、一、（一）等格式，但這不是標題。"),
  makeParagraph("九、第一節"),
  makeParagraph("（九）第一款"),
  makeParagraph("9. 第一目"),
];
const selectionParagraph = makeParagraph("選取段落");
let activeSelectionParagraph = selectionParagraph;
const selectionRange = {
  GetAllParagraphs() {
    return [activeSelectionParagraph];
  },
  GetText() {
    return "選取段落";
  },
  GetTextPr() {
    return { GetVertAlign: () => "baseline" };
  },
  SetVertAlign() {},
  SetFontFamily(value) {
    appliedFont = value;
  },
};
const apiDocument = {
  Document: {
    Vt(value) {
      internalDistributedValue = value;
      paragraphAlignment = value;
    },
    Dne() {
      copiedFormatting = true;
    },
    yb: {
      ocb() {
        return copiedFormatting ? { bold: true } : null;
      },
    },
    Cl: {
      DT(value) {
        pastedFormatting = value?.bold === true;
      },
    },
    Kc() {},
    sj() {},
    rq() {},
  },
  GetRangeBySelect() {
    return selectionRange;
  },
  GetCurrentParagraph() {
    return activeSelectionParagraph;
  },
  GetStyle(name) {
    return name;
  },
  GetAllParagraphs() {
    return headingParagraphs;
  },
  GetCustomProperties() {
    return {
      Get(name) {
        return customProperties.get(name) ?? null;
      },
      Add(name, value) {
        customProperties.set(name, value);
        return true;
      },
    };
  },
  IsTrackRevisions() {
    return tracked;
  },
  SetTrackRevisions(value) {
    tracked = value;
  },
  SelectCurrentWord() {},
  ForceRecalculate() {},
};
const hostDocument = {
  addEventListener(type, handler, capture) {
    if (type === "keydown" && capture === true) keydownHandler = handler;
  },
  removeEventListener() {},
};
const plugin = {
  guid: "asc.{TEST}",
  info: { editorType: "word" },
  executeMethod(name, args, callback) {
    if (name === "AddToolbarMenuItem") toolbarDefinition = args[0];
    if (name === "ShowError") messages.push(args[0]);
    if (name === "GetCurrentSentence") callback?.(currentSentence);
    else if (name === "InputText") {
      insertedText = args[0];
      callback?.();
    } else callback?.();
  },
  callCommand(command, _close, _recalculate, callback) {
    const result = command();
    callback?.(result);
  },
  attachToolbarMenuClickEvent(id, handler) {
    toolbarHandlers.set(id, handler);
  },
};
const asc = {
  plugin,
  scope: {},
  editor: {
    put_PrAlign(value) {
      editorDistributedValue = value;
      paragraphAlignment = value === 2 ? 4 : value;
    },
    put_TextPrFontName(value) {
      appliedFont = value;
    },
  },
  PluginWindow: class {
    constructor() {
      this.events = new Map();
      this.id = "magi-test-window";
    }
    attachEvent(name, handler) {
      this.events.set(name, handler);
    }
    show() {
      this.events.get("onMagiResultReady")?.();
    }
    command(name, payload) {
      if (name === "onMagiResult") magiPayloads.push(payload);
    }
    close() {}
  },
};
const pluginWindow = {
  Asc: asc,
  OpenDeskTwTypography: tools,
  OpenDeskMagiBridge: {
    url: "http://127.0.0.1:41827/v1/analyze",
    healthUrl: "http://127.0.0.1:41827/v1/health",
    token: "test-token",
  },
  document: {
    createElement() {
      return { remove() {} };
    },
    head: {
      appendChild(script) {
        script.onload?.();
      },
    },
  },
  setTimeout,
  clearTimeout,
  async fetch(url, options) {
    magiFetches.push({ url, options });
    if (magiFetchMode === "failure") throw new TypeError("Failed to fetch");
    if (String(url).endsWith("/v1/health")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true };
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          ok: true,
          reply: {
            text: "MAGI 測試完成",
            compatibility_version: "v3",
            model: "test-model",
            degraded: false,
          },
        };
      },
    };
  },
  parent: {
    Asc: asc,
    AscCommon: { align_Distributed: 4 },
    document: hostDocument,
    DE: {
      getController(name) {
        if (name !== "DocumentHolder") return null;
        return {
          addComment() {
            nativeComments += 1;
          },
        };
      },
    },
  },
};
runInNewContext(pluginCode, {
  window: pluginWindow,
  Asc: asc,
  AscCommon: { align_Distributed: 4 },
  AbortController,
  Api: {
    GetDocument() {
      return apiDocument;
    },
  },
});
plugin.init.call(plugin);

const homeTab = toolbarDefinition.tabs.find((tab) => tab.id === "home");
const customTab = toolbarDefinition.tabs.find((tab) => tab.id === "opendesk-tw-tab");
const magiTab = toolbarDefinition.tabs.find((tab) => tab.id === "opendesk-magi-tab");
assert.equal(homeTab.items[0].id, "opendesk-distributed");
assert.ok(!customTab.items.some((item) => item.id === "opendesk-distributed"));
assert.deepEqual(
  Array.from(homeTab.items, (item) => item.id),
  [
    "opendesk-distributed",
    "opendesk-complete-pairs",
    "opendesk-renumber-headings",
    "opendesk-home-magi-summary",
  ],
);
assert.ok(!customTab.items.some((item) => item.id === "opendesk-complete-pairs"));
assert.equal(
  Array.from(magiTab.items, (item) => item.text).join("、"),
  "文件摘要、校對檢查、結構分析、完整檢查",
);
assert.equal(typeof keydownHandler, "function");
let prevented = false;
keydownHandler({
  key: "J",
  code: "KeyJ",
  ctrlKey: true,
  metaKey: false,
  shiftKey: true,
  altKey: false,
  defaultPrevented: false,
  repeat: false,
  isComposing: false,
  preventDefault() {
    prevented = true;
  },
  stopPropagation() {},
});
assert.equal(paragraphAlignment, 4);
assert.equal(prevented, true);
assert.equal(distributedSpacing, 1504);
assert.equal(pluginWindow.__OpenDeskTwDistributedLayout.dynamic, true);
assert.equal(
  pluginWindow.__OpenDeskTwDistributedLayout.method,
  "word-paragraph-width",
);
assert.equal(pluginWindow.__OpenDeskTwDistributedLayout.appliedRanges, 1);
assert.deepEqual(
  JSON.parse(JSON.stringify(pluginWindow.__OpenDeskTwDistributedLayout.widths[0])),
  {
    available: 100,
    occupiedBefore: 20,
    glyphs: 4,
    spacing: 1504,
  },
);
paragraphAlignment = undefined;
keydownHandler({
  key: "j",
  code: "KeyJ",
  ctrlKey: false,
  metaKey: true,
  shiftKey: true,
  altKey: false,
  repeat: false,
  isComposing: false,
  preventDefault() {},
  stopPropagation() {},
});
assert.equal(paragraphAlignment, 4);
toolbarHandlers.get("opendesk-distributed")();
assert.equal(paragraphAlignment, 4);
selectionParagraph.SetTextForTest("");
selectionParagraph.SetParaIdForTest(0);
messages.length = 0;
toolbarHandlers.get("opendesk-distributed")();
assert.equal(
  typeof selectionParagraph.GetParaId(),
  "number",
  "全新空白文件的暫時段落 ID 必須以數字傳入 ONLYOFFICE",
);
assert.ok(selectionParagraph.GetParaId() > 0);
assert.ok(
  !messages.some((message) => message.includes("ParaId must be a numerical")),
  "空白未命名文件不得再出現 ParaId 類型錯誤",
);
selectionParagraph.SetTextForTest("選取段落");
const mixedWidthParagraph = makeParagraph(
  "中華民國114年7月25日",
  0x12345678,
  true,
);
activeSelectionParagraph = mixedWidthParagraph;
messages.length = 0;
toolbarHandlers.get("opendesk-distributed")();
assert.equal(
  mixedWidthParagraph.Paragraph.Lines.length,
  1,
  "twips／字型寬度量化造成最後一字換行時，必須自動縮回字距",
);
assert.ok(pluginWindow.__OpenDeskTwDistributedLayout.wrapCorrections >= 1);
assert.ok(
  !messages.some((message) => message.includes("發生錯誤")),
  "防止末字換行的重排不得產生警告",
);
activeSelectionParagraph = selectionParagraph;

function press(overrides) {
  let prevented = false;
  keydownHandler({
    key: "",
    code: "",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
    repeat: false,
    isComposing: false,
    preventDefault() {
      prevented = true;
    },
    stopPropagation() {},
    ...overrides,
  });
  return prevented;
}

assert.equal(press({ key: "5", code: "Digit5", ctrlKey: true }), true);
assert.deepEqual(lineSpacing, [360, "auto"]);
assert.equal(press({ key: "2", code: "Digit2", metaKey: true }), true);
assert.deepEqual(lineSpacing, [480, "auto"]);
assert.equal(press({ key: "1", code: "Digit1", ctrlKey: true, altKey: true }), true);
assert.equal(appliedStyle, "Heading 1");
assert.equal(press({ key: "n", code: "KeyN", ctrlKey: true, shiftKey: true }), true);
assert.equal(appliedStyle, "Normal");
assert.equal(press({ key: "e", code: "KeyE", ctrlKey: true, shiftKey: true }), true);
assert.equal(tracked, true);
assert.equal(press({ key: "m", code: "KeyM", ctrlKey: true, altKey: true }), true);
assert.equal(nativeComments, 1);
assert.equal(press({ key: "c", code: "KeyC", ctrlKey: true, altKey: true }), true);
assert.equal(copiedFormatting, true);
assert.equal(press({ key: "v", code: "KeyV", ctrlKey: true, altKey: true }), true);
assert.equal(pastedFormatting, true);
copiedFormatting = false;
pastedFormatting = false;
assert.equal(press({ key: "c", code: "KeyC", ctrlKey: true, shiftKey: true }), true);
assert.equal(copiedFormatting, true);
assert.equal(press({ key: "v", code: "KeyV", ctrlKey: true, shiftKey: true }), true);
assert.equal(pastedFormatting, true);
copiedFormatting = false;
pastedFormatting = false;
assert.equal(press({ key: "c", code: "KeyC", metaKey: true, altKey: true }), true);
assert.equal(copiedFormatting, true);
assert.equal(press({ key: "v", code: "KeyV", metaKey: true, altKey: true }), true);
assert.equal(pastedFormatting, true);
assert.equal(
  press({ key: "c", code: "KeyC", metaKey: true, shiftKey: true }),
  true,
  "macOS ⇧⌘C 必須複製格式",
);
assert.equal(
  press({
    key: "v",
    code: "KeyV",
    metaKey: true,
    shiftKey: true,
    defaultPrevented: true,
  }),
  true,
  "即使 ONLYOFFICE 先標記事件，macOS ⇧⌘V 仍必須套用格式",
);
assert.equal(pastedFormatting, true);

toolbarHandlers.get("opendesk-font-family-pmingliu")();
assert.equal(appliedFont, "PMingLiU");
toolbarHandlers.get("opendesk-font-family-mingliu")();
assert.equal(appliedFont, "MingLiU");

selectionParagraph.SetTextForTest("他說「外層『內層。");
insertedText = "";
assert.equal(press({ key: '"', code: "Quote", shiftKey: true }), true);
assert.equal(insertedText, "』");
selectionParagraph.SetTextForTest("他說「外層『內層。』");
assert.equal(press({ key: '"', code: "Quote", shiftKey: true }), true);
assert.equal(insertedText, "」");
selectionParagraph.SetTextForTest("don");
assert.equal(press({ key: "'", code: "Quote" }), true);
assert.equal(insertedText, "'");

toolbarHandlers.get("opendesk-magi-summary")();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.equal(magiFetches[0].url, "http://127.0.0.1:41827/v1/health");
assert.equal(magiFetches[0].options.headers.Authorization, "Bearer test-token");
assert.equal(magiFetches[1].url, "http://127.0.0.1:41827/v1/analyze");
assert.ok(magiPayloads.some((payload) => payload.state === "done"));
assert.ok(magiPayloads.some((payload) => payload.text === "MAGI 測試完成"));

magiFetchMode = "failure";
toolbarHandlers.get("opendesk-magi-summary")();
await new Promise((resolve) => setTimeout(resolve, 10));
assert.ok(
  magiPayloads.some(
    (payload) =>
      payload.state === "error" &&
      payload.text.includes("請先開啟或重新啟動「全能文件工作台」"),
  ),
);

toolbarHandlers.get("opendesk-renumber-headings")();
assert.equal(headingParagraphs[0].GetText(), "壹、第一章");
assert.equal(headingParagraphs[1].GetText(), "本文提到壹、一、（一）等格式，但這不是標題。");
assert.equal(headingParagraphs[2].GetText(), "一、第一節");
assert.equal(headingParagraphs[3].GetText(), "（一）第一款");
assert.equal(headingParagraphs[4].GetText(), "1. 第一目");
assert.equal(headingParagraphs[0].style, "Heading 1");
assert.equal(headingParagraphs[2].style, "Heading 2");
assert.ok(messages.some((message) => message.includes("安全重編 4 個標題")));

console.log("ONLYOFFICE 繁中寫作工具：所有項目通過");
