# Word 功能差距稽核（2026-07-30）

本稽核以 Microsoft 公開的 Word 桌面版功能表為基準，再逐項比對全能文件工作台、隨附的 ONLYOFFICE Desktop Editors、LibreOffice 救援路徑與目前自動測試。這裡的「缺少」是指使用者在本專案的預設流程中不能完成相同工作；不代表 DOCX 內容一定會遺失。

狀態：

- **完整／可驗證**：目前流程可直接完成，且已有自動或 LIVE 驗證。
- **部分**：引擎有部分能力、需要改走另一套程式，或只能保留既有內容。
- **缺少**：預設安裝沒有等價工作流程。
- **專有／排除**：依賴 Microsoft 服務、Windows Office 物件模型或封閉元件。

## 結論

一般 DOCX 編輯、頁面配置、表格／圖片、目錄、註腳／尾註、標號、交互參照、追蹤修訂、比較合併、密碼與限制編輯，已可由工作台與 ONLYOFFICE 完成。2.7.7 已完成動態文字等距分布、新細明體／細明體、巢狀下引號與格式複製。2.8.0 進一步把稽核中可用開放介面完成的缺口落實為真正操作：補正 `Ctrl+Q` 語意並加入大小寫、重複、跳頁／書籤、日期／時間／頁碼、欄位更新、註腳／尾註等 Word 相容快捷鍵；每 15 秒擷取編輯器記憶體中的富文字 HTML 草稿；大綱可連同所屬內容上下移動或改變層級；合併列印支援 IF、Ask、Fill-in、Set、MergeRec／MergeSeq、Skip／Next Record If；引文與書目改為含來源 ID 的可更新內容控制項；無障礙與台灣文件交付前校閱也擴充為可操作檢查。

2.8.1 進一步修正表格內的文字等距分布：窄欄、合併儲存格、儲存格內距與段落縮排均按實際內容寬度排版，並以不新增換行的自動回縮避免末字突出。

2.8.2 修正等距段落的刷新時機：普通打字與點擊不再觸發全文件清除、重套字距；打字只會原地更新目前段落的一次動態字距，視窗尺寸變更或實際拖曳欄寬／尺規後才進行一次防重入完整排版。

2.8.3 修正 macOS 實機格式複製：ONLYOFFICE 的 AppKit 系統顏色面板原先會在 WebView 收到按鍵前攔截 `⇧⌘C`。工作台現在於啟動前只替 ONLYOFFICE 移開該原生選單快捷鍵並保留備份，外掛則在 window capture 階段依實體 `KeyC／KeyV` 接管 `⇧⌘C／⇧⌘V`，繁中輸入法亦可使用。

2.8.4 修正 macOS 26 的 LibreOffice 背景轉檔崩潰：即使使用 `--headless`，LibreOffice 仍會載入 macOS VCL／AppKit；由受限背景程序直接執行 App bundle 內的 `soffice` 會在 `HIServices::_RegisterApplication` 中止。工作台現在只透過 LaunchServices 建立隱藏的新 instance，並先把來源複製到隔離暫存區、完成後再由工作台寫回目的地，避免 AppKit 註冊失敗、資料夾權限提示與既有 LibreOffice 工作階段互相干擾。

原 P0 缺口已都有可操作流程及自動測試。仍需誠實區分的是：富文字草稿復原不是完整 DOCX 二進位快照；單份上限 2.5 MB，複雜內嵌物件、頁面設定與巨集仍以已儲存檔案／編輯引擎自己的復原為準。完整音訊轉錄、雲端註解反應／通知、Microsoft 365 即時共同編輯與專有安全服務也沒有純單機等價介面。

## 逐類盤點

