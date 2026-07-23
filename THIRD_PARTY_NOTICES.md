# 第三方元件與授權告知

全能文件工作台的結合作品整體採 `AGPL-3.0-or-later`。完整 AGPL 條文位於
`LICENSE`；下列元件仍保留各自的版權、署名與授權條款。

- PyMuPDF／MuPDF：本專案選擇 GNU AGPL 路線使用，並將對應原始碼、建置腳本與
  安裝資訊和執行檔一併提供。
- ONLYOFFICE Desktop Editors：GNU Affero General Public License v3.0；由使用者在
  本機獨立安裝與執行。AI 台灣繁中相容語系以本機已安裝的 AI plugin 3.2.2 翻譯鍵
  為基礎，保留 Ascensio System SIA 版權與上游 AGPL v3／介面文字 CC BY-SA 4.0 告知。
- LibreOffice：Mozilla Public License 2.0，並含其他相容開源授權元件；由使用者在
  本機獨立安裝與執行。
- Tesseract `tessdata_fast` 4.1.0 英文與繁體中文辨識模型：Apache License 2.0。
- Tauri、Rust crates、npm 套件、PyInstaller、python-docx、openpyxl、python-pptx、
  pyHanko、Pillow、cryptography、lxml 與其傳遞相依套件：維持上游授權。
- MAGI V2／V3：工作台只透過本機相容協定連線，不散布 MAGI 程式本體；MAGI 維持
  其原授權。

正式建置會執行 `npm run legal:bundle`，從當次鎖定的 Cargo、npm 與 Python 相依
套件中擷取套件名稱、版本、授權表達式及上游 LICENSE／COPYING／NOTICE 檔案，放入
App 的 `resources/licenses/third-party/`。因此安裝包內的清單會精確對應實際平台及
當次建置，而不是只依賴這份人工摘要。

全能文件工作台不包含 Microsoft Office 原始碼、商標素材或授權規避元件，也不會
更改既有 Microsoft Office 授權。AcroPDF 衍生核心已由其著作權人明確重新授權為
`AGPL-3.0-or-later`，不再適用先前的專有散布限制。
