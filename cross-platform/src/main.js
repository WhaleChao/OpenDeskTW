import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const featureItems = [
  ["word", "文字格式與樣式", "字型、大小、色彩、粗斜底線、段落、定位點、樣式與格式刷。", "編輯引擎"],
  ["word", "標題與自動編號", "〔壹、〕〔一、〕等層級、重新編號、目錄、書籤與交互參照。", "工作台＋編輯引擎"],
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
  ["safety", "版本備份", "每次開啟與轉檔前建立副本，原檔保持原格式。", "全能文件工作台"],
  ["safety", "格式風險掃描", "VBA、ActiveX、外部連結、嵌入物件、SmartArt 與缺少字型。", "全能文件工作台"],
  ["safety", "MAGI V2／V3", "只連線目前唯一運作版本；結果直接顯示，離線候選測試不算啟用衝突。", "本機 Agent"],
  ["safety", "安全熱修", "只接受 Tauri 私鑰簽章的更新包；驗證失敗不安裝，可保留上一版。", "密碼學簽章"],
];

const wordTabs = {
  file: {
    title: "檔案：新增、開啟、儲存、列印與交付",
    detail: "把文件生命週期放在同一處；全能文件工作台會保留原檔、版本副本與相容性報告。",
    tasks: [
      ["newdocument", "新增與範本", "建立標準 DOCX，再到編輯器套用履歷、報告、信函或自訂範本。", "檔案 → 新增／範本", "new"],
      ["openfile", "開啟與最近文件", "開啟 DOCX／DOCM、舊版 DOC、ODT 或 RTF；先檢查格式風險再編輯。", "檔案 → 開啟", "open"],
      ["saveprint", "儲存、另存新檔與列印", "使用 DOCX 保留編輯能力，另存副本、預覽頁面、選擇印表機與列印範圍。", "檔案 → 儲存／另存新檔／列印", "editor"],
      ["documentinfo", "文件資訊與交付檢查", "查看標題地圖、字型、註解、修訂、隱藏欄位、頁碼與無障礙提醒。", "工作台直接完成", "report"],
      ["recover", "備份、復原與版本副本", "每次由工作台開啟前都保留時間戳記副本；可直接開啟安全備份資料夾。", "工作台版本保護", "backups"],
      ["filepdf", "匯出可搜尋 PDF", "使用隔離的本機轉檔程序，不上傳內容，也不改寫原始 DOCX。", "工作台直接完成", "pdf"],
    ],
  },
  home: {
    title: "常用：寫作與每天最常用的排版",
    detail: "先處理文字、段落、樣式與清單；一致的樣式是目錄與文件導覽的基礎。",
    tasks: [
      ["font", "字型與文字", "字型、大小、粗體、斜體、底線、色彩、醒目提示、上下標與清除格式。", "常用 → 字型", "editor"],
      ["paragraph", "段落與定位點", "左右／分散對齊、縮排、行距、段前段後、框線、底紋、尺規與定位點。", "常用 → 段落", "editor"],
      ["distributed", "分散對齊（選取段落）", "補上 ONLYOFFICE 未顯示的繁中公文功能；先選取一個或多個段落，再按工具列。", "全能文件 → 分散對齊", "twtools"],
      ["paired-punctuation", "智慧成對標點", "依巢狀順序判斷要補上）、」、】、〕、》或其他正確結尾，支援選取文字與目前句子。", "全能文件 → 智慧補齊／台灣標點", "twtools"],
      ["styles", "樣式與標題", "用標題 1–4 建立一致結構，之後才能自動產生目錄與導覽。", "常用 → 樣式", "editor"],
      ["lists", "項目符號與多層清單", "建立項目符號、數字編號、多層清單，並調整縮排與重新開始編號。", "常用 → 段落 → 清單", "editor"],
      ["format", "格式刷與貼上選項", "複製格式、選擇性貼上、保留來源格式或只保留文字；⌘⌥C／V 或 Ctrl+Alt+C／V 可直接複製與套用格式。", "常用 → 複製樣式／貼上", "editor"],
      ["find", "尋找、取代與選取", "依文字或格式尋找，全部取代，快速選取相同格式內容。", "常用 → 尋找與取代", "editor"],
      ["voice", "聽寫、朗讀與輔助輸入", "可用 Windows／macOS 系統聽寫輸入繁體中文；朗讀與沉浸閱讀依本機編輯器支援。", "系統聽寫＋檢視 → 閱讀模式", "editor"],
      ["renumber", "中文標題安全重編", "辨識〔壹、〕〔一、〕（一）與 1.，先備份，再建立套用標題樣式的新副本。", "工作台直接完成", "renumber"],
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
      ["structure", "檢查文件結構", "顯示標題地圖、註腳、書籤、欄位、修訂與目錄狀態。", "工作台直接完成", "report"],
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
    detail: "修訂與註解是交付前最容易遺漏的內容，全能文件工作台會在列印前主動提醒。",
    tasks: [
      ["editorcheck", "拼字、文法與字數統計", "設定繁體中文校訂語言、逐項檢查建議，查看字元與段落統計。", "校閱 → 拼字與文法／字數統計", "editor"],
      ["language", "翻譯與校訂語言", "翻譯選取範圍或文件，設定語言並控制自動偵測。", "校閱 → 語言", "editor"],
      ["comments", "註解、回覆與解決", "新增討論、回覆、標示完成，並依序跳到上一則／下一則。", "校閱 → 註解", "editor"],
      ["track", "追蹤修訂", "記錄每位作者的插入、刪除與格式變更，選擇顯示方式。", "校閱 → 追蹤", "editor"],
      ["accept", "接受或拒絕修訂", "逐項或全部接受／拒絕；定稿前務必再次檢查隱藏標記。", "校閱 → 變更", "editor"],
      ["compare", "比較與合併兩個版本", "保留原檔，把差異產生為修訂標記；也能合併多人修改。", "編輯 → 追蹤修訂 → 比較文件", "editor", "LibreOffice"],
      ["protect", "限制編輯與文件保護", "限制格式、唯讀或允許填表；IRM 權限屬 Microsoft 專有能力。", "校閱 → 保護", "editor"],
      ["accessibility", "無障礙與列印前檢查", "檢查圖片替代文字、表格標題列、校訂語言、註解與修訂。", "工作台直接完成", "report"],
    ],
  },
  view: {
    title: "檢視：用最適合目前工作的方式看文件",
    detail: "閱讀、編輯、導覽與並排比較各有不同的最佳畫面。",
    tasks: [
      ["modes", "閱讀、整頁與草稿模式", "切換閱讀模式、整頁／列印版面、Web 版面、大綱與草稿。", "檢視 → 檢視模式", "editor"],
      ["navigation", "文件地圖與導覽窗格", "依標題瀏覽長文件，檢查層級與快速跳到章節。", "工作台直接顯示", "report"],
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
      ["addins", "增益集、ActiveX 與 COM", "Microsoft 專有擴充無法等價重現；開啟前掃描並保留原檔。", "工作台相容性界線", "report"],
      ["signatures", "簽章、限制與文件屬性", "插入簽名欄、檢查屬性與隱藏資訊；數位憑證需由作業系統提供。", "檔案 → 資訊／插入 → 簽名欄", "editor"],
      ["inspector", "文件檢查與交付前稽核", "檢查巨集、外部連結、嵌入物件、註解、修訂、字型與頁碼。", "工作台直接完成", "report"],
      ["pdf", "輸出可搜尋 PDF", "在本機轉換，不上傳文件；輸出前先檢查修訂、註解與頁碼。", "工作台直接完成", "pdf"],
      ["magi", "MAGI 文件分析", "摘要、校對、結構與風險分析；相容 V2／V3，結果留在 App。", "工作台直接完成", "magi"],
    ],
  },
};

const pdfTabs = {
  home: {
    title: "常用：開啟、閱讀、搜尋與列印",
    detail: "先掌握頁數、文字化程度與安全狀態，再決定要編輯、OCR 或交付。",
    tasks: [
      ["pdf-read", "閱讀與搜尋", "單頁導覽、頁碼跳轉、縮放、健康報告與本機渲染。", "同視窗 PDF 編輯器", "editor", "read"],
      ["pdf-new", "新增空白 PDF", "建立新文件、插入空白頁，再加入文字、頁碼或註解。", "同視窗 → 新增 PDF", "workspace", "new"],
      ["pdf-tools", "完整 PDF 工具中心", "一次看到頁面整理、編輯、註解、OCR、保護、比較與智慧工具。", "同視窗 PDF 工具架", "workspace", "tools"],
      ["pdf-report", "PDF 健康報告", "檢查頁數、文字頁、掃描頁、影像、表單、簽章、註解、附件與中繼資料。", "工作台直接完成", "report", ""],
      ["pdf-print", "列印與頁面預覽", "先在同視窗逐頁預覽，再使用系統列印設定頁面範圍、雙面、方向與印表機。", "同視窗預覽 → 系統列印", "editor", "read"],
      ["pdf-live", "PDF LIVE 驗證", "實際渲染首末頁、記憶體重新封裝並再次開啟，確認文件可安全處理。", "工作台＋內建 PDF 核心", "live", ""],
    ],
  },
  pages: {
    title: "整理頁面：合併、分割、擷取與重新排列",
    detail: "頁面工作先保留原檔；拖曳縮圖即可調整順序，批次操作會清楚顯示範圍。",
    tasks: [
      ["pdf-merge", "合併多份 PDF", "依選擇順序合併文件，保留原始檔案並輸出新 PDF。", "頁面 → 合併 PDF", "workspace", "merge"],
      ["pdf-organize", "頁面重排", "從頁面清單選取目前頁，再前移、後移、插入、刪除或旋轉。", "同視窗 → 頁面工具列", "editor", "pages"],
      ["pdf-split", "分割 PDF", "依分割點、選取範圍或每頁獨立輸出。", "頁面 → 分割 PDF", "editor", "split"],
      ["pdf-extract", "擷取指定頁面", "選擇不連續頁碼，另存為新的 PDF。", "頁面 → 擷取頁面", "editor", "extract"],
      ["pdf-watermark", "文字浮水印", "將自訂文字、字型大小與透明度套用到所有頁面。", "同視窗 → 加入浮水印", "editor", "watermark"],
      ["pdf-header", "頁首頁尾、頁碼與 Bates 編號", "加入自訂頁首頁尾、目前頁碼、總頁數或法律文件連續編號。", "同視窗 → 頁首頁尾／Bates", "editor", "header_footer"],
    ],
  },
  edit: {
    title: "編輯與註解：直接修改內容並留下可追蹤標記",
    detail: "文字、圖片與註解分開處理；永久遮蔽不等同於畫黑色方塊。",
    tasks: [
      ["pdf-text", "編輯文字", "選取文字區塊修改內容、字型與位置；複雜重排可切換文字重排工具。", "工具 → 編輯文字", "editor", "edit_text"],
      ["pdf-image", "編輯圖片", "選取、移動、縮放、取代或刪除 PDF 內圖片。", "工具 → 編輯圖片", "editor", "edit_image"],
      ["pdf-annotate", "螢光筆與註解", "螢光筆、底線、刪除線、便利貼、文字框、圖形、箭頭、手繪與圖章。", "標記工具列", "editor", "annotate"],
      ["pdf-links", "連結、書籤與附件", "加入網頁／頁面連結、階層書籤及內嵌附件。", "工具 → 連結／書籤／附件", "editor", "tools"],
      ["pdf-layers", "圖層、尺規與格線", "管理選用內容圖層，使用尺規、格線、距離與面積測量。", "檢視／工具 → 圖層", "editor", "tools"],
      ["pdf-summary", "註解摘要與匯入匯出", "彙整所有註解，支援 XFDF 往返與註解扁平化。", "工具 → 標注摘要", "editor", "annotate"],
    ],
  },
  forms: {
    title: "表單與簽署：辨識欄位、填寫、驗證再交付",
    detail: "先確認 PDF 是否已有可填欄位；掃描式表單需先辨識結構與座標。",
    tasks: [
      ["pdf-fill", "填寫既有表單", "列出文字、核取、單選、下拉與簽名欄，驗證欄位後再填入。", "工具 → 表單填寫", "editor", "forms"],
      ["pdf-form-design", "建立可填表單", "加入文字、核取、單選、選單、按鈕與簽名欄，設定 Tab 順序。", "工具 → 表單設計", "editor", "form_design"],
      ["pdf-form-data", "表單資料與扁平化", "匯入／匯出 FDF；交付定稿時可將欄位外觀扁平化。", "表單 → 資料／扁平化", "editor", "forms"],
      ["pdf-sign", "數位簽章與驗證", "使用本機憑證簽署、檢查簽章狀態；簽署後修改會影響有效性。", "工具 → 數位簽章", "editor", "sign"],
    ],
  },
  convert: {
    title: "轉換與 OCR：讓掃描檔可搜尋，讓內容能重用",
    detail: "轉換結果一律另存新檔；版面複雜時保留 PDF 作為視覺基準。",
    tasks: [
      ["pdf-ocr", "繁體中文 OCR", "辨識掃描頁並加入可搜尋文字層；完成後再比對頁面渲染。", "工具 → OCR 文字化", "editor", "ocr"],
      ["pdf-office", "匯出 Word／Excel／PowerPoint", "依內容類型轉為可編輯 Office 文件；複雜版面需逐頁確認。", "匯出 → Office", "editor", "convert"],
      ["pdf-image-export", "匯出圖片、文字與 HTML", "逐頁輸出 PNG，或擷取純文字與 HTML 供後續整理。", "匯出 → 圖片／文字／HTML", "editor", "convert"],
      ["pdf-archive", "PDF/A 與 PDF/X", "製作長期保存或印刷交換版本，並執行對應預檢。", "匯出 → PDF/A／PDF/X", "editor", "preflight"],
      ["pdf-optimize", "壓縮與最佳化", "壓縮影像、清理未使用物件並支援快速網頁檢視。", "工具 → 最佳化 PDF", "editor", "optimize"],
    ],
  },
  protect: {
    title: "保護與檢查：密碼、權限、遮蔽、比較與無障礙",
    detail: "敏感內容要用永久遮蔽；安全設定與簽章都必須在輸出副本上驗證。",
    tasks: [
      ["pdf-security", "密碼與使用權限", "AES-256 加密，限制列印、複製與修改；移除保護需要正確密碼。", "工具 → 安全性設定", "editor", "protect"],
      ["pdf-redact", "永久遮蔽敏感資料", "搜尋姓名、身分證號或自訂模式，預覽後套用不可復原的真正遮蔽。", "工具 → 塗黑工具", "editor", "redact"],
      ["pdf-compare", "比較兩份 PDF", "逐頁比較文字與影像差異，產生可檢視的差異結果。", "工具 → 比較文件", "workspace", "compare"],
      ["pdf-preflight", "印刷與交付預檢", "檢查字型、圖片解析度、色彩空間、透明度、出血與 PDF 規範。", "工具 → 預檢", "editor", "preflight"],
      ["pdf-accessibility", "PDF/UA 無障礙", "檢查結構樹、標題、替代文字、表格與閱讀順序。", "工具 → 無障礙設定", "editor", "accessibility"],
    ],
  },
  automation: {
    title: "批次與 MAGI：大量處理、歸檔與內容理解",
    detail: "批次工作先選輸出資料夾；MAGI 只連線目前唯一運作的 V2 或 V3。",
    tasks: [
      ["pdf-batch", "批次處理多份 PDF", "一次加入浮水印、頁首頁尾、Bates 編號、分割或合併。", "工具 → 批次處理", "workspace", "batch"],
      ["pdf-filing", "智慧歸檔與重新命名", "依本機規則分析檔名與內容，複製到分類資料夾並保留來源。", "工具 → 智慧歸檔", "workspace", "filing"],
      ["pdf-magi", "MAGI PDF 分析", "摘要、翻譯、分類、關鍵資訊與法律文件分析；結果留在 App。", "全能文件工作台＋MAGI V2／V3", "magi", "magi"],
      ["pdf-live-automation", "交付前 LIVE 驗證", "重新檢查結構、首末頁渲染及記憶體往返，確認輸出仍能開啟。", "工作台＋內建 PDF 核心", "live", ""],
    ],
  },
};

const wordShortcuts = [
  ["文件", "開啟檔案", "Ctrl+O", "⌘O"],
  ["文件", "儲存", "Ctrl+S", "⌘S"],
  ["文件", "另存／下載為", "Ctrl+Shift+S", "⇧⌘S"],
  ["文件", "列印", "Ctrl+P", "⌘P"],
  ["文件", "關閉文件", "Ctrl+W", "⌘W"],
  ["文件", "下一個文件頁籤", "Ctrl+Tab", "Control+Tab"],
  ["文件", "上一個文件頁籤", "Ctrl+Shift+Tab", "Control+Shift+Tab"],
  ["文件", "更新目錄與欄位", "F9", "Fn+F9"],
  ["編輯", "復原", "Ctrl+Z", "⌘Z"],
  ["編輯", "取消復原／重做", "Ctrl+Y", "⌘Y／⇧⌘Z"],
  ["編輯", "剪下", "Ctrl+X", "⌘X"],
  ["編輯", "複製", "Ctrl+C", "⌘C"],
  ["編輯", "貼上", "Ctrl+V", "⌘V"],
  ["編輯", "只貼上文字", "Ctrl+Shift+V", "⇧⌘V"],
  ["編輯", "全選", "Ctrl+A", "⌘A"],
  ["編輯", "尋找", "Ctrl+F", "⌘F"],
  ["編輯", "尋找與取代", "Ctrl+H", "Control+H"],
  ["編輯", "插入超連結", "Ctrl+K", "⌘K"],
  ["文字格式", "粗體", "Ctrl+B", "⌘B"],
  ["文字格式", "斜體", "Ctrl+I", "⌘I"],
  ["文字格式", "底線", "Ctrl+U", "⌘U"],
  ["文字格式", "刪除線", "Ctrl+5", "⇧⌘X"],
  ["文字格式", "上標", "Ctrl+,", "⌘,"],
  ["文字格式", "下標", "Ctrl+.", "⌘."],
  ["文字格式", "複製格式", "Ctrl+Alt+C", "⌘⌥C"],
  ["文字格式", "套用格式", "Ctrl+Alt+V", "⌘⌥V"],
  ["文字格式", "清除格式", "Ctrl+Space", "⌘+Fn+Space"],
  ["文字格式", "放大字型一級", "Ctrl+]", "⌘]"],
  ["文字格式", "縮小字型一級", "Ctrl+[", "⌘["],
  ["樣式", "套用標題 1", "Alt+1", "⌥⌘1／⌥Control+1"],
  ["樣式", "套用標題 2", "Alt+2", "⌥⌘2／⌥Control+2"],
  ["樣式", "套用標題 3", "Alt+3", "⌥⌘3／⌥Control+3"],
  ["段落", "靠左對齊", "Ctrl+L", "⌘L"],
  ["段落", "置中對齊", "Ctrl+E", "⌘E"],
  ["段落", "靠右對齊", "Ctrl+R", "⌘R"],
  ["段落", "左右對齊", "Ctrl+J", "⌘J"],
  ["段落", "項目符號", "Ctrl+Shift+L", "⇧⌘L"],
  ["段落", "增加縮排", "Ctrl+M", "⌘M"],
  ["段落", "減少縮排", "Ctrl+Shift+M", "⇧⌘M"],
  ["插入", "分頁符號", "Ctrl+Enter", "⌘Return"],
  ["插入", "分欄符號", "Ctrl+Shift+Enter", "⇧⌘Return"],
  ["插入", "插入頁碼", "Ctrl+Shift+P", "⇧⌘P"],
  ["檢視", "顯示／隱藏格式標記", "Ctrl+Shift+8", "⇧⌘8"],
  ["檢視", "回到 100% 縮放", "Ctrl+0", "⌘0"],
  ["校閱", "開啟註解窗格", "Ctrl+Shift+H", "⇧⌘H"],
  ["校閱", "新增註解", "Alt+H", "⌘⌥A"],
  ["導覽", "行首／行尾", "Home／End", "⌘←／⌘→"],
  ["導覽", "文件開頭／結尾", "Ctrl+Home／End", "⌘↑／⌘↓"],
  ["導覽", "逐字移動", "Ctrl+←／→", "⌥←／→"],
  ["選取", "選到行首／行尾", "Shift+Home／End", "⇧+Fn+←／→"],
  ["選取", "選到文件開頭／結尾", "Ctrl+Shift+Home／End", "⇧⌘+Fn+←／→"],
  ["表格", "移到下一個儲存格", "Tab", "Tab"],
  ["表格", "移到上一個儲存格", "Shift+Tab", "Shift+Tab"],
  ["物件", "等比例縮放／限制方向", "Shift+拖曳", "Shift+拖曳"],
  ["物件", "拖曳時建立副本", "Ctrl+拖曳", "Control+拖曳"],
  ["文件", "開啟檔案面板", "Alt+F", "Control+Option+F"],
  ["功能區", "顯示／隱藏功能鍵提示", "Alt", "Option"],
  ["文件", "說明", "F1", "Fn+F1"],
  ["文件", "元素快顯功能表", "Shift+F10", "Shift+Fn+F10"],
  ["文件", "關閉選單／對話框／目前模式", "Esc", "Esc"],
  ["無障礙", "切換螢幕閱讀器動作傳送", "Ctrl+Alt+Z", "⌘⌥Z／Control+Option+Z"],
  ["導覽", "上一頁開頭", "Ctrl+Alt+Page Up", "⌘+Fn+↑／⌥+Fn+↑"],
  ["導覽", "下一頁開頭", "Ctrl+Alt+Page Down", "⌘+Fn+↓／⌥+Fn+↓"],
  ["導覽", "向上／向下捲動一個畫面", "Page Up／Page Down", "Fn+↑／Fn+↓"],
  ["導覽", "上一頁／下一頁", "Alt+Page Up／Page Down", "⌥+Page Up／Page Down"],
  ["檢視", "放大", "Ctrl++", "⌘+"],
  ["檢視", "縮小", "Ctrl+-", "⌘-"],
  ["導覽", "逐字元或逐行移動", "方向鍵", "方向鍵"],
  ["導覽", "對話框移到下一個／上一個控制項", "Tab／Shift+Tab", "Tab／Shift+Tab"],
  ["頁首頁尾", "移到下一個／上一個頁首頁尾", "Page Down／Page Up", "Fn+↓／Fn+↑"],
  ["頁首頁尾", "移到下一個／上一個頁首", "Alt+Page Down／Page Up", "⌥+Fn+↓／↑"],
  ["輸入", "結束段落／新增段落", "Enter", "Return"],
  ["輸入", "插入換行但不另起段落", "Shift+Enter", "Shift+Return"],
  ["輸入", "刪除左側字元", "Backspace", "Delete"],
  ["輸入", "刪除右側字元", "Delete", "Fn+Delete"],
  ["輸入", "刪除左側一個單字", "Ctrl+Backspace", "Option+Delete"],
  ["輸入", "刪除右側一個單字", "Ctrl+Delete", "Fn+Option+Delete"],
  ["輸入", "插入不分行空格", "Ctrl+Shift+Space", "⌘⇧+Fn+Space"],
  ["輸入", "插入不分行連字號", "Ctrl+Shift+-", "⌘⇧-"],
  ["選擇性貼上", "保留來源格式", "貼上後 Ctrl，再按 K", "貼上後 Control，再按 K"],
  ["選擇性貼上", "只保留文字", "貼上後 Ctrl，再按 T", "貼上後 Control，再按 T"],
  ["選擇性貼上", "覆寫表格儲存格", "貼上後 Ctrl，再按 O", "貼上後 Control，再按 O"],
  ["選擇性貼上", "貼成巢狀表格", "貼上後 Ctrl，再按 N", "貼上後 Control，再按 N"],
  ["超連結", "開啟游標所在連結", "Enter", "Return"],
  ["選取", "向右／向左選取一個字元", "Shift+→／←", "Shift+→／←"],
  ["選取", "選到單字結尾／開頭", "Ctrl+Shift+→／←", "Shift+Option+→／←"],
  ["選取", "向上／向下選取一行", "Shift+↑／↓", "Shift+↑／↓"],
  ["選取", "向上／向下選取一個畫面", "Shift+Page Up／Down", "Shift+Fn+↑／↓"],
  ["選取", "選到上一頁／下一頁開頭", "Ctrl+Shift+Page Up／Down", "⌘⇧+Fn+↑／↓"],
  ["段落", "提高清單／縮排層級", "段落開頭按 Tab", "段落開頭按 Tab"],
  ["段落", "降低清單／縮排層級", "Shift+Tab", "Shift+Tab"],
  ["段落", "插入定位字元", "Tab", "Tab"],
  ["物件", "進入圖形或圖表文字", "Enter", "Return"],
  ["物件", "限制水平／垂直移動", "Shift+拖曳", "Shift+拖曳"],
  ["物件", "旋轉時鎖定 15 度", "Shift+拖曳旋轉", "Shift+拖曳旋轉"],
  ["物件", "繪製線條時鎖定 45 度", "Shift+拖曳繪製", "Shift+拖曳繪製"],
  ["物件", "逐像素移動", "Ctrl+方向鍵", "⌘+方向鍵"],
  ["物件", "大步移動", "方向鍵", "方向鍵"],
  ["物件", "移到下一個／上一個物件", "Tab／Shift+Tab", "Tab／Shift+Tab"],
  ["註腳與尾註", "插入尾註", "Ctrl+Alt+D", "Control+Option+D"],
  ["註腳與尾註", "插入註腳", "Ctrl+Alt+F", "—"],
  ["表格", "移到下一列／上一列", "↓／↑", "↓／↑"],
  ["表格", "在儲存格內新增段落", "Enter", "Return"],
  ["表格", "在表格末端新增一列", "最後一格按 Tab", "最後一格按 Tab"],
  ["表格", "插入表格分隔符號", "Ctrl+Shift+Enter", "⌘⇧Return"],
  ["表單", "移到下一個／上一個欄位", "Tab／Shift+Tab", "Tab／Shift+Tab"],
  ["表單", "選擇下一個／上一個選項", "↓／↑", "↓／↑"],
  ["特殊字元", "插入方程式", "Alt+=", "⌥⌘=／⌥Control+="],
  ["特殊字元", "插入破折號（em dash）", "Ctrl+Alt+數字鍵 -", "⌥⇧-"],
  ["特殊字元", "插入短橫線（en dash）", "Ctrl+數字鍵 -", "⌥-"],
  ["特殊字元", "插入版權符號 ©", "Ctrl+Alt+G", "⌘⌥G"],
  ["特殊字元", "插入歐元符號 €", "Ctrl+Alt+E", "⌘⌥E"],
  ["特殊字元", "插入註冊商標 ®", "Ctrl+Alt+R", "⌘⌥R"],
  ["特殊字元", "插入商標 ™", "Ctrl+Alt+T", "⌘⌥T"],
  ["特殊字元", "插入刪節號", "Ctrl+Alt+.", "⌥;"],
  ["特殊字元", "把選取的 Unicode 碼轉成符號", "Alt+X", "⌥⌘X／⌥Control+X"],
  ["全能文件工作台", "中文標題安全重編", "Ctrl+Alt+Shift+R", "⌥⇧⌘R"],
];

const state = {
  status: null,
  selectedPath: null,
  selectedAnalysis: null,
  wordReport: null,
  wordTab: "home",
  onlyofficeTw: null,
  pdfReport: null,
  pdfTab: "home",
  pdfEngine: null,
  pdfPage: 0,
  pdfPages: 0,
  pdfZoom: 1.25,
  pdfRenderToken: 0,
  featureTab: "all",
};
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message, timeout = 4600) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.remove("hidden");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => element.classList.add("hidden"), timeout);
}

