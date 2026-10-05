import { readFileSync } from "node:fs";

const readSource = path => readFileSync(path,"utf8").replace(/\r\n/g,"\n");
const html = readSource("src/index.html");
const main = readSource("src/main.js");
const rust = readSource("src-tauri/src/lib.rs");
const python = readSource("src-tauri/resources/acropdf-core/embedded_core.py");

function values(source, expression) {
  return new Set([...source.matchAll(expression)].map((match) => match[1]));
}

const htmlTools = values(html, /data-pdf-operation="([^"]+)"/g);
const definitionBlock = main.match(/const pdfToolDefinitions = \{([\s\S]*?)\n\};\n\nfunction pdfToolFieldHtml/)?.[1] || "";
const definitionTools = new Set(
  [...definitionBlock.matchAll(/^  (?:(?:"([^"]+)")|([a-z][\w-]*)): \{/gm)]
    .map((match) => match[1] || match[2]),
);
const directTools = values(main, /tool === "([^"]+)"/g);
const handledTools = new Set([...definitionTools, ...directTools]);
const missingTools = [...htmlTools].filter((tool) => !handledTools.has(tool));
if (missingTools.length) {
  throw new Error(`介面按鈕沒有處理器：${missingTools.join("、")}`);
}

const definitionOperations = values(definitionBlock, /operation: "([^"]+)"/g);
const directOperations = values(main, /applyPdfOperation\("([^"]+)"/g);
const frontendOperations = new Set([...definitionOperations, ...directOperations]);
const missingRustOperations = [...frontendOperations].filter(
  (operation) => !rust.includes(`        "${operation}",`),
);
const missingPythonOperations = [...frontendOperations].filter(
  (operation) => !python.includes(`operation == "${operation}"`),
);
if (missingRustOperations.length || missingPythonOperations.length) {
  throw new Error(
    `PDF 操作協定不一致：Rust 缺少 ${missingRustOperations.join("、") || "無"}；Python 缺少 ${missingPythonOperations.join("、") || "無"}`,
  );
}

const frontendQueries = values(main, /queryCurrentPdf\("([^"]+)"/g);
const missingRustQueries = [...frontendQueries].filter(
  (query) => !rust.includes(`        "${query}",`),
);
const missingPythonQueries = [...frontendQueries].filter(
  (query) => !python.includes(`query == "${query}"`),
);
if (missingRustQueries.length || missingPythonQueries.length) {
  throw new Error(
    `PDF 查詢協定不一致：Rust 缺少 ${missingRustQueries.join("、") || "無"}；Python 缺少 ${missingPythonQueries.join("、") || "無"}`,
  );
}

for (const requiredText of [
  'id="magi-result"',
  "拖曳即可重排",
  "復原上次修改",
  "匯出 Word／Excel／簡報／圖片",
]) {
  if (!html.includes(requiredText)) throw new Error(`主要介面缺少：${requiredText}`);
}

console.log(
  `PDF 前後端協定：PASS（${htmlTools.size} 個工具、${frontendOperations.size} 個操作、${frontendQueries.size} 個查詢）`,
);
