# Word 功能差距稽核（2026-07-24）

本稽核以 Microsoft 公開的 Word 桌面版功能表為基準，再逐項比對全能文件工作台、隨附的 ONLYOFFICE Desktop Editors、LibreOffice 救援路徑與目前自動測試。這裡的「缺少」是指使用者在本專案的預設流程中不能完成相同工作；不代表 DOCX 內容一定會遺失。

狀態：

- **完整／可驗證**：目前流程可直接完成，且已有自動或 LIVE 驗證。
- **部分**：引擎有部分能力、需要改走另一套程式，或只能保留既有內容。
- **缺少**：預設安裝沒有等價工作流程。
- **專有／排除**：依賴 Microsoft 服務、Windows Office 物件模型或封閉元件。

## 結論

一般 DOCX 編輯、頁面配置、表格／圖片、目錄、註腳／尾註、標號、交互參照、追蹤修訂、比較合併、密碼與限制編輯，已可由工作台與 ONLYOFFICE 完成。2.6.1 另修正三個會直接影響台灣文件工作的缺口：真正填滿行寬的相容分散對齊、`PMingLiU`／`MingLiU` 精確字型選取、依巢狀前文即時決定 `」`／`』`。

目前最值得繼續補的是「當機後未儲存工作階段復原」、「桌面版整合郵件合併／信封／標籤」、「可操作的無障礙檢查器」及「書目來源管理器」。這些比複製 Word 外觀更影響實際交付。

## 逐類盤點

| Word 工作類別 | 本專案狀態 | 已有能力 | 仍有差距 |
| --- | --- | --- | --- |
| 檔案與輸出 | 完整／可驗證 | DOCX、ODT、RTF 開啟與儲存，列印、PDF、備份、文件結構報告 | 尚未做到 Word 2024 的「程式異常關閉後自動重開所有未儲存工作階段」 |
| 字型與段落 | 完整／可驗證 | 常用字元格式、樣式、行距、定位點、格式複製；2.6.1 新增逐行實際寬度分散與新細明體／細明體精確名稱 | 未安裝原字型的電腦仍以替代字型顯示，但 DOCX 會保留要求的家族名稱 |
| 台灣中文寫作 | 完整／可驗證 | 台灣標點、成對符號、中文標題安全重編；2.6.1 即時判斷巢狀下引號 | 尚無完整台灣公文用語、法規引註與機關格式規則檢查器 |
| 頁面與列印版面 | 完整／可驗證 | 邊界、方向、紙張、分欄、分頁／分節、頁首頁尾、頁碼、背景與浮水印 | 不保證與 Microsoft 排版引擎逐像素相同；需以 PDF LIVE 結果驗收 |
| 長文件與參照 | 部分 | 目錄、註腳／尾註、書籤、標題、圖表標號、圖表目錄與交互參照可由 ONLYOFFICE 使用 | 缺少 Word 等級的內建引用來源資料庫、引用樣式與參考書目管理；需外掛或人工流程 |
| 校閱與比較 | 部分 | 註解、追蹤修訂、接受／拒絕、文件比較與合併 | 沒有與 Microsoft 365 完全等價的現代註解反應、註解內圖片、雲端指派／通知 |
| 郵件合併 | 部分 | 可改走 LibreOffice；ONLYOFFICE 線上版具郵件合併 | ONLYOFFICE 桌面版沒有該功能，工作台也沒有單一整合介面；信封、標籤與收件人篩選流程仍不完整 |
| 導覽與檢視 | 部分 | 尋找取代、縮放、尺規、導覽、格式標記、多頁檢視、多文件頁籤 | 缺少 Word 的草稿／大綱／網頁版面、並排同步捲動及同文件分割視窗等完整檢視組合 |
| 無障礙 | 部分 | 文件報告提供替代文字、標題、語言等提醒；ONLYOFFICE 支援 VoiceOver／NVDA／JAWS 等螢幕閱讀器 | 沒有 Word 等級的一鍵無障礙檢查結果、問題定位與修復建議；也沒有沉浸式閱讀器、點字顯示整合驗證 |
| 語音與語言工具 | 部分 | 拼字與語言功能依引擎；MAGI 可做摘要、校對、結構與風險分析 | 缺少 Word Editor 的相似度檢查／改寫建議、完整同義詞庫、聽寫、轉錄與整份文件翻譯的統一流程 |
| 物件與媒體 | 部分 | 表格、圖片、圖形、文字方塊、圖表、公式、符號、連結 | OLE 嵌入物件、完整 SmartArt、3D 模型、螢幕擷取、音訊／視訊嵌入、封面頁與 Quick Parts 仍缺少或只能保留 |
| 安全與簽署 | 完整／部分 | ONLYOFFICE Desktop 可設定開啟密碼、限制編輯、簽章與簽名欄；工作台另有 PDF 保護／簽署 | Microsoft IRM／Purview、敏感度標籤與組織權限原則屬專有能力 |
| 自動化與增益集 | 專有／排除 | ONLYOFFICE 可執行自己的 JavaScript 巨集與外掛 | VBA、ActiveX、COM／VSTO、Office.js 專用增益集與 Windows Office 物件模型不是等價執行環境 |
| 雲端協作與版本 | 專有／部分 | 工作台有本機備份；ONLYOFFICE 引擎本身具協作協定 | 本專案沒有部署文件伺服器／入口網站，因此沒有即時共同編輯、雲端版本歷程、分享連結、留言通知與 Microsoft 365 整合 |

## 建議的後續優先順序

### P0：會造成工作遺失或阻斷大量文件作業

1. 工作階段／未儲存文件復原：記錄開啟文件、定期建立可辨識的恢復副本，重新啟動時提供復原清單。
2. 整合式郵件合併：在工作台內選資料來源、篩選收件人、預覽並輸出個別 DOCX／PDF；另補信封與標籤版型。
3. 無障礙檢查器：把標題層級、替代文字、表格標題列、連結文字、閱讀順序與文件語言轉成可點擊修復清單。
4. 引用／書目來源管理：提供來源資料庫、常用 CSL 樣式、插入引用及更新參考書目。

### P1：提升 Word 重度使用者轉換率

1. 大綱／草稿／網頁版面與並排同步檢視。
2. 註解圖片、反應、工作指派與本機通知。
3. 聽寫、音訊轉錄、翻譯、同義詞與相似度檢查的統一入口。
4. 封面頁、Quick Parts／AutoText、文件屬性欄位與樣式集管理。
5. SmartArt 的建立與完整編輯，而不只是保留或轉成一般圖形。

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