| Word 工作類別 | 本專案狀態 | 已有能力 | 仍有差距 |
| --- | --- | --- | --- |
| 檔案與輸出 | 完整／可驗證 | DOCX、ODT、RTF 開啟與儲存，列印、PDF、備份、文件結構報告；每 45 秒保存已寫入檔案，2.8.0 另每 15 秒保存最多 12 份記憶體富文字草稿 | 富文字草稿不包含完整 DOCX 套件、巨集與所有內嵌物件；每份上限 2.5 MB |
| 字型與段落 | 完整／可驗證 | 常用字元格式、樣式、行距、定位點、格式複製；依每行頁面／儲存格／縮排寬度動態重排，存檔清除暫時字距並寫回 `w:jc="distribute"`；Ctrl／Command+Shift+C/V 以真實粗體來源與目標文字 LIVE 驗證；2.8.3 另驗證 macOS `NSUserKeyEquivalents` 已解除顏色面板衝突；macOS 從本機已授權 Microsoft Office 註冊新細明體／細明體 | 沒有已授權 Microsoft Office 字型來源的電腦會以替代字型顯示，但 DOCX 仍保留要求的家族名稱 |
| 台灣中文寫作 | 完整／可驗證 | 台灣標點、成對符號、中文標題安全重編、巢狀下引號；2.8.0 另檢查未解決占位符、成對標點、半形中文標點、異常空白、超長句、待辦字樣、常見陸用詞及重複文字，並提供四種繁中範本 | 法規引註的法律效力與各機關個別格式仍須人工確認 |
| 頁面與列印版面 | 完整／可驗證 | 邊界、方向、紙張、分欄、分頁／分節、頁首頁尾、頁碼、背景與浮水印 | 不保證與 Microsoft 排版引擎逐像素相同；需以 PDF LIVE 結果驗收 |
| 長文件與參照 | 完整／部分 | 目錄、註腳／尾註、書籤、標題、圖表標號、圖表目錄與交互參照；本機來源庫、APA 7／MLA 9／Chicago／台灣格式；2.8.0 以來源 ID 保存並可重建內文引文與書目 | 尚未內建完整 CSL 樣式生態、Zotero／EndNote 雙向同步 |
| 校閱與比較 | 部分 | 註解、追蹤修訂、接受／拒絕、文件比較與合併；2.7.0 集中列出註解作者、日期與 `@` 指派 | 註解內圖片、表情反應、雲端工作指派／通知需要協作伺服器 |
| 郵件合併 | 完整／可驗證 | 直接選 DOCX 與 CSV／TSV，預覽、多種條件篩選、檔名欄位、個別 DOCX／PDF；IF、Ask、Fill-in、Set、MergeRec／MergeSeq、Skip／Next Record If 與 Word MERGEFIELD | 尚未直接寄送電子郵件；Next Record If 在個別文件輸出模式等同略過符合資料列 |
| 導覽與檢視 | 完整／部分 | 尋找取代、縮放、尺規、導覽、格式標記、多頁檢視；大綱可改變標題層級並連同所屬內容上下移動另存，另有草稿／Web 與兩文件同步 | 同一文件上下分割並同時編輯仍由編輯引擎決定 |
| 無障礙 | 完整／部分 | 替代文字、表格標題／空白儲存格、語言、標題結構、連結文字、文件標題、表單標籤、直接文字色彩對比與大量定位字元風險；可安全另存修復確定項目 | 圖片描述、複雜浮動物件閱讀順序仍需人工；沉浸式閱讀器與點字硬體需作業系統／引擎驗證 |
| 語音與語言工具 | 完整／部分 | 拼字依編輯引擎；2.7.0 統一本機 MAGI 翻譯、改寫、同義詞、相似度，並顯示 macOS／Windows 繁中聽寫入口 | 本機 MAGI 尚未暴露音訊轉錄模型，因此不顯示假的逐字稿按鈕 |
| 物件與媒體 | 部分 | 表格、圖片、圖形、文字方塊、圖表、公式、符號、連結；2.7.0 可建立封面、AutoText 及可編輯流程／階層／矩陣圖解 | OLE、真正 SmartArt 資料模型、3D、音訊／視訊嵌入仍只能由相容引擎保留或處理 |
| 安全與簽署 | 完整／部分 | ONLYOFFICE Desktop 可設定開啟密碼、限制編輯、簽章與簽名欄；工作台另有 PDF 保護／簽署 | Microsoft IRM／Purview、敏感度標籤與組織權限原則屬專有能力 |
| 自動化與增益集 | 專有／排除 | ONLYOFFICE 可執行自己的 JavaScript 巨集與外掛 | VBA、ActiveX、COM／VSTO、Office.js 專用增益集與 Windows Office 物件模型不是等價執行環境 |
| 雲端協作與版本 | 專有／部分 | 工作台有本機備份；ONLYOFFICE 引擎本身具協作協定 | 本專案沒有部署文件伺服器／入口網站，因此沒有即時共同編輯、雲端版本歷程、分享連結、留言通知與 Microsoft 365 整合 |

