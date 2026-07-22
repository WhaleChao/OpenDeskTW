# ONLYOFFICE 繁體中文與 OpenDesk TW 寫作工具

OpenDesk TW 2.2.1 不修改 `/Applications/ONLYOFFICE.app` 或 Windows 的已簽署程式檔，而是在使用者自己的設定與外掛資料夾完成修復，方便更新、回復與熱修。

## 問題原因

ONLYOFFICE Desktop Editors 支援的繁體中文語系代碼是 `zh-TW`。若 macOS 偏好設定誤寫成 `zh-ZH`，程式無法把它辨識為有效的繁中語系，便可能沿用簡體中文資源或簡體範本快取。

OpenDesk TW 會檢查 `asc_user_ui_lang`、`AppleLanguages` 與 `AppleLocale`。修復時統一寫入 `zh-TW`，Windows／Linux 從 OpenDesk TW 啟動 ONLYOFFICE 時則加上持久語系參數 `--keeplang:zh-TW`。

## 一鍵修復

1. 儲存所有正在編輯的文件，正常關閉 ONLYOFFICE。
2. 開啟 OpenDesk TW 的「Word 文件中心」。
3. 按「一鍵修正繁中＋寫作工具」。
4. 修復完成後再從 OpenDesk TW 開啟文件。

若 ONLYOFFICE 還在運作，OpenDesk TW 會停止修復並提醒使用者關閉，不會強制結束程序，也不會碰觸復原中的文件。

macOS 修復前會把原有偏好設定及 `templates_cache` 移到：

`~/Library/Application Support/OpenDesk TW/OnlyOfficeRepairBackups/<時間>/`

## 使用繁中寫作工具

重新開啟 ONLYOFFICE 文件後，功能區會自動出現「OpenDesk TW」分頁，不必再到網頁或外掛商店尋找。它包含：

- 「分散對齊」：先選取一個或多個段落，再按一下；直接套用編輯器原生的分散對齊。
- 「智慧補齊」：選取文字，或把游標留在目前句子後按一下；會依巢狀順序判斷應補 `）`、`」`、`】`、`〕`、`》`、`〉` 等結尾。例如 `公文（附件【第一項` 會成為 `公文（附件【第一項】）`。
- 「台灣標點」：整理選取文字或目前句子的引號、逗號、句號、冒號、分號、問號、驚嘆號與刪節號；英文單字、版本號與撇號會保留。
- 「快捷鍵」：在編輯器內顯示格式複製、套用格式、只貼文字、清除格式及常用排版按鍵。OpenDesk TW 主畫面的「快捷鍵總覽」另提供完整可搜尋清單。

工具直接呼叫編輯器公開的文件與段落 API，不讀取或上傳整份文件，也沒有網路請求。它使用固定 GUID 安裝於使用者外掛資料夾，因此 OpenDesk TW 可以安全地熱修同一個工具，不影響其他外掛。為避免中文輸入法重複送字、游標跳動或與原生快捷鍵衝突，智慧補齊由使用者按一下工具後處理目前句子，而不攔截系統層所有鍵盤事件。

## 格式複製與快捷鍵

- 複製格式：Windows／Linux `Ctrl+Alt+C`；macOS `⌘⌥C`。
- 套用格式：Windows／Linux `Ctrl+Alt+V`；macOS `⌘⌥V`。
- 只貼文字：Windows／Linux `Ctrl+Shift+V`；macOS `⇧⌘V`。
- OpenDesk 中文標題安全重編：Windows／Linux `Ctrl+Alt+Shift+R`；macOS `⌥⇧⌘R`。

完整表格可在 Word 文件中心按「快捷鍵總覽」後，依「格式」、「頁碼」、`⌘` 或 `Ctrl` 搜尋。清單直接內建於 App，不會連到網頁。

## 翻譯範圍

OpenDesk TW 自己的畫面與新增工具均為繁體中文，並會清除已知簡體範本快取。但 ONLYOFFICE 內部編輯器的繁體中文翻譯由上游專案提供；上游尚未翻譯的項目可能顯示英文。為保留程式簽章、升級能力與安全性，OpenDesk TW 不直接改寫 ONLYOFFICE.app 內部資源，也不以機器轉換覆蓋專業術語。

## 驗證

自動測試會確認：

- `zh-TW`／`zh-Hant-TW` 被視為繁中，`zh-ZH`／`zh-CN` 不會誤判。
- 繁中寫作工具的設定檔、固定 GUID、原生 API 呼叫與無網路特性。
- 巢狀括號／引號結尾判斷、台灣標點轉換、英文與版本號保護。
- 格式複製快捷鍵及 OpenDesk 完整快捷鍵總覽的來源內容。
- OpenDesk TW 主要介面沒有已知簡體詞彙。
- 完整 LIVE 測試開始前，實機語系與外掛都必須就緒。