function renderShortcutCatalog() {
  const query = $("#shortcut-search").value.trim().toLocaleLowerCase("zh-TW");
  const matched = wordShortcuts.filter((row) => row.join(" ").toLocaleLowerCase("zh-TW").includes(query));
  const grouped = new Map();
  for (const row of matched) {
    if (!grouped.has(row[0])) grouped.set(row[0], []);
    grouped.get(row[0]).push(row);
  }
  $("#shortcut-grid").innerHTML = [...grouped.entries()].map(([category, rows]) => `
    <section class="shortcut-group">
      <h3>${escapeHtml(category)}</h3>
      ${rows.map(([, action, windows, mac]) => `<div class="shortcut-row"><span>${escapeHtml(action)}</span><kbd title="Windows／Linux">${escapeHtml(windows)}</kbd><kbd title="macOS">${escapeHtml(mac)}</kbd></div>`).join("")}
    </section>`).join("") || '<p class="empty">找不到相符快捷鍵；可改用功能名稱搜尋。</p>';
  const currentPlatform = /Mac|iPhone|iPad/.test(navigator.platform) ? "目前為 macOS，右欄是主要按法" : "目前為 Windows／Linux，左欄是主要按法";
  $("#shortcut-platform-note").textContent = `${currentPlatform}・已顯示 ${matched.length}／${wordShortcuts.length} 組`;
}

