# 全能文件工作台 v2.8.3

本次更新修正 macOS 上 Word 格式複製熱鍵被系統顏色面板攔截：

- ONLYOFFICE 的 AppKit「顯示顏色」原先先吃掉 `⇧⌘C`，外掛收不到按鍵，因此會開啟顏色選擇而沒有複製格式。
- 工作台在啟動 ONLYOFFICE 前，只於該 App 的 `NSUserKeyEquivalents` 將「顯示顏色」移到四修飾鍵備援組合，不修改已簽署的 ONLYOFFICE 程式，也不影響其他 App。
- 修改前會把原快捷鍵字典備份至工作台資料夾，既有的其他自訂快捷鍵會保留。
- 外掛同時在 window capture 階段攔截按鍵，並依實體 `KeyC／KeyV` 辨識，所以繁中輸入法下的 `⇧⌘C／⇧⌘V` 仍可用。
- Windows／Linux 的 `Ctrl+Shift+C／V`、macOS 備援 `⌘⌥C／V` 與其餘 Word 相容熱鍵不變。

驗證包含 macOS 原生快捷鍵設定、window capture、繁中輸入法鍵值，以及不切換目前視窗的編輯器背景 LIVE 粗體格式來源／目標往返。
