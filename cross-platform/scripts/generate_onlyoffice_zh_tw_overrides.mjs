import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import OpenCC from "opencc-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const defaultMacRoot =
  "/Applications/ONLYOFFICE.app/Contents/Resources/editors/web-apps/apps";
const sourceRoot = process.env.ONLYOFFICE_WEB_APPS_ROOT || defaultMacRoot;
const outputPath = path.join(
  projectRoot,
  "src-tauri/resources/onlyoffice-tw-plugin/ui-overrides.js",
);
const editors = [
  "documenteditor",
  "spreadsheeteditor",
  "presentationeditor",
  "pdfeditor",
  "visioeditor",
];
const converter = OpenCC.Converter({ from: "cn", to: "twp" });

const taiwanTerms = [
  [/字體/g, "字型"],
  [/字號/g, "字級"],
  [/文檔/g, "文件"],
  [/文件夾/g, "資料夾"],
  [/服務器/g, "伺服器"],
  [/網絡/g, "網路"],
  [/視圖/g, "檢視"],
  [/默認/g, "預設"],
  [/保存/g, "儲存"],
  [/加載/g, "載入"],
  [/查找/g, "尋找"],
  [/打印/g, "列印"],
  [/導入/g, "匯入"],
  [/導出/g, "匯出"],
  [/屏幕/g, "螢幕"],
  [/視頻/g, "影片"],
  [/信息/g, "資訊"],
  [/鼠標/g, "滑鼠"],
  [/菜單/g, "選單"],
  [/導航/g, "導覽"],
  [/便捷/g, "方便"],
  [/用戶/g, "使用者"],
  [/應用程序/g, "應用程式"],
  [/軟件/g, "軟體"],
  [/硬件/g, "硬體"],
  [/賬戶/g, "帳戶"],
  [/登錄/g, "登入"],
  [/註銷/g, "登出"],
  [/創建/g, "建立"],
  [/添加/g, "新增"],
  [/粘貼/g, "貼上"],
  [/剪切/g, "剪下"],
  [/撤銷/g, "復原"],
  [/光標/g, "游標"],
  [/單擊/g, "按一下"],
  [/雙擊/g, "按兩下"],
  [/選項卡/g, "頁籤"],
  [/幻燈片/g, "投影片"],
  [/演示文稿/g, "簡報"],
  [/拼寫/g, "拼字"],
  [/批註/g, "註解"],
  [/高亮/g, "醒目提示"],
  [/居中/g, "置中"],
  [/頁眉/g, "頁首"],
  [/頁腳/g, "頁尾"],
];

const manualOverrides = {
  "Multipage view": "多頁檢視",
  "Work with multiple pages at once for easier navigation.":
    "同時檢視多個頁面，讓導覽更方便。",
  "Got it": "知道了",
};

function toTaiwan(value) {
  let converted = converter(String(value));
  for (const [source, target] of taiwanTerms) converted = converted.replace(source, target);
  return converted;
}

function loadLocale(directory, language) {
  return JSON.parse(fs.readFileSync(path.join(directory, `${language}.json`), "utf8"));
}

const candidates = new Map();
const statistics = [];

function addCandidate(source, target, weight) {
  if (typeof source !== "string" || typeof target !== "string") return;
  if (!source.trim() || source === target || source.length > 1200) return;
  const choices = candidates.get(source) || new Map();
  choices.set(target, (choices.get(target) || 0) + weight);
  candidates.set(source, choices);
}

for (const editor of editors) {
  const localeDirectory = path.join(sourceRoot, editor, "main/locale");
  if (
    !["en", "zh", "zh-tw"].every((language) =>
      fs.existsSync(path.join(localeDirectory, `${language}.json`)),
    )
  ) {
    continue;
  }

  const english = loadLocale(localeDirectory, "en");
  const simplified = loadLocale(localeDirectory, "zh");
  const traditional = loadLocale(localeDirectory, "zh-tw");
  let generatedFallbacks = 0;

  for (const [key, englishValue] of Object.entries(english)) {
    const simplifiedValue = simplified[key];
    const traditionalValue = traditional[key];
    if (typeof englishValue !== "string" || typeof traditionalValue !== "string") continue;

    const needsFallback =
      traditionalValue === englishValue &&
      typeof simplifiedValue === "string" &&
      simplifiedValue !== englishValue;
    const target = toTaiwan(needsFallback ? simplifiedValue : traditionalValue);
    if (needsFallback) generatedFallbacks += 1;

    addCandidate(englishValue, target, needsFallback ? 2 : 5);
    addCandidate(simplifiedValue, target, 4);
    addCandidate(traditionalValue, target, 5);
  }

  statistics.push({
    editor,
    keys: Object.keys(english).length,
    generatedFallbacks,
  });
}

if (!statistics.length) {
  throw new Error(`找不到 ONLYOFFICE 語系來源：${sourceRoot}`);
}

for (const [source, target] of Object.entries(manualOverrides)) {
  addCandidate(source, target, 100);
}

const overrides = {};
for (const [source, choices] of [...candidates.entries()].sort(([a], [b]) =>
  a.localeCompare(b, "zh-Hant"),
)) {
  const [target] = [...choices.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-Hant"),
  )[0];
  overrides[source] = target;
}

const payload = {
  version: 1,
  source: "ONLYOFFICE Desktop Editors 9.4 語系資源＋OpenCC 台灣慣用詞",
  statistics,
  translations: overrides,
};
const script = `(function (root) {\n  "use strict";\n  root.OpenDeskTwUiOverrides = Object.freeze(${JSON.stringify(payload, null, 2)});\n})(typeof globalThis !== "undefined" ? globalThis : this);\n`;
fs.writeFileSync(outputPath, script, "utf8");
console.log(`已產生 ${Object.keys(overrides).length} 組繁中介面覆寫：${outputPath}`);
