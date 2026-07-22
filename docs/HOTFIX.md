# 安全熱修與版本更新

全能文件工作台使用 Tauri 2 Updater。macOS 與 Windows 更新包必須由專用私鑰簽章，App 只內建公開金鑰；簽章錯誤、版本不相容或下載不完整時不會安裝。

## 安全原則

- 私鑰只保存在維護者的安全儲存空間與 GitHub Actions Secret，永不提交到 Git。
- `latest.json`、安裝包及 `.sig` 由 Release 工作流程產生。
- 使用者按下「檢查安全熱修」才會下載；安裝完成後明確重新啟動。
- Office 文件、備份與 MAGI 資料不包含在更新包中，也不會被更新流程移除。
- 重大格式遷移必須先建立本機回復點；上一版安裝包保留在 GitHub Releases。

## 發布

推送 `v*` tag 後，GitHub Actions 分別在 macOS 與 Windows 原生 runner 建置 App／DMG、MSI／NSIS，並產生 Tauri 更新簽章與 `latest.json`。

正式 Release 採 `AGPL-3.0-or-later`。GitHub 自動附加的同標籤 Source code 是安裝包的
對應原始碼；不得只發布二進位檔或更新檔而移除該來源。建置前會執行
`npm run legal:bundle`，把當次 Rust、npm 與 Python 相依套件授權一併封裝。

本機驗證可用 `tauri signer sign` 對 `.app.tar.gz` 產生 `.sig`。Apple 的應用程式公證與 Tauri 更新簽章是兩件事：更新簽章已強制啟用；若要讓網路下載的 macOS App 完全不出現 Gatekeeper 警告，還必須在 Actions 加入 Apple Developer ID 與公證秘密。沒有 Apple 憑證時仍會產生 ad-hoc 簽章的測試 DMG。
