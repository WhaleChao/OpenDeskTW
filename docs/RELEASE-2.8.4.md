# 全能文件工作台 v2.8.4

本次更新修正 macOS 26 上 LibreOffice 背景轉檔在啟動時崩潰：

- 崩潰發生在 `HIServices::_RegisterApplication → NSApplication`，尚未進入文件轉換；原因是直接執行 App bundle 內的 `soffice` 後，LibreOffice 的 macOS VCL 外掛仍會初始化 AppKit。
- macOS 改由 LaunchServices 啟動全新的隱藏背景 instance，並等待該 instance 完成；不切換目前前景 App，也不共用使用者正在執行的 LibreOffice 工作階段。
- 工作台先把來源複製到隔離暫存區，LibreOffice 只讀寫該暫存區；完成後再由工作台把成品複製到輸出位置，避免隱藏的 Documents／工作區權限提示造成永久等待。
- 每次轉檔仍使用獨立 LibreOffice 使用者設定檔，並加上 `--norestore`、`--nolockcheck`、`--nologo` 與 `--nodefault`。
- Tauri 正式程式、舊 Swift 轉檔器與完整 LIVE 腳本已套用同一修正。

驗證包含 LaunchServices 命令結構回歸測試、從 Codex 工作區來源執行正式 Rust 隔離 LIVE 轉檔、PDF 標頭與大小檢查、崩潰報告增量檢查，以及測試程序清理。2026-08-11 以 macOS 26.5.2、LibreOffice 26.2.5.2 實測通過；轉檔後沒有新增 `soffice` 崩潰報告，也沒有殘留 LibreOffice 程序。
