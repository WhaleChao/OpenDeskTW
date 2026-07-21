import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const featureItems = [
  ["word", "文字格式與樣式", "字型、大小、色彩、粗斜底線、段落、定位點、樣式與格式刷。", "編輯引擎"],
  ["word", "標題與自動編號", "〔壹、〕〔一、〕等層級、重新編號、目錄、書籤與交互參照。", "OpenDesk＋編輯引擎"],
  ["word", "頁面與印刷", "紙張、邊界、分節、欄、浮水印、頁碼、頁首、頁尾與列印。", "已驗證"],
  ["word", "內容物件", "表格、圖片、圖表、形狀、SmartArt、方程式、文字方塊與超連結。", "編輯引擎"],
  ["word", "參照與審閱", "目錄、圖表目錄、註腳、尾註、註解、比較、追蹤修訂與保護。", "已驗證"],
  ["word", "表單與郵件合併", "欄位、核取方塊、可填表單、郵件合併與標籤。", "依格式相容"],
  ["excel", "公式與函數", "數學、統計、邏輯、日期、查閱、陣列、跨表公式與命名範圍。", "已驗證"],
  ["excel", "資料整理", "格式化表格、排序、篩選、群組、移除重複值、分欄與凍結窗格。", "已驗證"],
  ["excel", "資料品質", "資料驗證、下拉選單、條件格式、註解、保護與共用檢視。", "已驗證"],
  ["excel", "分析與圖表", "圖表、趨勢線、樞紐分析、切片器、假設分析與小計。", "依格式相容"],
  ["excel", "工作表與列印", "多頁籤、隱藏工作表、列印範圍、重複標題列、頁首頁尾與 PDF。", "已驗證"],
  ["excel", "外部資料", "CSV、文字匯入、外部連結與資料連線；來源權限需逐檔確認。", "安全掃描"],
  ["powerpoint", "佈景與母片", "投影片大小、佈景、色彩、字型、版面、母片與預留位置。", "已驗證"],
  ["powerpoint", "文字與物件", "文字、表格、圖表、圖片、形狀、SmartArt、方程式與對齊群組。", "已驗證"],
  ["powerpoint", "媒體", "音訊、視訊、螢幕錄製、超連結與動作按鈕。", "依媒體編碼"],
  ["powerpoint", "播放效果", "轉場、常用動畫、順序、觸發與放映設定。複雜動作路徑需逐檔確認。", "轉場已驗證"],
  ["powerpoint", "簡報工具", "備忘稿、簡報者檢視、投影片編號、頁尾、講義、列印與 PDF。", "已驗證"],
  ["pdf", "PDF 閱讀與輸出", "搜尋、選取、註解、列印，並由本機 LibreOffice 將 Office 文件轉為 PDF。", "本機處理"],
  ["pdf", "PDF 表單", "建立及填寫 PDF 表單；掃描 PDF 需另行 OCR。", "編輯引擎"],
  ["safety", "版本備份", "每次開啟與轉檔前建立副本，原檔保持原格式。", "OpenDesk"],
  ["safety", "格式風險掃描", "VBA、ActiveX、外部連結、嵌入物件、SmartArt 與缺少字型。", "OpenDesk"],
  ["safety", "MAGI V2／V3", "只連線目前唯一運作版本；結果直接顯示，離線候選測試不算啟用衝突。", "本機 Agent"],
  ["safety", "安全熱修", "只接受 Tauri 私鑰簽章的更新包；驗證失敗不安裝，可保留上一版。", "密碼學簽章"],
];

const state = { status: null, selectedPath: null, selectedAnalysis: null, featureTab: "all" };
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message, timeout = 4600) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add("hidden"), timeout);
}

async function loadStatus() {
  try {
    state.status = await invoke("system_status");
    const engines = state.status.engines.map((item) => `${item.installed ? "●" : "○"} ${item.name}${item.version ? ` ${item.version}` : ""}`).join("　");
    $("#system-summary").textContent = `${state.status.platform}・${engines}・${state.status.magi.summary}`;
    $("#app-version").textContent = `OpenDesk TW ${state.status.app_version}`;
  } catch (error) {
    $("#system-summary").textContent = `環境檢查失敗：${error}`;
  }
}