function openShortcutCatalog() {
  const dialog = $("#shortcut-dialog");
  renderShortcutCatalog();
  if (!dialog.open) dialog.showModal();
  $("#shortcut-search").focus();
}

async function loadStatus() {
  if (!window.__TAURI_INTERNALS__) {
    $("#system-summary").textContent = "介面預覽模式・本機文件功能會在桌面 App 啟用";
    $("#pdf-engine-line").textContent = "介面預覽模式・桌面 App 會啟用同視窗內建 PDF 核心";
    $("#onlyoffice-tw-title").textContent = "介面預覽模式・桌面 App 會固定使用 zh-TW";
    return;
  }
  try {
    state.status = await invoke("system_status");
    const engines = state.status.engines.map((item) => `${item.installed ? "●" : "○"} ${item.name}${item.version ? ` ${item.version}` : ""}`).join("　");
    $("#system-summary").textContent = `${state.status.platform}・${engines}・${state.status.magi.summary}`;
    $("#app-version").textContent = `全能文件工作台 ${state.status.app_version}`;
    await Promise.all([loadPdfEngineStatus(), loadOnlyOfficeTwStatus()]);
  } catch (error) {
    $("#system-summary").textContent = `環境檢查失敗：${error}`;
  }
}

async function loadOnlyOfficeTwStatus() {
  try {
    const status = await invoke("onlyoffice_tw_status");
    state.onlyofficeTw = status;
    const banner = $("#onlyoffice-tw-banner");
    const ready = status.installed && status.traditional_chinese && status.plugin_installed;
    banner.classList.toggle("ready", ready);
    banner.classList.toggle("warning", !ready);
    $("#onlyoffice-tw-title").textContent = ready ? "● ONLYOFFICE 完整繁中與數字字級已就緒" : "○ ONLYOFFICE 繁中介面需要處理";
    $("#onlyoffice-tw-detail").textContent = `${status.message}・目前語系：${status.current_language}${status.running ? "・ONLYOFFICE 正在運作" : ""}`;
    $("#repair-onlyoffice-tw").textContent = ready ? "重新驗證／修復" : "一鍵補齊繁中＋數字字級";
  } catch (error) {
    $("#onlyoffice-tw-title").textContent = "無法檢查 ONLYOFFICE 繁中狀態";
    $("#onlyoffice-tw-detail").textContent = String(error);
  }
}