## 2.8.0 完成項目與剩餘界線

2.7.2 將新增文字文件、試算表與簡報改為 ONLYOFFICE 原生未命名文件流程：點擊新增後立即開啟，第一次按儲存或另存新檔時才選擇檔名、格式與儲存位置。

2.7.1 修正 macOS 背景環境中的 LibreOffice 啟動問題：引擎版本改由 App 的 `Info.plist` 讀取，不再執行 `soffice --version`；Codex 受限背景環境也會在任何 LibreOffice 轉檔前停止，只有取得使用者明確允許並設定專用旗標後才可執行完整 LIVE 測試。

2.8.0 完成稽核後的開放等價補強：富文字未存草稿、Word 快捷鍵語意、可編輯大綱、完整條件合併、動態引文／書目、擴充無障礙檢查、台灣交付前校閱，以及機關函稿、法律書狀、會議紀錄、結構化報告四種範本。

### 原 P0：已完成可操作流程

1. 工作階段復原：已完成磁碟快照清單、持續更新、另存復原，以及每 15 秒最多 12 份的記憶體富文字草稿。
2. 整合式郵件合併：已完成資料預覽、多種篩選、跨 OOXML 文字節點／Word 欄位替換、條件規則、DOCX／PDF、信件／信封／標籤範本。
3. 無障礙檢查器：已涵蓋替代文字、表格、語言、標題結構、連結、表單標籤、色彩對比與閱讀順序風險；不可推測內容不自動亂填。
4. 引用／書目來源管理：已完成本機來源庫、四種常用格式、含來源 ID 的動態內文引文與可更新書目區塊。

### 原 P1：已完成實用開放等價，專有部分維持界線

1. 可編輯大綱、草稿／Web 與並排同步已完成；仍不假裝是同一文件的雙編輯視窗。
2. 註解作者、日期與 `@` 指派清單已完成；圖片、反應與雲端通知保留給協作平台。
3. 系統繁中聽寫、MAGI 翻譯／改寫／同義詞／相似度已統一；音訊轉錄待 MAGI 提供本機端點。
4. 封面頁、AutoText 已完成；原生文件屬性欄位與完整樣式集仍由編輯器處理。
5. 可編輯流程、階層、矩陣圖解已完成；不把開放式圖解冒充 Microsoft SmartArt。

### 不建議宣稱等價

VBA／ActiveX／COM／VSTO、Microsoft 365 Copilot、IRM／Purview、SharePoint 工作流程及 Microsoft 雲端即時協作均依賴封閉平台。正確做法是辨識、保留原檔並清楚警示，而不是顯示一個無法真正執行的按鈕。

## 主要比對來源

- [Microsoft：Word 網頁版與桌面版功能比較](https://support.microsoft.com/en-US/Word/word-features-comparison-word-for-the-web-vs-desktop)
- [Microsoft：Word 2024 for Windows and Mac 新功能](https://support.microsoft.com/en-US/Word/what-s-new-in-word-2024-for-windows-and-mac)
- [ONLYOFFICE：Document Editor 使用指南索引](https://helpcenter.onlyoffice.com/docs/userguides/document_editor)
- [ONLYOFFICE：References 分頁](https://helpcenter.onlyoffice.com/docs/userguides/document_editor/ReferencesTab.aspx)
- [ONLYOFFICE：比較與合併文件](https://helpcenter.onlyoffice.com/docs/userguides/document_editor/comparison.aspx)
- [ONLYOFFICE：郵件合併（文件註明僅線上版）](https://helpcenter.onlyoffice.com/docs/userguides/document_editor/UseMailMerge.aspx)
- [ONLYOFFICE：文件密碼、限制編輯與桌面簽章](https://helpcenter.onlyoffice.com/docs/userguides/document_editor/Password.aspx)
- [ONLYOFFICE：螢幕閱讀器支援](https://helpcenter.onlyoffice.com/docs/userguides/accessibility/screen-reader.aspx)