function recentDocuments() { return JSON.parse(localStorage.getItem("opendesk-recent") || "[]"); }
function recordRecent(path) {
  const next = [path, ...recentDocuments().filter((item) => item !== path)].slice(0, 12);
  localStorage.setItem("opendesk-recent", JSON.stringify(next));
  renderRecent();
}
function renderRecent() {
  const values = recentDocuments();
  const root = $("#recent-list");
  root.innerHTML = values.length ? values.map((path) => `<button class="recent-item" data-recent="${escapeHtml(path)}"><span>${escapeHtml(path.split(/[\\/]/).pop())}</span><small>繼續編輯 ›</small></button>`).join("") : '<p class="empty">尚無最近文件。</p>';
  $$('[data-recent]').forEach((button) => button.addEventListener("click", () => selectDocument(button.dataset.recent)));
}
function escapeHtml(value) { return value.replace(/[&<>"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[character])); }

async function selectDocument(path) {
  if (!path) return;
  try {
    const analysis = await invoke("scan_document", { path });
    state.selectedPath = path;
    state.selectedAnalysis = analysis;
    $("#workspace").classList.remove("hidden");
    $("#workspace-title").textContent = analysis.file_name;
    $("#workspace-path").textContent = path;
    $("#risk-badge").textContent = analysis.risk;
    $("#analysis-grid").innerHTML = [
      ["文件類型", analysis.kind], ["建議引擎", analysis.preferred_engine], ["已檢查結構", `${analysis.package_entries} 個項目`],
      ["中文字標題", `${analysis.heading_count} 個`], ["相容性提醒", analysis.issues.length ? analysis.issues.join("、") : "未發現已知高風險功能"], ["原檔保護", "開啟前自動備份"],
    ].map(([title, detail]) => `<div class="analysis-card"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>`).join("");
    recordRecent(path);
    $("#workspace").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) { toast(`無法檢查文件：${error}`); }
}

async function createDocument(kind) {
  const map = { text: ["未命名文字文件.docx", "docx"], spreadsheet: ["未命名試算表.xlsx", "xlsx"], presentation: ["未命名簡報.pptx", "pptx"] };
  const [defaultPath, extension] = map[kind];
  const destination = await save({ defaultPath, filters: [{ name: "Office 文件", extensions: [extension] }] });
  if (!destination) return;
  try {
    const result = await invoke("create_document", { kind, destination });
    recordRecent(result.path);
    toast(`已建立 ${result.file_name}，正在開啟編輯器…`);
  } catch (error) { toast(`新增失敗：${error}`); }
}

function renderFeatures() {
  const query = $("#feature-search").value.trim().toLowerCase();
  const filtered = featureItems.filter(([module, title, detail]) => (state.featureTab === "all" || state.featureTab === module) && `${title}${detail}`.toLowerCase().includes(query));
  $("#feature-grid").innerHTML = filtered.map(([module, title, detail, tag]) => `<article class="feature-card" data-module="${module}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><span class="tag">${escapeHtml(tag)}</span></article>`).join("") || '<p class="empty">找不到符合的功能。</p>';
}

async function runSelfTest() {
  const root = $("#self-test-result");
  root.textContent = "正在執行 LIVE 檢查，請稍候…";
  try {
    const report = await invoke("run_self_test");
    root.innerHTML = `<b class="${report.passed ? "pass" : "fail"}">${escapeHtml(report.summary)}</b><div class="test-groups">${report.groups.map((group) => `<div class="test-group"><b>${escapeHtml(group.name)}</b><div>${group.passed}/${group.total}</div></div>`).join("")}</div>`;
  } catch (error) { root.innerHTML = `<b class="fail">檢查失敗：${escapeHtml(String(error))}</b>`; }
}

async function runMagiAnalysis() {
  if (!state.selectedPath) return;
  const button = $("#magi-run");
  const result = $("#magi-result");
  button.disabled = true;
  button.textContent = "分析中…";
  result.textContent = "正在本機擷取文件文字並交給 MAGI；文件不會上傳到 OpenDesk 伺服器…";
  $("#magi-copy").classList.add("hidden");
  try {
    const reply = await invoke("magi_analyze", {
      path: state.selectedPath,
      mode: $("#magi-mode").value,
      instruction: $("#magi-instruction").value,
    });
    result.textContent = `${reply.text}\n\n— ${reply.compatibility_version.toUpperCase()}${reply.model ? `・${reply.model}` : ""}${reply.degraded ? "・降級回應" : ""}`;
    $("#magi-copy").classList.remove("hidden");
  } catch (error) {
    result.textContent = `MAGI 分析失敗：${error}`;
  } finally {
    button.disabled = false;
    button.textContent = "開始分析";
  }
}

async function checkUpdate() {
  const button = $("#check-update");
  button.disabled = true;
  button.textContent = "檢查中…";
  try {
    const update = await check();
    if (!update) { toast("目前已是最新安全版本。"); return; }
    button.textContent = `下載 ${update.version}`;
    await update.downloadAndInstall();
    toast(`安全熱修 ${update.version} 已驗證並安裝，正在重新啟動…`);
    await relaunch();
  } catch (error) { toast(`更新未安裝：${error}`); }
  finally { button.disabled = false; button.textContent = "檢查安全熱修"; }
}

$$('[data-create]').forEach((button) => button.addEventListener("click", () => createDocument(button.dataset.create)));
$("#open-document").addEventListener("click", async () => {
  const result = await open({ multiple: false, directory: false, filters: [{ name: "Office 與 PDF", extensions: ["docx","docm","doc","rtf","xlsx","xlsm","xls","csv","pptx","pptm","ppt","pdf","odt","ods","odp"] }] });
  if (typeof result === "string") selectDocument(result);
});
$("#open-primary").addEventListener("click", async () => { try { const result = await invoke("backup_and_open", { path: state.selectedPath, engine: state.selectedAnalysis.preferred_engine }); toast(result.message); } catch (error) { toast(String(error)); } });
$("#open-alternate").addEventListener("click", async () => { try { const result = await invoke("backup_and_open", { path: state.selectedPath, engine: state.selectedAnalysis.alternate_engine }); toast(result.message); } catch (error) { toast(String(error)); } });
$("#convert-pdf").addEventListener("click", async () => { try { toast("正在本機轉換 PDF…"); const result = await invoke("convert_pdf", { path: state.selectedPath }); toast(`PDF 已完成：${result}`); } catch (error) { toast(`PDF 轉換失敗：${error}`); } });
$("#magi-analyze").addEventListener("click", () => { $("#magi-panel").classList.toggle("hidden"); if (!$("#magi-panel").classList.contains("hidden")) $("#magi-panel").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#magi-run").addEventListener("click", runMagiAnalysis);
$("#magi-copy").addEventListener("click", async () => { await navigator.clipboard.writeText($("#magi-result").textContent); toast("MAGI 分析結果已複製。"); });
$("#reveal-file").addEventListener("click", () => invoke("reveal_path", { path: state.selectedPath }).catch((error) => toast(String(error))));
$("#clear-recent").addEventListener("click", () => { localStorage.removeItem("opendesk-recent"); renderRecent(); toast("最近文件清單已清除，原始文件未刪除。"); });
$("#feature-search").addEventListener("input", renderFeatures);
$$('[data-feature-tab]').forEach((button) => button.addEventListener("click", () => { state.featureTab = button.dataset.featureTab; $$('[data-feature-tab]').forEach((item) => item.classList.toggle("active", item === button)); renderFeatures(); }));
$("#run-self-test").addEventListener("click", runSelfTest);
$("#check-update").addEventListener("click", checkUpdate);

renderRecent(); renderFeatures(); loadStatus();
