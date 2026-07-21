const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  TabStopPosition,
  TabStopType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");
const pptxgen = require("pptxgenjs");

const outputDir = process.argv[2];
if (!outputDir) {
  throw new Error("usage: generate_live_documents.js <output-directory>");
}
fs.mkdirSync(outputDir, { recursive: true });

const border = { style: BorderStyle.SINGLE, size: 8, color: "B8C7D9" };
const borders = { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border };
const tableCell = (text, width, fill, bold = false) => new TableCell({
  width: { size: width, type: WidthType.DXA },
  borders,
  shading: { fill, type: ShadingType.CLEAR },
  margins: { top: 110, bottom: 110, left: 130, right: 130 },
  children: [new Paragraph({
    children: [new TextRun({ text, bold, font: "Noto Sans CJK TC", size: 22 })],
  })],
});

async function createDOCX() {
  const doc = new Document({
    creator: "OpenDesk TW LIVE 驗證",
    title: "OpenDesk TW 文字文件相容性驗證",
    styles: {
      default: { document: { run: { font: "Noto Sans CJK TC", size: 22 } } },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Sans CJK TC", size: 34, bold: true, color: "164E63" },
          paragraph: { spacing: { before: 240, after: 180 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Serif CJK TC", size: 28, bold: true, color: "0F766E" },
          paragraph: { spacing: { before: 180, after: 120 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 500, footer: 500 },
        },
      },
      headers: {
        default: new Header({ children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "0D9488", space: 1 } },
          children: [new TextRun({ text: "OpenDesk TW　LIVE 相容性驗證", font: "Noto Sans CJK TC", color: "0F766E", bold: true, size: 18 })],
        })] }),
      },
      footers: {
        default: new Footer({ children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "第 ", font: "Noto Sans CJK TC", size: 18 }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Noto Sans CJK TC", size: 18 }),
            new TextRun({ text: " 頁，共 ", font: "Noto Sans CJK TC", size: 18 }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Noto Sans CJK TC", size: 18 }),
            new TextRun({ text: " 頁", font: "Noto Sans CJK TC", size: 18 }),
          ],
        })] }),
      },
      children: [
        new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          children: [
            new TextRun({ text: "OpenDesk TW 文字文件驗證", font: "Noto Sans CJK TC", size: 38, bold: true, color: "0F3D56" }),
            new TextRun({ text: "\t2026-07-21", font: "Noto Sans CJK TC", size: 20, color: "475569" }),
          ],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("〔參、〕版面與字型")] }),
        new Paragraph({
          spacing: { after: 180, line: 360 },
          children: [
            new TextRun({ text: "這一段使用 Noto Sans CJK TC，驗證繁體中文、英文 Office compatibility、標點與 12345 數字。", font: "Noto Sans CJK TC" }),
          ],
        }),
        new Paragraph({
          spacing: { after: 220 },
          children: [new TextRun({ text: "此行改用 Noto Serif CJK TC，確認更改字型後仍可正確匯出 PDF。", font: "Noto Serif CJK TC", size: 24 })],
        }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("〔四、〕功能驗證表格")] }),
        new Table({
          width: { size: 9026, type: WidthType.DXA },
          columnWidths: [3008, 3008, 3010],
          rows: [
            new TableRow({ children: [
              tableCell("功能", 3008, "D9F3F0", true),
              tableCell("測試內容", 3008, "D9F3F0", true),
              tableCell("預期結果", 3010, "D9F3F0", true),
            ] }),
            new TableRow({ children: [
              tableCell("表格", 3008, "FFFFFF"),
              tableCell("三欄、框線與底色", 3008, "FFFFFF"),
              tableCell("欄寬與文字不位移", 3010, "FFFFFF"),
            ] }),
            new TableRow({ children: [
              tableCell("頁首頁尾", 3008, "F8FAFC"),
              tableCell("標題、目前頁與總頁數", 3008, "F8FAFC"),
              tableCell("每頁均顯示", 3010, "F8FAFC"),
            ] }),
            new TableRow({ children: [
              tableCell("定位點", 3008, "FFFFFF"),
              tableCell("標題靠左、日期靠右", 3008, "FFFFFF"),
              tableCell("同列對齊", 3010, "FFFFFF"),
            ] }),
          ],
        }),
        new Paragraph({ children: [new PageBreak()] }),
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("〔玖、〕第二頁與頁碼")] }),
        new Paragraph({
          spacing: { after: 240, line: 360 },
          children: [new TextRun("這是第二頁。頁尾應顯示目前頁碼及總頁數，頁首應延續顯示；轉換 PDF 後內容仍須可搜尋。")],
        }),
        new Paragraph({
          tabStops: [
            { type: TabStopType.LEFT, position: 1800 },
            { type: TabStopType.RIGHT, position: 8000 },
          ],
          children: [
            new TextRun("左欄"),
            new TextRun("\t中間定位點"),
            new TextRun("\t右欄"),
          ],
        }),
      ],
    }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(path.join(outputDir, "OpenDeskTW_LIVE_Writer.docx"), buffer);
}