async function repairOnlyOfficeTraditionalChinese() {
  if (!window.__TAURI_INTERNALS__) {
    toast("介面預覽模式不會更動系統設定；請在全能文件工作台桌面 App 執行繁中修復。", 8000);
    return;
  }
  const button = $("#repair-onlyoffice-tw");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正在備份設定並安裝…";
  try {
    const result = await invoke("repair_onlyoffice_traditional_chinese");
    toast(result.message, 12000);
    await loadOnlyOfficeTwStatus();
  } catch (error) {
    toast(`ONLYOFFICE 繁中修復未完成：${error}`, 10000);
  } finally {
    button.disabled = false;
    if (!state.onlyofficeTw?.traditional_chinese || !state.onlyofficeTw?.plugin_installed) button.textContent = original;
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
    const analysisValues = isPdfPath(path) ? [
      ["文件類型", "PDF"], ["建議引擎", "內建 AcroPDF PDF 核心"], ["結構檢查", "由同視窗本機核心建立健康報告"],
      ["內容安全", "報告不包含文件內文"], ["相容性提醒", analysis.issues.length ? analysis.issues.join("、") : "待 PDF 專項檢查"], ["原檔保護", "編輯前自動備份"],
    ] : [
      ["文件類型", analysis.kind], ["建議引擎", analysis.preferred_engine], ["已檢查結構", `${analysis.package_entries} 個項目`],
      ["中文字標題", `${analysis.heading_count} 個`], ["相容性提醒", analysis.issues.length ? analysis.issues.join("、") : "未發現已知高風險功能"], ["原檔保護", "開啟前自動備份"],
    ];
    $("#analysis-grid").innerHTML = analysisValues.map(([title, detail]) => `<div class="analysis-card"><b>${escapeHtml(title)}</b><span>${escapeHtml(detail)}</span></div>`).join("");
    recordRecent(path);
    if (isWordPath(path)) {
      await loadWordReport(path);
    } else {
      state.wordReport = null;
      $("#word-current").classList.add("hidden");
    }
    if (isPdfPath(path)) {
      await loadPdfReport(path);
      $("#open-primary").textContent = "備份並開啟 PDF 工作區";
      $("#convert-pdf").disabled = true;
      $("#convert-pdf").textContent = "目前已是 PDF";
    } else {
      state.pdfReport = null;
      $("#pdf-current").classList.add("hidden");
      $("#open-primary").textContent = "備份並開啟編輯";
      $("#convert-pdf").disabled = false;
      $("#convert-pdf").textContent = "轉換 PDF";
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
      <div class="word-task-icon" aria-hidden="true">${action === "report" ? "✓" : action === "renumber" ? "↻" : action === "pdf" ? "PDF" : action === "magi" ? "AI" : action === "twtools" ? "繁" : action === "new" ? "+" : action === "open" ? "↗" : action === "backups" ? "⌕" : "→"}</div>
      <div class="word-task-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><small>${escapeHtml(location)}</small></div>
      <button class="word-task-action" data-word-task="${id}">${action === "report" ? "立即檢查" : action === "renumber" ? "安全重編" : action === "pdf" ? "轉成 PDF" : action === "magi" ? "交給 MAGI" : action === "twtools" ? "啟用工具" : action === "new" ? "新增文件" : action === "open" ? "選擇文件" : action === "backups" ? "開啟備份" : "開啟使用"}</button>
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
  if (action === "twtools") {
    await repairOnlyOfficeTraditionalChinese();
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

function isPdfPath(path) {
  return /\.pdf$/i.test(path || "");
}

async function loadPdfEngineStatus() {
  const line = $("#pdf-engine-line");
  try {
    const status = await invoke("acropdf_status");
    state.pdfEngine = status;
    line.className = "pdf-engine-line ready";
    line.textContent = `● 內建 AcroPDF 核心 ${status.app_version} 已就緒・同視窗・不另開 APP・${status.capabilities.length} 組本機能力`;
  } catch (error) {
    state.pdfEngine = null;
    line.className = "pdf-engine-line error";
    line.textContent = `○ 內建 PDF 核心尚未就緒：${error}`;
  }
}

async function choosePdfDocument() {
  const result = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }],
  });
  if (typeof result !== "string") return null;
  await selectDocument(result);
  return result;
}

