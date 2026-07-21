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

const wordTabs = {
  file: {
    title: "檔案：新增、開啟、儲存、列印與交付",
    detail: "把文件生命週期放在同一處；OpenDesk 會保留原檔、版本副本與相容性報告。",
    tasks: [
      ["newdocument", "新增與範本", "建立標準 DOCX，再到編輯器套用履歷、報告、信函或自訂範本。", "檔案 → 新增／範本", "new"],
      ["openfile", "開啟與最近文件", "開啟 DOCX／DOCM、舊版 DOC、ODT 或 RTF；先檢查格式風險再編輯。", "檔案 → 開啟", "open"],
      ["saveprint", "儲存、另存新檔與列印", "使用 DOCX 保留編輯能力，另存副本、預覽頁面、選擇印表機與列印範圍。", "檔案 → 儲存／另存新檔／列印", "editor"],
      ["documentinfo", "文件資訊與交付檢查", "查看標題地圖、字型、註解、修訂、隱藏欄位、頁碼與無障礙提醒。", "OpenDesk 直接完成", "report"],
      ["recover", "備份、復原與版本副本", "每次由 OpenDesk 開啟前都保留時間戳記副本；可直接開啟安全備份資料夾。", "OpenDesk 版本保護", "backups"],
      ["filepdf", "匯出可搜尋 PDF", "使用隔離的本機轉檔程序，不上傳內容，也不改寫原始 DOCX。", "OpenDesk 直接完成", "pdf"],
    ],
  },
  home: {
    title: "常用：寫作與每天最常用的排版",
    detail: "先處理文字、段落、樣式與清單；一致的樣式是目錄與文件導覽的基礎。",
    tasks: [
      ["font", "字型與文字", "字型、大小、粗體、斜體、底線、色彩、醒目提示、上下標與清除格式。", "常用 → 字型", "editor"],
      ["paragraph", "段落與定位點", "左右／分散對齊、縮排、行距、段前段後、框線、底紋、尺規與定位點。", "常用 → 段落", "editor"],
      ["styles", "樣式與標題", "用標題 1–4 建立一致結構，之後才能自動產生目錄與導覽。", "常用 → 樣式", "editor"],
      ["lists", "項目符號與多層清單", "建立項目符號、數字編號、多層清單，並調整縮排與重新開始編號。", "常用 → 段落 → 清單", "editor"],
      ["format", "格式刷與貼上選項", "複製格式、選擇性貼上、保留來源格式或只保留文字。", "常用 → 複製樣式／貼上", "editor"],
      ["find", "尋找、取代與選取", "依文字或格式尋找，全部取代，快速選取相同格式內容。", "常用 → 尋找與取代", "editor"],
      ["voice", "聽寫、朗讀與輔助輸入", "可用 Windows／macOS 系統聽寫輸入繁體中文；朗讀與沉浸閱讀依本機編輯器支援。", "系統聽寫＋檢視 → 閱讀模式", "editor"],
      ["renumber", "中文標題安全重編", "辨識〔壹、〕〔一、〕（一）與 1.，先備份，再建立套用標題樣式的新副本。", "OpenDesk 直接完成", "renumber"],
    ],
  },
  insert: {
    title: "插入：把需要的內容放進文件",
    detail: "頁面、表格、圖片、連結、頁首頁尾與公式都集中在這裡。",
    tasks: [
      ["pages", "封面、空白頁與分頁", "加入封面、空白頁、分頁符號；長文件請優先使用分節符號。", "插入 → 頁面", "editor"],
      ["table", "表格", "插入、繪製、排序、合併／分割儲存格、重複標題列、文字與表格互轉。", "插入 → 表格／表格工具", "editor"],
      ["illustrations", "圖片、形狀與圖示", "插入圖片、螢幕擷取、形狀、圖示與文字環繞；可加替代文字。", "插入 → 圖片／形狀", "editor"],
      ["charts", "圖表與 SmartArt", "插入可編輯圖表、流程圖與組織圖；複雜 SmartArt 需逐檔確認相容性。", "插入 → 圖表／圖解", "editor"],
      ["links", "連結、書籤與交互參照", "建立網頁連結、文件內書籤，以及可自動更新的交互參照。", "插入／參考資料 → 連結", "editor"],
      ["header", "頁首、頁尾與頁碼", "不同首頁、奇偶頁、章節頁碼、總頁數與日期欄位。", "插入 → 頁首及頁尾", "editor"],
      ["textobjects", "文字方塊與文字藝術", "插入文字方塊、首字放大、簽名欄、日期時間、物件與文字藝術。", "插入 → 文字", "editor"],
      ["symbols", "方程式與符號", "建立數學式、特殊符號與常用字元；保留 OOXML 方程式。", "插入 → 方程式／符號", "editor"],
    ],
  },
  draw: {
    title: "繪圖：用筆、滑鼠或觸控直接標記",
    detail: "適合簽閱、圈選與教學註記；轉換墨跡的能力依本機編輯器而異。",
    tasks: [
      ["pens", "畫筆、鉛筆與螢光筆", "選擇顏色與粗細，手寫、圈選、標記重點或擦除墨跡。", "繪圖 → 畫筆", "editor"],
      ["inkselect", "套索選取與移動", "圈選墨跡後移動、縮放、複製或刪除。", "繪圖 → 套索選取", "editor"],
      ["inkconvert", "墨跡轉圖形／數學式", "將手繪內容轉成規整圖形或方程式；需由支援的編輯引擎處理。", "繪圖 → 轉換", "editor"],
      ["annotations", "簽閱註記", "搭配註解與追蹤修訂留下可辨識的審閱紀錄。", "繪圖＋校閱", "editor"],
    ],
  },
  design: {
    title: "設計：一次統一整份文件的外觀",
    detail: "以主題與樣式控制整份文件，避免逐段手動改字型。",
    tasks: [
      ["themes", "主題、色彩與字型", "套用整份文件的主題色、標題／內文字型與效果。", "設計 → 文件格式", "editor"],
      ["stylesets", "樣式集與段落間距", "一次切換標題外觀與整份文件段落間距。", "設計 → 文件格式", "editor"],
      ["watermark", "浮水印", "加入草稿、機密或自訂文字／圖片浮水印。", "設計 → 頁面背景", "editor"],
      ["pagebackground", "頁面色彩與框線", "設定頁面背景、列印框線與正式文件邊框。", "設計 → 頁面背景", "editor"],
    ],
  },
  layout: {
    title: "版面配置：控制每一頁怎麼排、怎麼印",
    detail: "紙張、邊界、分節與物件排列是頁碼錯亂時最先要檢查的地方。",
    tasks: [
      ["page", "邊界、方向與紙張大小", "A4／Letter、自訂邊界、直向與橫向，並可只套用特定章節。", "版面配置 → 頁面設定", "editor"],
      ["columns", "欄與分隔設定", "單欄、多欄、不等寬欄與分欄線，適合公報或簡訊。", "版面配置 → 欄", "editor"],
      ["breaks", "分頁與分節符號", "下一頁、接續本頁、奇數頁或偶數頁分節；獨立控制頁碼與頁首頁尾。", "版面配置 → 分隔設定", "editor"],
      ["linenumbers", "行號與斷字", "加入連續或每頁重編的行號，控制自動斷字。", "版面配置 → 行號／斷字", "editor"],
      ["spacing", "縮排與段落間距", "精確設定左右縮排、首行／凸排、段前段後與行距。", "版面配置 → 段落", "editor"],
      ["arrange", "位置、文繞圖與排列", "圖文環繞、對齊、群組、旋轉、上移／下移圖層與選取窗格。", "版面配置 → 排列", "editor"],
      ["sectionpages", "章節頁碼修正", "處理封面不顯示頁碼、正文從 1 開始、橫向頁面與不同頁首頁尾。", "分節 → 取消連結前一節 → 設定頁碼", "editor"],
    ],
  },
  references: {
    title: "參考資料：長文件、論文與正式報告",
    detail: "所有可自動更新的目錄、註腳、引文與索引都建立在正確樣式上。",
    tasks: [
      ["toc", "自動目錄", "依標題樣式產生可點擊目錄，更新頁碼或整份目錄。", "參考資料 → 目錄", "editor"],
      ["notes", "註腳與尾註", "插入註腳／尾註、切換位置、設定編號格式與重新開始方式。", "參考資料 → 註腳", "editor"],
      ["citations", "引文、來源與書目", "管理來源，插入引文並依 APA、MLA 等樣式產生書目。", "參考資料 → 引文與書目", "editor", "LibreOffice"],
      ["captions", "標號與圖表目錄", "為圖、表、方程式加自動標號，再產生圖表目錄。", "參考資料 → 標號", "editor"],
      ["crossref", "交互參照", "引用標題、圖表、註腳或書籤，內容與頁碼可更新。", "參考資料 → 交互參照", "editor"],
      ["index", "索引與引證目錄", "標記索引項目並建立索引；法律文件可建立引證目錄。", "參考資料 → 索引", "editor", "LibreOffice"],
      ["structure", "檢查文件結構", "顯示標題地圖、註腳、書籤、欄位、修訂與目錄狀態。", "OpenDesk 直接完成", "report"],
    ],
  },
  mailings: {
    title: "郵件：大量產生姓名、地址或編號不同的文件",
    detail: "依序選主文件、資料來源、欄位、預覽，最後再產生個別文件。",
    tasks: [
      ["envelopes", "信封與標籤", "設定收件與寄件地址、標籤廠牌、尺寸與整頁版面。", "郵件 → 建立", "editor", "LibreOffice"],
      ["startmerge", "啟動合併列印", "選擇信件、電子郵件、信封、標籤或目錄類型。", "工具 → 合併列印精靈", "editor", "LibreOffice"],
      ["recipients", "選取收件者", "連接試算表／CSV，排序、篩選並勾選需要的資料列。", "合併列印 → 選取資料來源", "editor", "LibreOffice"],
      ["mergefields", "插入合併欄位與規則", "插入姓名、地址、自訂欄位，以及條件式文字與下一筆記錄規則。", "合併列印 → 插入欄位", "editor", "LibreOffice"],
      ["previewmerge", "預覽與完成合併", "逐筆預覽、檢查錯誤，再輸出個別文件、列印或 PDF。", "合併列印 → 預覽／完成", "editor", "LibreOffice"],
    ],
  },
  review: {
    title: "校閱：校對、討論、比較與定稿",
    detail: "修訂與註解是交付前最容易遺漏的內容，OpenDesk 會在列印前主動提醒。",
    tasks: [
      ["editorcheck", "拼字、文法與字數統計", "設定繁體中文校訂語言、逐項檢查建議，查看字元與段落統計。", "校閱 → 拼字與文法／字數統計", "editor"],
      ["language", "翻譯與校訂語言", "翻譯選取範圍或文件，設定語言並控制自動偵測。", "校閱 → 語言", "editor"],
      ["comments", "註解、回覆與解決", "新增討論、回覆、標示完成，並依序跳到上一則／下一則。", "校閱 → 註解", "editor"],
      ["track", "追蹤修訂", "記錄每位作者的插入、刪除與格式變更，選擇顯示方式。", "校閱 → 追蹤", "editor"],
      ["accept", "接受或拒絕修訂", "逐項或全部接受／拒絕；定稿前務必再次檢查隱藏標記。", "校閱 → 變更", "editor"],
      ["compare", "比較與合併兩個版本", "保留原檔，把差異產生為修訂標記；也能合併多人修改。", "編輯 → 追蹤修訂 → 比較文件", "editor", "LibreOffice"],
      ["protect", "限制編輯與文件保護", "限制格式、唯讀或允許填表；IRM 權限屬 Microsoft 專有能力。", "校閱 → 保護", "editor"],
      ["accessibility", "無障礙與列印前檢查", "檢查圖片替代文字、表格標題列、校訂語言、註解與修訂。", "OpenDesk 直接完成", "report"],
    ],
  },
  view: {
    title: "檢視：用最適合目前工作的方式看文件",
    detail: "閱讀、編輯、導覽與並排比較各有不同的最佳畫面。",
    tasks: [
      ["modes", "閱讀、整頁與草稿模式", "切換閱讀模式、整頁／列印版面、Web 版面、大綱與草稿。", "檢視 → 檢視模式", "editor"],
      ["navigation", "文件地圖與導覽窗格", "依標題瀏覽長文件，檢查層級與快速跳到章節。", "OpenDesk 直接顯示", "report"],
      ["ruler", "尺規、格線與格式標記", "顯示尺規、格線、段落符號、分頁與分節符號。", "檢視／常用 → 顯示", "editor"],
      ["zoom", "縮放與多頁檢視", "單頁、多頁、頁寬與自訂縮放比例。", "檢視 → 縮放", "editor"],
      ["windows", "分割、並排與同步捲動", "同一文件分割視窗，或兩份文件並排、同步捲動。", "檢視 → 視窗", "editor"],
      ["focus", "專注與沉浸式閱讀", "隱藏不需要的工具，把畫面留給閱讀或寫作。", "檢視 → 專注／閱讀", "editor"],
    ],
  },
  advanced: {
    title: "進階：表單、自動化、安全與輸出",
    detail: "開放格式能保留大多數結構；VBA、ActiveX、COM 與 IRM 會明確標示相容界線。",
    tasks: [
      ["controls", "內容控制項與可填表單", "加入純文字、日期、核取方塊、下拉選單及重複區段。", "表單／開發人員 → 控制項", "editor"],
      ["fields", "欄位與自動內容", "頁碼、日期、檔名、公式、文件屬性、條件與合併欄位。", "插入 → 欄位", "editor"],
      ["macros", "巨集與 VBA", "可保留 DOCM 與 VBA 專案並警示；不宣稱可等價執行 Microsoft VBA。", "僅保留與安全掃描", "report"],
      ["addins", "增益集、ActiveX 與 COM", "Microsoft 專有擴充無法等價重現；開啟前掃描並保留原檔。", "OpenDesk 相容性界線", "report"],
      ["signatures", "簽章、限制與文件屬性", "插入簽名欄、檢查屬性與隱藏資訊；數位憑證需由作業系統提供。", "檔案 → 資訊／插入 → 簽名欄", "editor"],
      ["inspector", "文件檢查與交付前稽核", "檢查巨集、外部連結、嵌入物件、註解、修訂、字型與頁碼。", "OpenDesk 直接完成", "report"],
      ["pdf", "輸出可搜尋 PDF", "在本機轉換，不上傳文件；輸出前先檢查修訂、註解與頁碼。", "OpenDesk 直接完成", "pdf"],
      ["magi", "MAGI 文件分析", "摘要、校對、結構與風險分析；相容 V2／V3，結果留在 App。", "OpenDesk 直接完成", "magi"],
    ],
  },
};

