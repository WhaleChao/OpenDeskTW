# 全能文件工作台

「全能文件工作台」是一套全繁體中文、Windows／macOS 共用的單機文件 App。名稱直接表達用途：在同一個視窗處理文字、試算表、簡報、PDF 與 MAGI，不必先理解檔案格式或切換多套啟動器。

目前開發版為 2.4.0，主要程式位於 `cross-platform/`，以 Tauri 2、Rust 與原生 WebView 建置。

## 主要能力

- 文字文件：DOCX／DOCM 健康報告、標題地圖、字型與列印檢查、頁碼與頁首頁尾檢查、註解與修訂檢查。
- 台灣繁中寫作：ONLYOFFICE 固定 `zh-TW`、數字字級、分散對齊、智慧成對標點、台灣標點與可搜尋快捷鍵總覽。
- 中文標題安全重編：辨識〔壹、〕、〔一、〕、（一）與 `1.`，先備份再建立套用標題樣式的新副本。
- 試算表與簡報：使用 ONLYOFFICE 優先保留 OOXML；LibreOffice 負責舊格式、開放格式與救援轉檔。
- 同視窗 PDF：內建由 AcroPDF 核心整合的無視窗處理引擎，不啟動另一套 App，也不上傳文件。
- PDF 頁面：新增、插入、刪除、旋轉、合併、分割、擷取與重新排列。
- PDF 內容：搜尋與取代文字、加入文字、圖片替換／刪除、便利貼、自由文字、四種搜尋標記、圖形、測量、連結、書籤、圖層、附件、浮水印、頁首頁尾與自動頁碼。
- PDF 表單與簽章：建立與填寫欄位、JSON 匯入／匯出、扁平化、PFX／P12 數位簽章與完整性驗證。
- PDF 轉換：匯出 DOCX、XLSX、PPTX、TXT、HTML、PNG、JPEG；可列印、批次處理與依內容智慧歸檔。
- PDF 安全：AES-256 加密副本、永久遮蔽、最佳化、繁中 OCR、文件比較、印刷／無障礙稽核與 LIVE 往返驗證。
- MAGI：在主視窗內顯示分析結果，相容目前唯一運作的 MAGI V2 或 V3，不自行啟停 Agent。
- 安全熱修：只安裝通過 Tauri 更新公鑰驗證的更新包。

## 直覺工作流程

1. 選擇「新增」或「開啟」，不必先找引擎。
2. 工作台在本機檢查格式並建立版本備份。
3. Word／試算表／簡報交由適合的本機編輯引擎；PDF 留在主視窗內處理。
4. 交付前執行文件報告與 LIVE 驗證。

## PDF 內嵌架構

`cross-platform/src-tauri/resources/acropdf-core/embedded_core.py` 是無 GUI 的內建核心；正式建置時由 PyInstaller 封裝成 Tauri sidecar。主程式只透過結構化本機協定呼叫它，因此不會出現第二個視窗，也不需要使用者另外安裝 AcroPDF。核心第一次使用時啟動一次，後續翻頁、搜尋與修改共用常駐程序，避免每個動作重複載入大型 PDF 相依套件。

支援的本機協定包含狀態、報告、渲染、搜尋／稽核查詢、LIVE 驗證、PDF 操作、建立空白文件與文件比較。每次原檔修改前由 Rust 層先建立時間戳記備份，介面可立即復原最近一次操作。

## 建置

需求：

- Node.js 22
- Rust stable
- Python 3.11 以上
- PyInstaller、PyMuPDF、python-docx、openpyxl、python-pptx、pyHanko（含 ETSI／xsdata 相依套件）
- Tauri 2 對應平台的系統相依套件
- ONLYOFFICE Desktop Editors、LibreOffice

```bash
cd cross-platform
npm ci
npm run check
npm run build
```

`npm run build` 會先建立目前平台的內建 PDF 核心，再產生桌面安裝包。

- macOS：`cross-platform/src-tauri/target/release/bundle/macos` 與 `bundle/dmg`
- Windows：`cross-platform/src-tauri/target/release/bundle/msi` 與 `bundle/nsis`

## 驗證

```bash
cd cross-platform
npm run frontend:build
npm test
```

PDF 核心會實際建立文件，逐項執行內容編輯、頁面、註解、表單、附件、加密、簽章、轉檔與復原，再用對應讀取器重新開啟；不是只檢查按鈕或模擬回應。完整盤點見 `docs/FEATURE-COVERAGE.md`。

封裝後另以 `npm run test:sidecar` 驗證常駐協定、實際搜尋與 LIVE 往返，並限制後續暖回應必須在三秒內完成。

## Microsoft 專屬界線

本專案不取代或繞過 Microsoft 授權。一般 OOXML 文件由本機開源編輯引擎處理；VBA、ActiveX、COM、IRM、Microsoft 365 雲端共同編輯、Copilot，以及部分複雜 SmartArt／3D／動作路徑沒有完全等價的開源實作。遇到這些內容時，工作台會保留原檔並顯示相容性提醒，不會暗中移除。

## 授權

全能文件工作台整體（包含由原作者重新授權的 AcroPDF 衍生內建核心）採
**GNU Affero General Public License v3.0 或更新版本**（`AGPL-3.0-or-later`）。
完整條文見 [LICENSE](LICENSE)，版權資訊見 [COPYRIGHT](COPYRIGHT)。本程式不附帶
任何擔保；您可依 AGPL 複製、散布及修改，但散布執行檔時必須同時提供對應原始碼，
以網路方式提供功能時也必須讓遠端使用者取得當時執行版本的對應原始碼。

官方原始碼：<https://github.com/WhaleChao/OpenDeskTW>。每個 GitHub Release 的安裝包
旁均提供相同標籤版本的 Source code；建置腳本、安裝資訊與第三方授權檔都包含在該
原始碼中。PyMuPDF／MuPDF 在本專案中明確採 AGPL 路線；其他第三方元件維持各自授權，
詳見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 與安裝包內自動產生的授權清單。