async function createPPTX() {
  const presentation = new pptxgen();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "OpenDesk TW LIVE 驗證";
  presentation.subject = "PPTX 相容性驗證";
  presentation.title = "OpenDesk TW 簡報驗證";
  presentation.company = "OpenDesk TW";
  presentation.lang = "zh-TW";
  presentation.theme = {
    headFontFace: "Noto Sans CJK TC",
    bodyFontFace: "Noto Sans CJK TC",
    lang: "zh-TW",
  };

  const slide1 = presentation.addSlide();
  slide1.background = { color: "082F49" };
  slide1.addShape(presentation.ShapeType.arc, { x: 8.8, y: -1.1, w: 5.5, h: 5.5, adjustPoint: 0.25, rotate: 10, fill: { color: "0EA5A5", transparency: 18 }, line: { color: "0EA5A5", transparency: 100 } });
  slide1.addText("OpenDesk TW", { x: 0.8, y: 1.0, w: 7.4, h: 0.8, fontFace: "Noto Sans CJK TC", fontSize: 42, bold: true, color: "FFFFFF", margin: 0 });
  slide1.addText("單機開源 Office · LIVE 相容性驗證", { x: 0.82, y: 1.95, w: 8.0, h: 0.5, fontFace: "Noto Sans CJK TC", fontSize: 22, color: "A5F3FC", margin: 0 });
  [
    ["Writer", "頁碼、頁首、表格", "2563EB"],
    ["Sheets", "公式、圖表、頁籤", "059669"],
    ["Slides", "字型、圖形、版面", "EA580C"],
  ].forEach(([title, subtitle, color], index) => {
    const x = 0.82 + index * 3.85;
    slide1.addShape(presentation.ShapeType.roundRect, { x, y: 3.3, w: 3.35, h: 1.65, rectRadius: 0.08, fill: { color: "FFFFFF", transparency: 4 }, line: { color: "FFFFFF", transparency: 100 }, shadow: { type: "outer", color: "000000", blur: 5, offset: 2, angle: 135, opacity: 0.16 } });
    slide1.addShape(presentation.ShapeType.ellipse, { x: x + 0.28, y: 3.64, w: 0.54, h: 0.54, fill: { color }, line: { color, transparency: 100 } });
    slide1.addText(title, { x: x + 1.02, y: 3.52, w: 2.0, h: 0.42, fontFace: "Noto Sans CJK TC", fontSize: 20, bold: true, color: "0F172A", margin: 0 });
    slide1.addText(subtitle, { x: x + 1.02, y: 4.05, w: 2.0, h: 0.34, fontFace: "Noto Sans CJK TC", fontSize: 12, color: "475569", margin: 0 });
  });
  slide1.addText("2026-07-21 · 本機離線驗證", { x: 0.82, y: 6.78, w: 4.0, h: 0.28, fontFace: "Noto Sans CJK TC", fontSize: 10, color: "94A3B8", margin: 0 });

  const slide2 = presentation.addSlide();
  slide2.background = { color: "F8FAFC" };
  slide2.addText("完整性檢查矩陣", { x: 0.7, y: 0.5, w: 6.5, h: 0.6, fontFace: "Noto Sans CJK TC", fontSize: 30, bold: true, color: "0F3D56", margin: 0 });
  slide2.addText("同一份簡報同時驗證中文字型、表格、圖形與數據圖表", { x: 0.72, y: 1.2, w: 7.5, h: 0.35, fontFace: "Noto Sans CJK TC", fontSize: 14, color: "64748B", margin: 0 });
  slide2.addTable([
    [
      { text: "類別", options: { bold: true, color: "FFFFFF", fill: { color: "0F766E" } } },
      { text: "項目", options: { bold: true, color: "FFFFFF", fill: { color: "0F766E" } } },
      { text: "狀態", options: { bold: true, color: "FFFFFF", fill: { color: "0F766E" } } },
    ],
    ["排版", "字型、間距、對齊", "待 LIVE 驗證"],
    ["物件", "表格、圖形、圖表", "待 LIVE 驗證"],
    ["往返", "PPTX → PDF", "待 LIVE 驗證"],
  ], { x: 0.72, y: 1.85, w: 6.1, h: 3.8, colW: [1.25, 2.9, 1.95], rowH: 0.72, fontFace: "Noto Sans CJK TC", fontSize: 14, color: "1E293B", border: { pt: 1, color: "CBD5E1" }, fill: { color: "FFFFFF" }, margin: 0.12 });
  slide2.addShape(presentation.ShapeType.roundRect, { x: 7.35, y: 1.78, w: 5.25, h: 3.95, rectRadius: 0.05, fill: { color: "FFFFFF" }, line: { color: "E2E8F0", pt: 1 }, shadow: { type: "outer", color: "000000", blur: 4, offset: 1, angle: 135, opacity: 0.10 } });
  slide2.addText("驗證項目數", { x: 7.75, y: 2.12, w: 2.2, h: 0.35, fontFace: "Noto Sans CJK TC", fontSize: 17, bold: true, color: "1E293B", margin: 0 });
  [["Writer", 8], ["Sheets", 7], ["Slides", 6], ["PDF", 5]].forEach(([label, value], index) => {
    const y = 2.78 + index * 0.62;
    slide2.addText(label, { x: 7.76, y, w: 0.85, h: 0.25, fontFace: "Noto Sans CJK TC", fontSize: 11, color: "475569", margin: 0 });
    slide2.addShape(presentation.ShapeType.roundRect, { x: 8.72, y: y + 0.01, w: value * 0.36, h: 0.22, rectRadius: 0.03, fill: { color: index === 0 ? "0F766E" : "14B8A6" }, line: { color: "14B8A6", transparency: 100 } });
    slide2.addText(String(value), { x: 11.78, y: y - 0.01, w: 0.35, h: 0.25, fontFace: "Noto Sans CJK TC", fontSize: 11, bold: true, color: "0F766E", margin: 0, align: "right" });
  });
  slide2.addText("頁面 2 / 2", { x: 11.5, y: 6.9, w: 1.0, h: 0.2, fontFace: "Noto Sans CJK TC", fontSize: 9, color: "94A3B8", align: "right", margin: 0 });

  await presentation.writeFile({ fileName: path.join(outputDir, "OpenDeskTW_LIVE_Slides.pptx") });
}

Promise.all([createDOCX(), createPPTX()]).catch((error) => {
  console.error(error);
  process.exit(1);
});
