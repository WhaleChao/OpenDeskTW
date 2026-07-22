import assert from "node:assert/strict";

await import("../cross-platform/src-tauri/resources/onlyoffice-tw-plugin/typography.js");

const tools = globalThis.OpenDeskTwTypography;
assert.ok(tools, "應載入繁中標點工具");
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

console.log("ONLYOFFICE 繁中寫作工具：10/10 項通過");