async function ensurePdfDocument() {
  if (isPdfPath(state.selectedPath)) return state.selectedPath;
  return choosePdfDocument();
}

function renderPdfTab() {
  const tab = pdfTabs[state.pdfTab];
  $$('[data-pdf-tab]').forEach((item) => {
    const active = item.dataset.pdfTab === state.pdfTab;
    item.classList.toggle("active", active);
    item.setAttribute("aria-selected", String(active));
    item.tabIndex = active ? 0 : -1;
  });
  $("#pdf-task-panel").setAttribute("aria-labelledby", `pdf-tab-${state.pdfTab}`);
  $("#pdf-tab-intro").innerHTML = `<b>${escapeHtml(tab.title)}</b><span>${escapeHtml(tab.detail)}</span>`;
  $("#pdf-task-grid").innerHTML = tab.tasks.map(([id, title, detail, location, action]) => `
    <article class="pdf-task-card">
      <div class="pdf-task-icon" aria-hidden="true">${action === "report" ? "✓" : action === "live" ? "LIVE" : action === "magi" ? "AI" : "PDF"}</div>
      <div class="pdf-task-copy"><h3>${escapeHtml(title)}</h3><p>${escapeHtml(detail)}</p><small>${escapeHtml(location)}</small></div>
      <button class="pdf-task-action" data-pdf-task="${id}">${action === "report" ? "立即檢查" : action === "live" ? "開始驗證" : action === "magi" ? "交給 MAGI" : action === "workspace" ? "啟動工具" : "備份並開啟"}</button>
    </article>`).join("");
  $$('[data-pdf-task]').forEach((button) => button.addEventListener("click", () => runPdfTask(button.dataset.pdfTask)));
}

function findPdfTask(id) {
  for (const tab of Object.values(pdfTabs)) {
    const task = tab.tasks.find((value) => value[0] === id);
    if (task) return task;
  }
  return null;
}

