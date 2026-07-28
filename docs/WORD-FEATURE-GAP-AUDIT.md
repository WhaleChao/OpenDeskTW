# Word 功能差距稽核（2026-07-24）

本稽核以 Microsoft 公開的 Word 桌面版功能表為基準，再逐項比對全能文件工作台、隨附的 ONLYOFFICE Desktop Editors、LibreOffice 救援路徑與目前自動測試。這裡的「缺少」是指使用者在本專案的預設流程中不能完成相同工作；不代表 DOCX 內容一定會遺失。

狀態：

- **完整／可驗證**：目前流程可直接完成，且已有自動或 LIVE 驗證。
- **部分**：引擎有部分能力、需要改走另一套程式，或只能保留既有內容。
- **缺少**：預設安裝沒有等價工作流程。
- **專有／排除**：依賴 Microsoft 服務、Windows Office 物件模型或封閉元件。

## 結論

一般 DOCX 編輯、頁面配置、表格／圖片、目錄、註腳／尾註、標號、交互參照、追蹤修訂、比較合併、密碼與限制編輯，已可由工作台與 ONLYOFFICE 完成。2.6.2 修正可寫回 OOXML 的原生分散對齊、`PMingLiU`／`MingLiU` 精確字型選取及巢狀下引號；2.7.0 再把工作階段快照、整合式合併列印、無障礙檢查／安全修復、引文書目、大綱／草稿／Web、並排同步、語言工具、封面、AutoText 與開放式圖解納入工作台。

原 P0 缺口已都有可操作流程及自動測試。仍需誠實區分的是：工作階段快照只能保護編輯器已寫入檔案的內容，編輯器尚留在記憶體且從未寫入磁碟的字元仍由 ONLYOFFICE／LibreOffice 自己的復原機制負責；完整音訊轉錄、雲端註解反應／通知、真正 Microsoft SmartArt 編輯器及 Microsoft 365 服務也沒有開放的本機等價介面。

## 逐類盤點

| Word 工作類別 | 本專案狀態 | 已有能力 | 仍有差距 |
| --- | --- | --- | --- |
| 檔案與輸出 | 完整／可驗證 | DOCX、ODT、RTF 開啟與儲存，列印、PDF、備份、文件結構報告；2.7.0 記錄開啟工作階段、每 45 秒比對已寫入變更，重啟後可另存最新快照 | 從未寫入磁碟的編輯器記憶體內容仍依賴編輯引擎本身的復原機制 |
| 字型與段落 | 完整／可驗證 | 常用字元格式、樣式、行距、定位點、格式複製；2.6.2 新增原生 OOXML `distribute` 段落值與新細明體／細明體精確名稱 | 未安裝原字型的電腦仍以替代字型顯示，但 DOCX 會保留要求的家族名稱 |
| 台灣中文寫作 | 完整／可驗證 | 台灣標點、成對符號、中文標題安全重編；2.6.2 即時判斷巢狀下引號 | 尚無完整台灣公文用語、法規引註與機關格式規則檢查器 |
| 頁面與列印版面 | 完整／可驗證 | 邊界、方向、紙張、分欄、分頁／分節、頁首頁尾、頁碼、背景與浮水印 | 不保證與 Microsoft 排版引擎逐像素相同；需以 PDF LIVE 結果驗收 |
| 長文件與參照 | 完整／部分 | 目錄、註腳／尾註、書籤、標題、圖表標號、圖表目錄與交互參照；2.7.0 有本機來源庫、內文引文及 APA 7／MLA 9／Chicago／台灣書目 | 尚未內建完整 CSL 樣式生態、Zotero／EndNote 雙向同步 |
| 校閱與比較 | 部分 | 註解、追蹤修訂、接受／拒絕、文件比較與合併；2.7.0 集中列出註解作者、日期與 `@` 指派 | 註解內圖片、表情反應、雲端工作指派／通知需要協作伺服器 |
| 郵件合併 | 完整／可驗證 | 直接選 DOCX 與 CSV／TSV，預覽、文字篩選、檔名欄位、個別 DOCX／PDF；可建立信件、信封及標籤範本 | 尚未直接寄送電子郵件，也未實作 Word 全部條件規則 |
| 導覽與檢視 | 完整／部分 | 尋找取代、縮放、尺規、導覽、格式標記、多頁檢視；2.7.0 加入大綱／草稿／Web 及兩文件並排同步 | 工作台檢視為安全唯讀；同一文件上下分割並同時編輯仍由編輯引擎決定 |
| 無障礙 | 完整／部分 | 逐項定位替代文字、表格標題列、語言、標題跳級、連結文字及文件標題；可安全另存修復確定項目 | 圖片描述、閱讀順序仍需人工；沉浸式閱讀器與點字硬體需作業系統／引擎驗證 |
| 語音與語言工具 | 完整／部分 | 拼字依編輯引擎；2.7.0 統一本機 MAGI 翻譯、改寫、同義詞、相似度，並顯示 macOS／Windows 繁中聽寫入口 | 本機 MAGI 尚未暴露音訊轉錄模型，因此不顯示假的逐字稿按鈕 |
| 物件與媒體 | 部分 | 表格、圖片、圖形、文字方塊、圖表、公式、符號、連結；2.7.0 可建立封面、AutoText 及可編輯流程／階層／矩陣圖解 | OLE、真正 SmartArt 資料模型、3D、音訊／視訊嵌入仍只能由相容引擎保留或處理 |
| 安全與簽署 | 完整／部分 | ONLYOFFICE Desktop 可設定開啟密碼、限制編輯、簽章與簽名欄；工作台另有 PDF 保護／簽署 | Microsoft IRM／Purview、敏感度標籤與組織權限原則屬專有能力 |
| 自動化與增益集 | 專有／排除 | ONLYOFFICE 可執行自己的 JavaScript 巨集與外掛 | VBA、ActiveX、COM／VSTO、Office.js 專用增益集與 Windows Office 物件模型不是等價執行環境 |
| 雲端協作與版本 | 專有／部分 | 工作台有本機備份；ONLYOFFICE 引擎本身具協作協定 | 本專案沒有部署文件伺服器／入口網站，因此沒有即時共同編輯、雲端版本歷程、分享連結、留言通知與 Microsoft 365 整合 |

## 2.7.x 完成項目與剩餘優先順序

2.7.1 修正 macOS 背景環境中的 LibreOffice 啟動問題：引擎版本改由 App 的 `Info.plist` 讀取，不再執行 `soffice --version`；Codex 受限背景環境也會在任何 LibreOffice 轉檔前停止，只有取得使用者明確允許並設定專用旗標後才可執行完整 LIVE 測試。

### 原 P0：已完成可操作流程

1. 工作階段復原：已完成快照清單、持續更新、另存復原與完成標記。
2. 整合式郵件合併：已完成資料預覽、篩選、跨 OOXML 文字節點欄位替換、DOCX／PDF、信件／信封／標籤範本。
3. 無障礙檢查器：已完成六類定位與三類安全自動修復；不可推測的替代文字不自動亂填。
4. 引用／書目來源管理：已完成本機來源庫、四種常用格式、內文引文複製及可更新書目區塊。

### 原 P1：已完成實用開放等價，專有部分維持界線

1. 大綱／草稿／Web 與並排同步已完成；仍不假裝是同一文件的雙編輯視窗。
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
