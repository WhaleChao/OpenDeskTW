# OpenDesk TW 一站式文件整合架構

## 產品定位

OpenDesk TW 是單一入口、狀態中心與安全層，不重新實作整套 Office 或 PDF 引擎。使用者在同一個全繁體中文介面選擇文件工作，OpenDesk 依格式與任務把文件交給最適合的本機原生引擎。

```text
OpenDesk TW 單一入口
├─ DOCX／XLSX／PPTX ── ONLYOFFICE（主要編輯）
├─ 舊格式／ODF／救援 ─ LibreOffice（相容與轉換）
├─ PDF ────────────── AcroPDF（完整 PDF 工作區）
├─ 分析 ───────────── MAGI V2 或 V3（唯一啟用版本）
└─ 共用安全層 ─────── 格式掃描、版本備份、LIVE 驗證、熱修
```

這個分工保留各引擎的完整原生功能，也避免為了「看起來整合」而複製不完整的編輯器。OpenDesk 的 PDF 中心負責直覺導覽、文件摘要、備份與驗證；AcroPDF 負責實際 PDF 編輯。

## 多角度設計檢查

### 使用者直覺

- 首頁以「我要完成什麼」呈現，而不是要求使用者先理解檔案引擎。
- Word 與 PDF 都採工作頁籤與任務卡，保留鍵盤左右鍵、Home、End 操作。
- 選到 PDF 時，主按鈕會自動改為 PDF 工作區，不會錯送到 Office 編輯器。
- PDF 工具可直接深層連結到對應對話框，減少重複尋找功能。

### 功能完整性

- Office 編輯交給 ONLYOFFICE／LibreOffice，保留格式、頁首頁尾、頁碼、目錄、表格、字型、試算表與簡報功能。
- PDF 編輯交給既有 AcroPDF，涵蓋頁面、內容、註解、表單、簽署、OCR、轉換、最佳化、安全、永久遮蔽、比較、預檢、無障礙、批次與歸檔。
- MAGI 透過相容層支援 V2／V3；若同時啟用兩版，OpenDesk 會停止呼叫並明確警示。

### 架構與維護

- OpenDesk 與 AcroPDF 使用 `protocol_version: 1` 的本機 JSON 協定，避免 UI 與私有核心緊耦合。
- 引擎狀態探測、文件報告與 LIVE 驗證皆有明確逾時，故障不會無限卡住主程式。
- PDF 工具名稱採雙邊白名單，不能透過參數執行任意命令。
- OpenDesk 與 AcroPDF 可各自熱修、測試與發版，協定版本負責相容性。

### 授權與發行

- OpenDesk TW 啟動器維持 MIT License。
- AcroPDF 維持私有授權並獨立安裝；其原始碼或二進位檔不進入公開 OpenDesk 儲存庫或發行包。
- 使用者看到的是單一入口，但安裝包仍尊重每個引擎的授權界線。

### 隱私與安全

- 文件、分析與轉換預設皆在本機進行，OpenDesk 本身沒有登入、遙測或雲端上傳。
- PDF 報告只回傳統計、結構與警示，不回傳全文；加密 PDF 不繞過密碼。
- 編輯既有文件前建立時間戳記備份；巨集與高風險物件另有安全副本與警示。
- MAGI 只在使用者明確要求分析時接收擷取內容，且只連線目前唯一運作的本機版本。

### 格式可靠度與失敗復原

- OOXML 以原始套件為基礎進行安全修改，避免不必要的重新序列化。
- PDF LIVE 驗證實際渲染首末頁、計算摘要，並將文件序列化後重新開啟確認頁數。
- 引擎缺少、版本不相容、處理逾時或文件損壞時，介面回報可理解的繁體中文錯誤，不覆寫原檔。

### 跨平台與無障礙

- 相同的 Tauri／Rust 核心產生 Windows 與 macOS 版本。
- 介面在 1280×720 與 950×800 寬度實測無水平溢位；PDF 頁籤具有 ARIA 狀態與鍵盤切換。
- 最終 Windows 安裝檔必須在 Windows runner 建置；macOS App／DMG 在 macOS runner 建置。

## 驗證閘門

發行前必須同時通過：

1. AcroPDF Python 單元／整合測試。
2. OpenDesk Rust 單元測試、Clippy 與前端 production build。
3. Office 完整功能矩陣。
4. 本機完整 LIVE pipeline：Office 引擎、三種 OOXML、中文標題重編、PDF 轉換、AcroPDF 渲染往返、MAGI V2／V3 契約。
5. 介面 LIVE 檢查：桌面與縮窄視窗、鍵盤頁籤、主控台零錯誤。
6. GitHub Actions 在 Windows／macOS 原生 runner 產生簽章熱修資訊與安裝包。