const pdfToolMap = {
  merge: "merge",
  split: "split",
  extract: "extract",
  edit_text: "add-text",
  annotate: "note",
  watermark: "watermark",
  header_footer: "header-footer",
  ocr: "ocr",
  optimize: "optimize",
  protect: "encrypt",
  redact: "redact",
  compare: "compare",
};

async function openPdfWorkspace(path, tool = "tools") {
  const source = path || await ensurePdfDocument();
  if (!source) return null;
  const result = await invoke("open_in_acropdf", { path: source, tool: tool || null });
  state.pdfPage = 0;
  $("#pdf-inline-workspace").classList.remove("hidden");
  $("#pdf-inline-file").textContent = source;
  $("#pdf-inline-status").textContent = result.message;
  await renderPdfPage(0);
  $("#pdf-inline-workspace").scrollIntoView({ behavior: "smooth", block: "start" });
  const requestedTool = pdfToolMap[tool];
  if (requestedTool) window.setTimeout(() => runEmbeddedPdfTool(requestedTool), 220);
  return result;
}

async function runPdfTask(id) {
  const task = findPdfTask(id);
  if (!task) return;
  const [, title, , , action, tool] = task;
  try {
    if (id === "pdf-new") {
      await createBlankPdf();
      return;
    }
    if (action === "workspace") {
      await openPdfWorkspace(isPdfPath(state.selectedPath) ? state.selectedPath : null, tool);
      return;
    }
    const path = await ensurePdfDocument();
    if (!path) return;
    if (action === "report") {
      await loadPdfReport(path, true);
      toast(`${title}已完成。`);
      return;
    }
    if (action === "live") {
      await runPdfLiveCheck(path);
      return;
    }
    if (action === "magi") {
      $("#magi-panel").classList.remove("hidden");
      $("#magi-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    await openPdfWorkspace(path, tool);
  } catch (error) {
    toast(`${title}無法執行：${error}`, 8000);
  }
}

async function createBlankPdf() {
  const destination = await save({
    defaultPath: "未命名.pdf",
    filters: [{ name: "PDF 文件", extensions: ["pdf"] }],
  });
  if (!destination) return;
  try {
    await invoke("pdf_create_blank", { destination, pages: 1 });
    toast("空白 PDF 已建立，正在同一視窗開啟。", 7000);
    await selectDocument(destination);
    await openPdfWorkspace(destination, "tools");
  } catch (error) {
    toast(`無法建立 PDF：${error}`, 9000);
  }
}

function renderPdfPageButtons() {
  const root = $("#pdf-page-buttons");
  root.innerHTML = Array.from({ length: state.pdfPages }, (_, index) => `
    <button class="${index === state.pdfPage ? "active" : ""}" data-pdf-page="${index}" aria-label="前往第 ${index + 1} 頁">
      <span>${index + 1}</span><small>第 ${index + 1} 頁</small>
    </button>`).join("");
  $$('[data-pdf-page]').forEach((button) => button.addEventListener("click", () => renderPdfPage(Number(button.dataset.pdfPage))));
}

async function renderPdfPage(page = state.pdfPage) {
  if (!isPdfPath(state.selectedPath)) return;
  const token = ++state.pdfRenderToken;
  const message = $("#pdf-render-message");
  const image = $("#pdf-page-image");
  message.textContent = "正在由內建核心渲染頁面…";
  message.classList.remove("hidden");
  image.classList.add("loading");
  try {
    const result = await invoke("pdf_render_page", {
      path: state.selectedPath,
      page: Math.max(0, page),
      scale: state.pdfZoom,
      password: null,
    });
    if (token !== state.pdfRenderToken) return;
    state.pdfPages = Number(result.pages) || 1;
    state.pdfPage = Math.min(Math.max(0, Number(result.page) || 0), state.pdfPages - 1);
    image.src = result.data_url;
    image.width = Number(result.width) || 1;
    image.height = Number(result.height) || 1;
    $("#pdf-page-number").value = String(state.pdfPage + 1);
    $("#pdf-page-number").max = String(state.pdfPages);
    $("#pdf-page-total").textContent = `／${state.pdfPages}`;
    $("#pdf-page-previous").disabled = state.pdfPage <= 0;
    $("#pdf-page-next").disabled = state.pdfPage >= state.pdfPages - 1;
    $("#pdf-zoom-label").textContent = `${Math.round(state.pdfZoom * 100)}%`;
    $("#pdf-inline-status").textContent = `第 ${state.pdfPage + 1}／${state.pdfPages} 頁・${result.width}×${result.height} 像素・文件留在本機`;
    renderPdfPageButtons();
    message.classList.add("hidden");
  } catch (error) {
    if (token !== state.pdfRenderToken) return;
    message.textContent = `頁面無法渲染：${error}`;
    $("#pdf-inline-status").textContent = `內建 PDF 核心發生錯誤：${error}`;
  } finally {
    if (token === state.pdfRenderToken) image.classList.remove("loading");
  }
}

async function applyPdfOperation(operation, options = {}, output = null) {
  if (!isPdfPath(state.selectedPath)) throw new Error("請先選擇 PDF 文件");
  const source = state.selectedPath;
  $("#pdf-inline-status").textContent = "正在處理；完成前請勿關閉文件…";
  const result = await invoke("pdf_apply_operation", { path: source, operation, options, output });
  if (operation === "split") {
    const count = result.outputs?.length || 0;
    $("#pdf-inline-status").textContent = `已分割為 ${count} 份 PDF。`;
    toast(`PDF 已分割為 ${count} 份，原檔未變更。`, 9000);
    return result;
  }
  if (!output || output === source) {
    await loadPdfReport(source);
    state.pdfPage = Math.min(state.pdfPage, Math.max(0, (Number(result.pages) || state.pdfPages) - 1));
    await renderPdfPage(state.pdfPage);
    toast("PDF 修改完成；原始版本已自動備份。", 8000);
  } else {
    $("#pdf-inline-status").textContent = `新 PDF 已儲存：${result.output || output}`;
    toast(`新 PDF 已儲存：${result.output || output}`, 9000);
  }
  return result;
}

const pdfToolDefinitions = {
  "add-text": {
    title: "加入文字",
    detail: "在目前頁左上方加入文字；原檔會先自動備份。",
    operation: "add_text",
    fields: [
      { name: "text", label: "文字內容", type: "textarea", required: true, placeholder: "輸入要加入的文字" },
      { name: "font_size", label: "字型大小", type: "number", value: 12, min: 6, max: 72 },
    ],
  },
  note: {
    title: "加入便利貼註解",
    detail: "在目前頁加入可繼續編輯的 PDF 註解。",
    operation: "note",
    fields: [{ name: "text", label: "註解內容", type: "textarea", required: true, placeholder: "輸入註解" }],
  },
  highlight: {
    title: "搜尋並標示",
    detail: "搜尋整份 PDF 的相同文字並加上螢光標示。",
    operation: "highlight_search",
    fields: [{ name: "text", label: "要標示的文字", type: "text", required: true }],
  },
  watermark: {
    title: "加入文字浮水印",
    detail: "將斜向浮水印套用到所有頁面。",
    operation: "watermark",
    fields: [
      { name: "text", label: "浮水印文字", type: "text", required: true, value: "機密" },
      { name: "font_size", label: "字型大小", type: "number", value: 56, min: 8, max: 180 },
      { name: "opacity", label: "透明度（0.05–1）", type: "number", value: 0.22, min: 0.05, max: 1, step: 0.05 },
    ],
  },
  "header-footer": {
    title: "頁首、頁尾與頁碼",
    detail: "可使用 {page} 代表目前頁碼、{pages} 代表總頁數、{bates} 代表法律文件連續編號。",
    operation: "header_footer",
    fields: [
      { name: "header", label: "頁首", type: "text", placeholder: "例如：公司名稱" },
      { name: "footer", label: "頁尾", type: "text", value: "第 {page} 頁，共 {pages} 頁" },
      { name: "bates_prefix", label: "Bates 前綴（可留白）", type: "text", placeholder: "例如：CASE-" },
      { name: "bates_start", label: "Bates 起始號碼", type: "number", value: 1, min: 0 },
      { name: "bates_digits", label: "Bates 數字位數", type: "number", value: 6, min: 1, max: 12 },
      { name: "font_size", label: "字型大小", type: "number", value: 10, min: 6, max: 30 },
    ],
  },
  redact: {
    title: "永久遮蔽文字",
    detail: "搜尋整份文件並永久移除符合內容。完成後無法從目前版本還原，但會保留自動備份。",
    operation: "redact_search",
    fields: [{ name: "text", label: "要永久遮蔽的文字", type: "text", required: true }],
  },
  encrypt: {
    title: "設定 PDF 密碼",
    detail: "使用 AES-256 建立加密副本；目前開啟的原檔不會被鎖住。",
    operation: "encrypt",
    fields: [
      { name: "owner_password", label: "擁有者密碼", type: "password", required: true },
      { name: "user_password", label: "開啟密碼（可留白）", type: "password" },
    ],
  },
};

function pdfToolFieldHtml(field) {
  const attributes = [
    `name="${escapeHtml(field.name)}"`,
    field.required ? "required" : "",
    field.placeholder ? `placeholder="${escapeHtml(field.placeholder)}"` : "",
    field.value !== undefined ? `value="${escapeHtml(String(field.value))}"` : "",
    field.min !== undefined ? `min="${field.min}"` : "",
    field.max !== undefined ? `max="${field.max}"` : "",
    field.step !== undefined ? `step="${field.step}"` : "",
  ].filter(Boolean).join(" ");
  const control = field.type === "textarea"
    ? `<textarea ${attributes}>${field.value ? escapeHtml(String(field.value)) : ""}</textarea>`
    : `<input type="${field.type || "text"}" ${attributes} />`;
  return `<label><span>${escapeHtml(field.label)}</span>${control}</label>`;
}

function requestPdfToolOptions(definition) {
  return new Promise((resolve) => {
    const dialog = $("#pdf-tool-dialog");
    const form = $("#pdf-tool-form");
    $("#pdf-tool-title").textContent = definition.title;
    $("#pdf-tool-detail").textContent = definition.detail;
    $("#pdf-tool-fields").innerHTML = definition.fields.map(pdfToolFieldHtml).join("");
    dialog.returnValue = "";
    dialog.addEventListener("close", () => {
      if (dialog.returnValue !== "default") {
        resolve(null);
        return;
      }
      const data = new FormData(form);
      const options = {};
      for (const field of definition.fields) {
        const raw = data.get(field.name);
        options[field.name] = field.type === "number" ? Number(raw) : String(raw || "");
      }
      resolve(options);
    }, { once: true });
    dialog.showModal();
    $("#pdf-tool-fields input, #pdf-tool-fields textarea")?.focus();
  });
}

async function runEmbeddedPdfTool(tool) {
  try {
    if (!isPdfPath(state.selectedPath)) {
      const selected = await ensurePdfDocument();
      if (!selected) return;
      await openPdfWorkspace(selected);
    }
    if (tool === "rotate-left" || tool === "rotate-right") {
      await applyPdfOperation("rotate", { page: state.pdfPage, angle: tool === "rotate-left" ? -90 : 90 });
      return;
    }
    if (tool === "insert-blank") {
      await applyPdfOperation("insert_blank", { page: state.pdfPage, position: state.pdfPage + 1 });
      state.pdfPage += 1;
      await renderPdfPage(state.pdfPage);
      return;
    }
    if (tool === "move-page-left" || tool === "move-page-right") {
      const target = tool === "move-page-left" ? state.pdfPage - 1 : state.pdfPage + 1;
      if (target < 0 || target >= state.pdfPages) {
        toast(tool === "move-page-left" ? "目前頁已在最前面。" : "目前頁已在最後面。");
        return;
      }
      const order = Array.from({ length: state.pdfPages }, (_, index) => index);
      [order[state.pdfPage], order[target]] = [order[target], order[state.pdfPage]];
      await applyPdfOperation("reorder", { order });
      state.pdfPage = target;
      await renderPdfPage(state.pdfPage);
      return;
    }
    if (tool === "delete-page") {
      if (!window.confirm(`確定刪除第 ${state.pdfPage + 1} 頁？原始版本會保留在安全備份資料夾。`)) return;
      await applyPdfOperation("delete", { page: state.pdfPage });
      return;
    }
    if (tool === "merge") {
      const other = await open({ multiple: false, directory: false, filters: [{ name: "PDF 文件", extensions: ["pdf"] }] });
      if (typeof other !== "string") return;
      await applyPdfOperation("merge", { other, position: state.pdfPage + 1 });
      return;
    }
    if (tool === "extract") {
      const output = await save({ defaultPath: `擷取第${state.pdfPage + 1}頁.pdf`, filters: [{ name: "PDF 文件", extensions: ["pdf"] }] });
      if (!output) return;
      await applyPdfOperation("extract", { pages: [state.pdfPage] }, output);
      return;
    }
    if (tool === "split") {
      const outputDir = await open({ multiple: false, directory: true, title: "選擇分割 PDF 的儲存資料夾" });
      if (typeof outputDir !== "string") return;
      await applyPdfOperation("split", { output_dir: outputDir });
      return;
    }
    if (tool === "compare") {
      const other = await open({ multiple: false, directory: false, filters: [{ name: "PDF 文件", extensions: ["pdf"] }] });
      if (typeof other !== "string") return;
      const result = await invoke("pdf_compare", { path: state.selectedPath, other });
      const pages = (result.changed_pages || []).map((page) => page + 1).join("、");
      const message = result.identical ? "兩份 PDF 的頁數、文字與縮圖完全相同。" : `發現 ${result.changed_count} 頁不同：第 ${pages} 頁。`;
      $("#pdf-inline-status").textContent = message;
      toast(message, 10000);
      return;
    }
    if (tool === "optimize") {
      if (!window.confirm("要最佳化目前 PDF 嗎？程式會先自動備份，並移除未使用物件。")) return;
      await applyPdfOperation("optimize", { remove_metadata: false });
      return;
    }
    if (tool === "ocr") {
      if (!window.confirm("繁中 OCR 會重新渲染整份文件，較大的 PDF 可能需要數分鐘。要繼續嗎？")) return;
      await applyPdfOperation("ocr", { language: "chi_tra+eng", dpi: 250 });
      return;
    }
    const definition = pdfToolDefinitions[tool];
    if (!definition) {
      $("#pdf-inline-status").textContent = "此功能已在同視窗工作區中，可從右側工具列選擇具體操作。";
      return;
    }
    const options = await requestPdfToolOptions(definition);
    if (!options) return;
    options.page = state.pdfPage;
    if (tool === "redact" && !window.confirm(`這會永久移除整份 PDF 內所有「${options.text}」。確定繼續嗎？`)) return;
    let output = null;
    if (tool === "encrypt") {
      output = await save({ defaultPath: "加密副本.pdf", filters: [{ name: "PDF 文件", extensions: ["pdf"] }] });
      if (!output) return;
    }
    const result = await applyPdfOperation(definition.operation, options, output);
    if (result?.matches !== undefined) toast(`處理完成，共找到 ${result.matches} 處。`, 8000);
  } catch (error) {
    $("#pdf-inline-status").textContent = `操作未完成：${error}`;
    toast(`PDF 操作未完成：${error}`, 10000);
  }
}

async function loadPdfReport(path, shouldScroll = false) {
  try {
    const report = await invoke("pdf_report", { path });
    state.pdfReport = report;
    $("#pdf-current").classList.remove("hidden");
    $("#pdf-report-title").textContent = report.file_name;
    const stats = [
      [report.pages, "頁數"],
      [Number(report.characters).toLocaleString("zh-TW"), "非空白字元"],
      [report.text_pages, "文字頁"],
      [report.scanned_pages, "掃描頁"],
      [report.images, "影像"],
      [report.form_fields, "表單欄位"],
    ];
    $("#pdf-stats").innerHTML = stats.map(([value, label]) => `<div><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span></div>`).join("");
    const content = [
      ["單字／詞組", Number(report.words).toLocaleString("zh-TW")],
      ["書籤", report.bookmarks],
      ["連結", report.links],
      ["旋轉頁", report.rotated_pages],
      ["頁面尺寸", report.page_sizes.join("、") || "未取得"],
      ["文件標題", report.metadata?.title || "未設定"],
    ];
    $("#pdf-content-metrics").innerHTML = content.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>`).join("");
    const interactive = [
      ["註解", report.annotations],
      ["表單欄位", report.form_fields],
      ["簽名欄", report.signature_fields],
      ["附件", report.attachments],
      ["加密", report.encrypted ? "是" : "否"],
      ["PDF 格式", report.metadata?.format || "未取得"],
    ];
    $("#pdf-interactive-metrics").innerHTML = interactive.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><b>${escapeHtml(String(value))}</b></div>`).join("");
    const warnings = report.warnings?.length ? report.warnings : ["未發現需要立即處理的結構提醒。"];
    $("#pdf-warnings").innerHTML = warnings.map((warning) => `<div class="word-warning"><span>${report.warnings?.length ? "提醒" : "通過"}</span><p>${escapeHtml(warning)}</p></div>`).join("");
    if (shouldScroll) $("#pdf-current").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    $("#pdf-current").classList.add("hidden");
    toast(`PDF 文件檢查失敗：${error}`, 8000);
  }
}

async function runPdfLiveCheck(path = state.selectedPath) {
  if (!isPdfPath(path)) return;
  const button = $("#pdf-live-check");
  const original = button.textContent;
  button.disabled = true;
  button.textContent = "正在渲染與往返驗證…";
  try {
    const result = await invoke("pdf_live_validate", { path });
    if (!result.passed) throw new Error(result.reason || "PDF LIVE 驗證未通過");
    toast(`PDF LIVE 驗證通過：渲染 ${result.rendered_pages} 頁，重新封裝 ${Number(result.roundtrip_bytes).toLocaleString("zh-TW")} 位元組並成功再開啟。`, 10000);
  } catch (error) {
    toast(`PDF LIVE 驗證失敗：${error}`, 9000);
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
  result.textContent = "正在本機擷取文件文字並交給 MAGI；文件不會上傳到任何外部文件伺服器…";
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
$("#word-shortcuts").addEventListener("click", openShortcutCatalog);
$("#shortcut-search").addEventListener("input", renderShortcutCatalog);
$("#shortcut-close").addEventListener("click", () => $("#shortcut-dialog").close());
$("#shortcut-dialog").addEventListener("click", (event) => {
  if (event.target === $("#shortcut-dialog")) $("#shortcut-dialog").close();
});
$("#repair-onlyoffice-tw").addEventListener("click", repairOnlyOfficeTraditionalChinese);
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
function selectPdfTab(button, focus = false) {
  state.pdfTab = button.dataset.pdfTab;
  renderPdfTab();
  if (focus) button.focus();
}

$$('[data-pdf-tab]').forEach((button) => {
  button.addEventListener("click", () => selectPdfTab(button));
  button.addEventListener("keydown", (event) => {
    const tabs = $$('[data-pdf-tab]');
    const current = tabs.indexOf(button);
    let target = null;
    if (event.key === "ArrowRight") target = tabs[(current + 1) % tabs.length];
    if (event.key === "ArrowLeft") target = tabs[(current - 1 + tabs.length) % tabs.length];
    if (event.key === "Home") target = tabs[0];
    if (event.key === "End") target = tabs[tabs.length - 1];
    if (!target) return;
    event.preventDefault();
    selectPdfTab(target, true);
  });
});
$("#open-pdf-document").addEventListener("click", choosePdfDocument);
$("#create-pdf-document").addEventListener("click", createBlankPdf);
$("#pdf-edit").addEventListener("click", async () => {
  const path = await ensurePdfDocument();
  if (!path) return;
  openPdfWorkspace(path, "tools").catch((error) => toast(String(error), 8000));
});
$("#pdf-inline-close").addEventListener("click", () => $("#pdf-inline-workspace").classList.add("hidden"));
$("#pdf-page-previous").addEventListener("click", () => renderPdfPage(state.pdfPage - 1));
$("#pdf-page-next").addEventListener("click", () => renderPdfPage(state.pdfPage + 1));
$("#pdf-page-number").addEventListener("change", (event) => {
  const page = Math.min(Math.max(1, Number(event.target.value) || 1), Math.max(1, state.pdfPages));
  renderPdfPage(page - 1);
});
$("#pdf-zoom-out").addEventListener("click", () => {
  state.pdfZoom = Math.max(0.35, Math.round((state.pdfZoom - 0.15) * 100) / 100);
  renderPdfPage();
});
$("#pdf-zoom-in").addEventListener("click", () => {
  state.pdfZoom = Math.min(3, Math.round((state.pdfZoom + 0.15) * 100) / 100);
  renderPdfPage();
});
$("#pdf-zoom-fit").addEventListener("click", () => {
  const available = Math.max(360, $("#pdf-canvas-viewport").clientWidth - 64);
  state.pdfZoom = Math.min(3, Math.max(0.35, Math.round((available / 595) * 100) / 100));
  renderPdfPage();
});
$$('[data-pdf-operation]').forEach((button) => button.addEventListener("click", () => runEmbeddedPdfTool(button.dataset.pdfOperation)));
$("#pdf-live-check").addEventListener("click", () => runPdfLiveCheck());
$("#pdf-report-refresh").addEventListener("click", () => isPdfPath(state.selectedPath) && loadPdfReport(state.selectedPath, true));
$("#open-primary").addEventListener("click", async () => {
  try {
    if (isPdfPath(state.selectedPath)) {
      await openPdfWorkspace(state.selectedPath, "tools");
      return;
    }
    const result = await invoke("backup_and_open", { path: state.selectedPath, engine: state.selectedAnalysis.preferred_engine });
    toast(result.message);
  } catch (error) { toast(String(error)); }
});
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

window.addEventListener("keydown", (event) => {
  if (!(event.altKey && event.shiftKey && (event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase("zh-TW") === "r")) return;
  event.preventDefault();
  if (!state.selectedPath || !/\.doc[mx]$/i.test(state.selectedPath)) {
    toast("請先在 Word 文件中心選擇 DOCX／DOCM，再按 ⌥⇧⌘R 或 Ctrl+Alt+Shift+R 安全重編標題。", 8000);
    return;
  }
  renumberCurrentWord();
});

renderRecent(); renderFeatures(); renderWordTab(); renderPdfTab(); loadStatus();