const state = { status: null, selectedPath: null, selectedAnalysis: null, wordReport: null, wordTab: "home", featureTab: "all" };
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
  if (!window.__TAURI_INTERNALS__) {
    $("#system-summary").textContent = "介面預覽模式・本機文件功能會在桌面 App 啟用";
    return;
  }
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
    if (isWordPath(path)) {
      await loadWordReport(path);
    } else {
      state.wordReport = null;
      $("#word-current").classList.add("hidden");
    }
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
    await selectDocument(result.path);
  } catch (error) { toast(`新增失敗：${error}`); }
}

function renderFeatures() {
  const query = $("#feature-search").value.trim().toLowerCase();
  const filtered = featureItems.filter(([module, title, detail]) => (state.featureTab === "all" || state.featureTab === module) && `${title}${detail}`.toLowerCase().includes(query));
  $("#feature-grid").innerHTML = filtered.map(([module, title, detail, tag]) => `<article class="feature-card" data-module="${module}"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><span class="tag">${escapeHtml(tag)}</span></article>`).join("") || '<p class="empty">找不到符合的功能。</p>';
}

function isWordPath(path) {
  return /\.(docx|docm)$/i.test(path || "");
}

async function chooseWordDocument() {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Word 文件", extensions: ["docx", "docm", "doc", "odt", "rtf"] }],
  });
  if (typeof result !== "string") return null;
  await selectDocument(result);
  if (!isWordPath(result)) {
    toast("這是舊版或開放格式；請先用救援引擎另存為 DOCX，才能使用完整文件地圖。", 7000);
    return null;
  }
  return result;
}

