import assert from "node:assert/strict";

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
assert.equal(tools.completePairs("文字「已完成」"), "文字「已完成」");
assert.equal(tools.completePairs("〔壹、〕標題"), "〔壹、〕標題");
assert.equal(tools.normalizeTaiwanPunctuation('他說"測試"'), "他說「測試」");
assert.equal(tools.normalizeTaiwanPunctuation("他說：“可以!”"), "他說：「可以！」");
assert.equal(tools.normalizeTaiwanPunctuation("是否正確?"), "是否正確？");
assert.equal(tools.normalizeTaiwanPunctuation("版本2.2.1"), "版本2.2.1");
assert.equal(tools.normalizeTaiwanPunctuation("don't change"), "don't change");
assert.equal(uiPatch.translateText("Multipage view"), "多頁檢視");
assert.equal(
  uiPatch.translateText("Work with multiple pages at once for easier navigation."),
  "同時檢視多個頁面，讓導覽更方便。",
);
assert.equal(uiPatch.translateText("五號"), "10.5");
assert.equal(uiPatch.translateText(" 小四 "), " 12 ");
assert.ok(
  Object.keys(globalThis.OpenDeskTwUiOverrides.translations).length > 10000,
  "應隨附完整繁中介面覆寫字典",
);

console.log("ONLYOFFICE 繁中寫作工具：15/15 項通過");
