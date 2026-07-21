# OpenDesk TW

OpenDesk TW 是 Windows／macOS 單機文件工作台：用一個全繁體中文介面管理本機開源 Office 引擎，針對 Office 格式優先使用 ONLYOFFICE，舊格式、開放文件格式、救援與 PDF 轉檔使用 LibreOffice，並整合本機 MAGI V2／V3 AI 助理。

2.0 版位於 `cross-platform/`，以同一套 Tauri 2／Rust 核心產生 macOS App／DMG 與 Windows MSI／NSIS 安裝程式；`Sources/OpenDeskTW/` 保留功能較深的 macOS 原生版。兩者都不會取代或繞過 Microsoft 授權，而是以開源桌面編輯器處理使用者自己的文件。

## 核心能力

- 首頁可一鍵新增具完整 OOXML 結構的 DOCX、XLSX、PPTX；建立前先選檔名與位置，完成後直接進入編輯器。
- 最近文件保留最多 12 筆，按一下會先執行相容性檢查與版本備份，再繼續編輯；清除清單不會刪除原始文件。
- 可展開的「完整功能中心」整理文字、試算表、簡報、PDF、救援與安全功能，也明列 Microsoft 專屬能力的相容性界線。
- 內建「完整 Office 相容性自我檢查」：隨附高複雜度 DOCX、XLSX、PPTX 測試檔，逐項檢查 OOXML 結構、兩套本機引擎、實檔讀取、PDF 可搜尋文字及 MAGI V2／V3 契約，並保存繁體中文 JSON 報告。
- DOCX、XLSX、PPTX、PDF、ODF 與舊版 Office 文件路由。
- 開啟前自動建立版本備份；巨集、ActiveX 等高風險文件另建唯讀安全副本。
- 掃描 OOXML 內的 VBA、ActiveX、外部連線、嵌入物件、SmartArt、樞紐分析與缺少字型。
- 自動辨識〔壹、〕、〔一、〕、（一）、1. 等中文標題層級，備份後建立套用標題一至四的重新編號副本。
- 顯示 Office 字型到開源相容字型的替代關係（例如 Calibri → Carlito）。
- 文件結構、字型排版、安全與備份由「本機文件健檢」獨立判定，不會冒充 AI 結果。
- MAGI 相容層會辨識目前唯一運作的 V2 或 V3，唯讀檢查主服務、工具服務、分享閘道及管理服務。
- 若目前為 V2，會離線驗證磁碟上的 V3 完成版、V2 路由與 V2／V3 回應封套；驗證時不啟動 V3。
- 「MAGI 文件分析」會在使用者按下按鈕後擷取 DOCX、XLSX、PPTX 內容，直接呼叫目前唯一啟用的本機 MAGI，並把結果顯示在 OpenDesk TW 內，不會自動跳到網頁。
- 提供完整分析、內容摘要、校對與風險、排版與結構四種模式，也能附加自訂要求；結果可選取與複製。
- 「MAGI 網頁」另行保留為完整主控台入口；一般文件分析不會再自動跳到網頁。
- 透過本機 LibreOffice 進行無雲端 PDF 匯出。
- 所有文件都留在本機；啟動器本身不含遙測或登入功能。

## Windows／macOS 2.0 建置

需求：Node.js 22、Rust stable、Tauri 2 的平台前置需求，以及獨立安裝的 ONLYOFFICE Desktop Editors、LibreOffice。

```bash
cd cross-platform
npm ci
npm run check
npm run build
```

- macOS 輸出：`cross-platform/src-tauri/target/release/bundle/macos` 與 `bundle/dmg`
- Windows 輸出：`cross-platform/src-tauri/target/release/bundle/msi` 與 `bundle/nsis`
- 推送 `v*` tag 後，GitHub Actions 會在兩個原生 runner 打包並產生簽章熱修資訊。

更新私鑰不得提交至儲存庫；詳見 `docs/HOTFIX.md`。

## macOS 原生版建置

需求：macOS 14 以上、Swift 5.10 以上、ONLYOFFICE Desktop Editors、LibreOffice。

```bash
chmod +x scripts/build_app.sh
scripts/build_app.sh
```