async function ensureWordDocument() {
  if (isWordPath(state.selectedPath)) return state.selectedPath;
  return chooseWordDocument();
}

function renderWordTab() {
  const tab = wordTabs[state.wordTab];
  $$('[data-word-tab]').forEach((item) => {
    const active = item.dataset.wordTab === state.wordTab;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  $("#word-task-panel").setAttribute("aria-labelledby", `word-tab-${state.wordTab}`);
  $("#word-tab-intro").innerHTML = `<b>${escapeHtml(tab.title)}</b><span>${escapeHtml(tab.detail)}</span>`;
  $("#word-task-grid").innerHTML = tab.tasks.map(([id, title, detail, location, action]) => `
    <article class="word-task-card">
      <div class="word-task-icon" aria-hidden="true">${action === "report" ? "✓" : action === "renumber" ? "↻" : action === "pdf" ? "PDF" : action === "magi" ? "AI" : action === "new" ? "+" : action === "open" ? "↗" : action === "backups" ? "⌕" : "→"}</div>
      <div class="word-task-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><small>${escapeHtml(location)}</small></div>
      <button class="word-task-action" data-word-task="${id}">${action === "report" ? "立即檢查" : action === "renumber" ? "安全重編" : action === "pdf" ? "轉成 PDF" : action === "magi" ? "交給 MAGI" : action === "new" ? "新增文件" : action === "open" ? "選擇文件" : action === "backups" ? "開啟備份" : "開啟使用"}</button>
    </article>`).join("");
  $$('[data-word-task]').forEach((button) => button.addEventListener("click", () => runWordTask(button.dataset.wordTask)));
}

function findWordTask(id) {
  for (const tab of Object.values(wordTabs)) {
    const task = tab.tasks.find((value) => value[0] === id);
    if (task) return task;
  }
  return null;
}

async function runWordTask(id) {
  const task = findWordTask(id);
  if (!task) return;
  const [, title, , location, action, requestedEngine] = task;
  if (action === "new") {
    await createDocument("text");
    return;
  }
  if (action === "open") {
    await chooseWordDocument();
    return;
  }
  if (action === "backups") {
    try {
      const backupRoot = await invoke("open_backup_folder");
      toast(`已開啟安全備份資料夾：${backupRoot}`, 8000);
    } catch (error) {
      toast(`無法開啟備份資料夾：${error}`, 8000);
    }
    return;
  }
  const path = await ensureWordDocument();
  if (!path) return;
  try {
    if (action === "report") {
      await loadWordReport(path, true);
      toast(`${title}已完成。`);
      return;
    }
    if (action === "renumber") {
      await renumberCurrentWord();
      return;
    }
    if (action === "pdf") {
      toast("正在先保留原檔，再於本機轉換可搜尋 PDF…");
      const result = await invoke("convert_pdf", { path });
      toast(`PDF 已完成：${result}`, 8000);
      return;
    }
    if (action === "magi") {
      $("#magi-panel").classList.remove("hidden");
      $("#magi-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    const engine = requestedEngine || state.selectedAnalysis?.preferred_engine || "ONLYOFFICE";
    const result = await invoke("backup_and_open", { path, engine });
    toast(`${result.message}。開啟後請使用：${location}`, 9000);
  } catch (error) {
    toast(`${title}無法執行：${error}`, 8000);
  }
}

async function loadWordReport(path, shouldScroll = false) {
  try {
    const report = await invoke("word_report", { path });
    state.wordReport = report;
    $("#word-current").classList.remove("hidden");
    $("#word-report-title").textContent = report.file_name;
    const stats = [
      [report.characters.toLocaleString("zh-TW"), "非空白字元"],
      [report.paragraphs, "段落"],
      [report.headings.length, "標題"],
      [report.sections, "分節"],
      [report.tables, "表格"],
      [report.images, "圖片"],
    ];
    $("#word-stats").innerHTML = stats.map(([value, label]) => `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    $("#word-document-map").innerHTML = report.headings.length
      ? report.headings.map((heading) => `<div class="map-heading level-${heading.level}"><span>H${heading.level}</span><b>${escapeHtml(heading.text)}</b><small>第 ${heading.paragraph} 段</small></div>`).join("")
      : '<p class="empty">尚未偵測到標題樣式。請先套用「標題 1–4」，目錄與導覽才會穩定。</p>';
    const reviewValues = [
      ["頁首頁尾", `${report.headers}／${report.footers}`],
      ["頁碼", report.has_page_numbers ? "已設定" : "未偵測"],
      ["目錄", report.has_toc ? "已建立" : "未建立"],
      ["註腳／尾註", `${report.footnotes}／${report.endnotes}`],
      ["註解", report.comments],
      ["插入／刪除修訂", `${report.tracked_insertions}／${report.tracked_deletions}`],
      ["書籤／超連結", `${report.bookmarks}／${report.hyperlinks}`],
      ["欄位／合併欄位", `${report.fields}／${report.mail_merge_fields}`],
    ];
    $("#word-review-metrics").innerHTML = reviewValues.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>`).join("");
    $("#word-fonts").innerHTML = `<b>文件使用字型</b><div>${report.fonts.length ? report.fonts.map((font) => `<span>${escapeHtml(font)}</span>`).join("") : '<span>未讀到明確字型</span>'}</div>`;
    const warningItems = [
      ...report.print_warnings.map((warning) => ["送印", warning]),
      ...report.accessibility_warnings.map((warning) => ["無障礙", warning]),
    ];
    $("#word-warnings").innerHTML = warningItems.map(([kind, warning]) => `<div class="word-warning"><span>${escapeHtml(kind)}</span><p>${escapeHtml(warning)}</p></div>`).join("");
    if (shouldScroll) $("#word-current").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#word-current").classList.add("hidden");
    toast(`Word 文件檢查失敗：${error}`, 7000);
  }
}

async function renumberCurrentWord() {
  const path = await ensureWordDocument();
  if (!path) return;
  const button = $("#word-renumber");
  button.disabled = true;
  const original = button.textContent;
  button.textContent = "正在備份與重編…";
  try {
    const result = await invoke("renumber_headings", { path });
    toast(result.message, 9000);
    await selectDocument(result.path);
  } catch (error) {
    toast(`中文標題重編失敗：${error}`, 8000);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
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
$("#open-word-document").addEventListener("click", chooseWordDocument);
$("#open-document").addEventListener("click", async () => {
  const result = await open({ multiple: false, directory: false, filters: [{ name: "Office 與 PDF", extensions: ["docx","docm","doc","rtf","xlsx","xlsm","xls","csv","pptx","pptm","ppt","pdf","odt","ods","odp"] }] });
  if (typeof result === "string") selectDocument(result);
});
function selectWordTab(button, focus = false) {
  state.wordTab = button.dataset.wordTab;
  renderWordTab();
  if (focus) button.focus();
}

$$('[data-word-tab]').forEach((button) => {
  button.addEventListener("click", () => selectWordTab(button));
  button.addEventListener("keydown", (event) => {
    const tabs = $$('[data-word-tab]');
    const current = tabs.indexOf(button);
    let target = null;
    if (event.key === "ArrowRight") target = tabs[(current + 1) % tabs.length];
    if (event.key === "ArrowLeft") target = tabs[(current - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") target = tabs[0];
    if (event.key === "End") target = tabs[tabs.length - 1];
    if (!target) return;
    event.preventDefault();
    selectWordTab(target, true);
  });
});
$("#word-edit").addEventListener("click", async () => {
  const path = await ensureWordDocument();
  if (!path) return;
  try {
    const result = await invoke("backup_and_open", { path, engine: state.selectedAnalysis?.preferred_engine || "ONLYOFFICE" });
    toast(result.message, 8000);
  } catch (error) { toast(String(error)); }
});
$("#word-renumber").addEventListener("click", renumberCurrentWord);
$("#word-report-refresh").addEventListener("click", () => state.selectedPath && loadWordReport(state.selectedPath, true));
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

renderRecent(); renderFeatures(); renderWordTab(); loadStatus();
