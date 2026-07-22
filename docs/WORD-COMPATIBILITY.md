# Word 功能相容性盤點

OpenDesk TW 的目標是讓一般 Word 文件工作在全繁體中文、本機、可備份的流程中完成。它不複製 Microsoft 的封閉程式碼，而是把 ONLYOFFICE、LibreOffice、OpenDesk 繁中寫作工具、AcroPDF 與 MAGI V2／V3 組成一個單機工作台。

## 已提供的標準文件能力

| 類別 | 可用能力 | 主要位置 |
| --- | --- | --- |
| 檔案 | 新增、開啟、儲存、另存、列印、PDF 匯出、最近文件、版本備份 | OpenDesk／ONLYOFFICE／LibreOffice |
| 文字與格式 | 字型、字級、粗斜底線、上下標、醒目、色彩、格式複製、清除格式、樣式 | ONLYOFFICE「常用」 |
| 段落 | 左右置中、左右對齊、分散對齊、縮排、行距、段距、定位點、框線、底紋 | ONLYOFFICE「常用」／「OpenDesk TW」 |
| 中文寫作 | 巢狀 `）」「】〕》〉` 智慧補齊、台灣標點、〔壹、〕〔一、〕（一）與數字標題辨識／安全重編 | 「OpenDesk TW」／Word 文件中心 |
| 插入 | 表格、圖片、圖形、文字方塊、圖表、公式、符號、超連結、書籤、欄位、頁碼、頁首頁尾 | ONLYOFFICE「插入」 |
| 版面 | 紙張、方向、邊界、分欄、分頁、分節、頁面背景、浮水印、列印設定 | ONLYOFFICE「版面配置」 |
| 長文件 | 標題 1–4、目錄、文件地圖、註腳、尾註、圖表目錄、交互參照、合併欄位 | ONLYOFFICE／OpenDesk 文件報告 |
| 校閱 | 拼字與語言、字數、註解、回覆、追蹤修訂、接受／拒絕、文件比較、限制編輯 | ONLYOFFICE「校閱」 |
| 郵件 | 合併欄位、條件規則、預覽、個別文件／列印／PDF 輸出 | LibreOffice 救援路徑 |
| 導覽與物件 | 尋找取代、縮放、尺規、格式標記、多文件頁籤、表格鍵盤導覽、物件移動與縮放 | ONLYOFFICE／快捷鍵總覽 |
| 文件檢查 | 字型、目錄、頁碼、頁首頁尾、欄位、註解、修訂、巨集、外部連線、無障礙與送印提醒 | OpenDesk Word 文件中心 |
| PDF 與 AI | 可搜尋 PDF、PDF 編輯／OCR／保護／簽署，以及 MAGI V2／V3 摘要、校對、結構與風險分析 | AcroPDF／MAGI |

## 明確排除的 Microsoft 專有能力

Copilot、Microsoft 365 雲端共同編輯、IRM／Purview 權限、COM／VSTO 增益集、ActiveX、完整 VBA 執行環境，以及部分複雜 SmartArt、3D 模型與動作路徑沒有開放等價介面。OpenDesk 會保留原檔、掃描並警示這些內容，不會假裝已完整執行。

DOCX 的一般排版與結構相容度很高，但不同排版引擎、字型版本與印表機仍可能造成換行或分頁差異；重要交付檔應以 OpenDesk 的 PDF LIVE 驗證結果作為視覺基準。