輸出位於 `dist/OpenDesk TW.app`。

## 2.0 驗證

```bash
cd cross-platform
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo test --manifest-path src-tauri/Cargo.toml --lib live_complete_office_pipeline -- --ignored --nocapture
```

第二行是 LIVE 驗證，會實際檢查兩個編輯引擎、三種 OOXML、備份讀回、PDF 轉換與目前唯一運作的 MAGI V2／V3。GitHub runner 沒有桌面引擎與 MAGI，因此 CI 只執行不依賴本機環境的測試。

## 原生版驗證工具

```bash
.build/debug/OpenDeskTW --health
.build/debug/OpenDeskTW --route 文件.docx
.build/debug/OpenDeskTW --scan 文件.docx
.build/debug/OpenDeskTW --document-health 文件.docx
.build/debug/OpenDeskTW --magi-status
.build/debug/OpenDeskTW --extract-text 文件.docx
.build/debug/OpenDeskTW --magi-analyze 文件.docx summary
.build/debug/OpenDeskTW --backup 文件.docx
.build/debug/OpenDeskTW --create-document text 新文件.docx
.build/debug/OpenDeskTW --create-document spreadsheet 新試算表.xlsx
.build/debug/OpenDeskTW --create-document presentation 新簡報.pptx
.build/debug/OpenDeskTW --headings 文件.docx
.build/debug/OpenDeskTW --renumber-headings 文件.docx
.build/debug/OpenDeskTW --convert-pdf 文件.docx 輸出資料夾
.build/debug/OpenDeskTW --office-self-test
```

完整 LIVE 測試可執行 `scripts/live_verify.sh`，它會建立 DOCX／XLSX／PPTX 樣本，驗證中文標題重編、公式回算、OOXML 結構、三種 PDF 匯出、MAGI V2 實際文件分析、V3 離線相容契約與 App 簽章。

較嚴格的完整功能矩陣可執行 `scripts/comprehensive_verify.sh`。它另外驗證 DOCX 四層樣式、目錄、自動中文編號、註腳／尾註、註解、追蹤修訂、書籤與欄位；XLSX 公式、命名範圍、表格、條件格式、資料驗證、圖表、保護與列印；PPTX 母片、投影片編號、圖表、表格、備忘稿、超連結與轉場，最後重新建置 App 並執行內建 47 項 LIVE 自我檢查。

## MAGI V2／V3 相容設計

OpenDesk TW 不管理 MAGI 的生命週期，不會執行啟動、停止、重啟或版本切換。它會辨識目前的執行程序，以共同的本機介面檢查 `5002` 主服務及 `5003` 工具服務，並只在使用者明確按下分析時呼叫 `5003/collab/chat`。若同時偵測到 V2 與 V3，會立即標示版本衝突並停止呼叫 MAGI，以遵守 MAGI 的單一啟用版本保護。

V3 尚未正式接管時，OpenDesk TW 只讀取候選版的完成標記、路由清冊與回應格式契約；等 V3 日後以冷切換成為唯一運作版本，介面會自動顯示 V3，仍沿用同一套操作。

## 編輯快捷鍵

文件編輯器保留 macOS 常用文字熱鍵，包括 ⌘B 粗體、⌘I 斜體、⌘U 底線、⌘C／⌘V 複製貼上、⌘Z 復原。格式刷位於 ONLYOFFICE 首頁工具列的「複製樣式」，也可用 ⌥⌘C 複製格式、⌥⌘V 套用格式；OpenDesk TW 的中文標題整理快捷鍵為 ⌥⌘R。

## 相容性界線

一般排版、字型、樣式、表格、目錄、註腳、頁碼、頁首頁尾、公式、圖表、工作表頁籤、樞紐分析、轉場、動畫、列印與 PDF 匯出都由原生編輯器提供。VBA、ActiveX、COM 增益集、IRM 權限、Microsoft 365 雲端共同編輯與部分複雜 SmartArt／3D 物件無法保證與 Microsoft Office 完全相同，會在開啟前明確警示並保留原檔。

本專案原生啟動器採 MIT License；編輯引擎維持各自授權與獨立安裝。
