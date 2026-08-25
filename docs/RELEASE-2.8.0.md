# 全能文件工作台 v2.8.0

本版完成 Word 功能差距稽核中可由本機開放介面安全實作的項目，並保留 Microsoft 專有能力的清楚界線。

## 主要更新

- 每 15 秒保存 ONLYOFFICE 記憶體富文字草稿，支援未存內容復原。
- 可編輯文件大綱：章節連同子內容上下移動、標題升降層級。
- 合併列印加入進階篩選、Word MERGEFIELD、IF／Ask／Fill-in／Set 及記錄規則。
- 引文與書目保存來源 ID，可在文件內重新整理。
- 擴充無障礙檢查、台灣文件交付前校閱及四種結構化 DOCX 範本。
- 補齊更多 Word 相容快捷鍵，並修正 `Ctrl+Q` 保留既有標題樣式。
- Office 更新移動原始字型後，仍會沿用已合法註冊的實體新細明體／細明體。
- MAGI V2／V3 本機橋接與完整 Office → PDF → MAGI 管線已完成 LIVE 驗證。

## 驗證

- 完整自動測試：35 項通過、0 失敗。
- LIVE 修復：ONLYOFFICE 台灣語系、外掛 2.0.0、新細明體／細明體通過。
- LIVE MAGI：實際請求與回應通過。
- LIVE 完整管線：DOCX 結構、元件、無障礙、合併列印、PDF 轉換／渲染及 MAGI 通過。
- macOS APP 深層簽章驗證通過；Windows NSIS EXE 由同標籤 GitHub Actions 建置。

## 相容性界線

富文字草稿不是完整 DOCX 二進位快照；巨集、複雜內嵌物件與完整頁面設定仍以已儲存檔案及編輯引擎復原為準。VBA／ActiveX／COM／VSTO、IRM／Purview、Microsoft 365 雲端共同編輯及專有 SmartArt 等不宣稱等價。
