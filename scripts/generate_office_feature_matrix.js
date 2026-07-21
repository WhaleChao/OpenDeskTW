const fs = require("fs");
const path = require("path");
const {
  AlignmentType,
  Bookmark,
  BorderStyle,
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  Document,
  EndnoteReferenceRun,
  ExternalHyperlink,
  Footer,
  FootnoteReferenceRun,
  Header,
  HeadingLevel,
  InsertedTextRun,
  InternalHyperlink,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  SimpleMailMergeField,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} = require("docx");
const pptxgen = require("pptxgenjs");

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error("usage: generate_office_feature_matrix.js <output-directory>");
}
fs.mkdirSync(outputDirectory, { recursive: true });

const packageNodeModules = path.dirname(path.dirname(path.dirname(require.resolve("pptxgenjs"))));
const JSZip = require(path.join(packageNodeModules, "jszip"));
const fontSans = "Noto Sans CJK TC";
const fontSerif = "Noto Serif CJK TC";
const changedAt = "2026-07-21T00:00:00Z";

const border = { style: BorderStyle.SINGLE, size: 7, color: "A8BAC7" };
const borders = {
  top: border,
  bottom: border,
  left: border,
  right: border,
  insideHorizontal: border,
  insideVertical: border,
};

function tableCell(text, width, fill, bold = false) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    shading: { fill, type: ShadingType.CLEAR },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [new Paragraph({
      children: [new TextRun({ text, font: fontSans, size: 20, bold })],
    })],
  });
}

async function createDocumentMatrix() {
  const commentId = 0;
  const document = new Document({
    creator: "OpenDesk TW 完整相容性驗證",
    title: "OpenDesk TW 文字文件進階功能矩陣",
    subject: "DOCX 結構、版面、審閱與欄位驗證",
    description: "用於 OpenDesk TW 內建自我檢查；不是使用者文件。",
    features: { trackRevisions: true, updateFields: true },
    comments: {
      children: [{
        id: commentId,
        author: "OpenDesk TW",
        initials: "OD",
        date: new Date(changedAt),
        children: [new Paragraph({ children: [new TextRun("這是一則用來驗證註解保留的測試註解。") ] })],
      }],
    },
    footnotes: {
      1: { children: [new Paragraph({ children: [new TextRun("註腳：驗證頁面底部註腳內容與參照符號。") ] })] },
    },
    endnotes: {
      1: { children: [new Paragraph({ children: [new TextRun("尾註：驗證文件尾端註記與參照符號。") ] })] },
    },
    numbering: {
      config: [{
        reference: "legal-heading",
        levels: [
          {
            level: 0,
            format: LevelFormat.IDEOGRAPH_LEGAL_TRADITIONAL,
            text: "〔%1、〕",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 0, hanging: 0 } } },
          },
          {
            level: 1,
            format: LevelFormat.CHINESE_COUNTING,
            text: "〔%2、〕",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 0 } } },
          },
        ],
      }],
    },
    styles: {
      default: {
        document: {
          run: { font: fontSans, size: 22, color: "17202A" },
          paragraph: { spacing: { line: 330, after: 100 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: fontSans, size: 32, bold: true, color: "0F4C5C" },
          paragraph: { spacing: { before: 260, after: 150 }, outlineLevel: 0, keepNext: true },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: fontSerif, size: 27, bold: true, color: "0F766E" },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1, keepNext: true },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: fontSans, size: 24, bold: true, color: "334155" },
          paragraph: { spacing: { before: 160, after: 90 }, outlineLevel: 2, keepNext: true },
        },
        {
          id: "Heading4",
          name: "Heading 4",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: fontSans, size: 22, bold: true, color: "475569" },
          paragraph: { spacing: { before: 120, after: 70 }, outlineLevel: 3, keepNext: true },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 11906, height: 16838 },
            margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 520, footer: 520 },
          },
        },
        headers: {
          default: new Header({ children: [new Paragraph({
            border: { bottom: { style: BorderStyle.SINGLE, size: 5, color: "0F766E", space: 1 } },
            children: [new TextRun({ text: "OpenDesk TW　完整 DOCX 功能驗證", font: fontSans, size: 18, bold: true, color: "0F766E" })],
          })] }),
        },
        footers: {
          default: new Footer({ children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "第 ", font: fontSans, size: 17 }),
              new TextRun({ children: [PageNumber.CURRENT], font: fontSans, size: 17 }),
              new TextRun({ text: " 頁／共 ", font: fontSans, size: 17 }),
              new TextRun({ children: [PageNumber.TOTAL_PAGES], font: fontSans, size: 17 }),
              new TextRun({ text: " 頁", font: fontSans, size: 17 }),
            ],
          })] }),
        },
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 160 },
            children: [new TextRun({ text: "OpenDesk TW 文字文件進階功能矩陣", font: fontSans, size: 38, bold: true, color: "0F3D56" })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 260 },
            children: [new TextRun({ text: "樣式・欄位・註腳・審閱・連結・頁面配置", font: fontSerif, size: 21, color: "64748B" })],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("目錄與標題層級")] }),
          new TableOfContents("自動目錄", { hyperlink: true, headingStyleRange: "1-4" }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            numbering: { reference: "legal-heading", level: 0 },
            children: [new Bookmark({ id: "legal_heading", children: [new TextRun("自動中文法律標題")] })],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            numbering: { reference: "legal-heading", level: 1 },
            children: [new TextRun("次層標題可重新編號")],
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "字型與格式：", bold: true, font: fontSans }),
              new TextRun({ text: "繁體中文黑體、", font: fontSans }),
              new TextRun({ text: "繁體中文明體、", font: fontSerif, italics: true }),
              new TextRun({ text: "粗體、斜體、底線", bold: true, italics: true, underline: {} }),
              new TextRun({ text: "與醒目顏色。", color: "C2410C" }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun("此段包含註腳"),
              new FootnoteReferenceRun(1),
              new TextRun("與尾註"),
              new EndnoteReferenceRun(1),
              new TextRun("，並保留可搜尋文字。"),
            ],
          }),
          new Paragraph({
            children: [
              new CommentRangeStart(commentId),
              new TextRun({ text: "這段文字有註解", bold: true, color: "9A3412" }),
              new CommentRangeEnd(commentId),
              new TextRun({ children: [new CommentReference(commentId)] }),
              new TextRun("；註解內容必須保留。"),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun("追蹤修訂："),
              new DeletedTextRun({ id: 1, author: "OpenDesk TW", date: changedAt, text: "舊文字" }),
              new InsertedTextRun({ id: 2, author: "OpenDesk TW", date: changedAt, text: "新文字" }),
              new TextRun("，刪除與插入標記均需存在。"),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun("書籤連結："),
              new InternalHyperlink({ anchor: "legal_heading", children: [new TextRun({ text: "回到中文法律標題", style: "Hyperlink" })] }),
              new TextRun("；外部連結："),
              new ExternalHyperlink({ link: "https://www.onlyoffice.com/", children: [new TextRun({ text: "ONLYOFFICE", style: "Hyperlink" })] }),
              new TextRun("。"),
            ],
          }),
          new Paragraph({
            children: [new TextRun("郵件合併欄位：收件人 "), new SimpleMailMergeField("RecipientName"), new TextRun("。")],
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("表格與版面配置")] }),
          new Table({
            width: { size: 9026, type: WidthType.DXA },
            columnWidths: [2400, 3900, 2726],
            rows: [
              new TableRow({ tableHeader: true, children: [
                tableCell("功能", 2400, "CCFBF1", true),
                tableCell("驗證內容", 3900, "CCFBF1", true),
                tableCell("預期", 2726, "CCFBF1", true),
              ] }),
              new TableRow({ children: [
                tableCell("頁首頁尾", 2400, "FFFFFF"),
                tableCell("頁碼、總頁數與固定標題", 3900, "FFFFFF"),
                tableCell("每頁保留", 2726, "FFFFFF"),
              ] }),
              new TableRow({ children: [
                tableCell("審閱", 2400, "F8FAFC"),
                tableCell("註解、插入與刪除修訂", 3900, "F8FAFC"),
                tableCell("結構可驗證", 2726, "F8FAFC"),
              ] }),
              new TableRow({ children: [
                tableCell("欄位", 2400, "FFFFFF"),
                tableCell("目錄、郵件合併與頁碼", 3900, "FFFFFF"),
                tableCell("可更新", 2726, "FFFFFF"),
              ] }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun("分頁後內容")] }),
          new Paragraph({ children: [new TextRun("第二頁用於驗證分頁、頁首、頁尾、總頁數與 PDF 搜尋文字。") ] }),
          new Paragraph({ heading: HeadingLevel.HEADING_4, children: [new TextRun("最深層標題")] }),
          new Paragraph({ children: [new TextRun("四層標題樣式皆存在，目錄欄位應涵蓋第一至第四層。") ] }),
        ],
      },
    ],
  });

  const outputPath = path.join(outputDirectory, "OpenDeskTW_完整文字功能.docx");
  fs.writeFileSync(outputPath, await Packer.toBuffer(document));
}

async function repairPresentation(outputPath) {
  const archive = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const presentationPart = archive.file("ppt/presentation.xml");
  if (presentationPart) {
    let presentationXML = await presentationPart.async("string");
    const notesMasterMatch = presentationXML.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/);
    if (notesMasterMatch) {
      presentationXML = presentationXML
        .replace(notesMasterMatch[0], "")
        .replace("<p:sldIdLst>", `${notesMasterMatch[0]}<p:sldIdLst>`);
      archive.file("ppt/presentation.xml", presentationXML);
    }
  }

  for (const slideName of ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]) {
    const part = archive.file(slideName);
    if (!part) continue;
    let xml = await part.async("string");
    if (!xml.includes("<p:transition")) {
      const transition = '<p:transition spd="slow" advClick="1"><p:fade/></p:transition>';
      xml = xml.includes("<p:extLst>")
        ? xml.replace("<p:extLst>", `${transition}<p:extLst>`)
        : xml.replace("</p:sld>", `${transition}</p:sld>`);
      archive.file(slideName, xml);
    }
  }

  for (const chartName of Object.keys(archive.files).filter((name) => /^ppt\/charts\/chart[0-9]+\.xml$/.test(name))) {
    const part = archive.file(chartName);
    let xml = await part.async("string");
    const validAxisIds = new Set();
    for (const match of xml.matchAll(/<c:(?:cat|val|date|ser)Ax>[\s\S]*?<c:axId val="([0-9]+)"\/>[\s\S]*?<\/c:(?:cat|val|date|ser)Ax>/g)) {
      validAxisIds.add(match[1]);
    }
    xml = xml.replace(/<c:barChart>[\s\S]*?<\/c:barChart>/g, (barChart) =>
      barChart.replace(/<c:axId val="([0-9]+)"\/>/g, (axisElement, axisId) => validAxisIds.has(axisId) ? axisElement : "")
    );
    archive.file(chartName, xml);
  }

  fs.writeFileSync(outputPath, await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

async function createPresentationMatrix() {
  const presentation = new pptxgen();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "OpenDesk TW 完整相容性驗證";
  presentation.company = "OpenDesk TW";
  presentation.subject = "PPTX 母片、物件、備忘稿與轉場驗證";
  presentation.title = "OpenDesk TW 簡報進階功能矩陣";
  presentation.lang = "zh-TW";
  presentation.theme = { headFontFace: fontSans, bodyFontFace: fontSans, lang: "zh-TW" };
  presentation.defineSlideMaster({
    title: "OPENDESK_MATRIX",
    background: { color: "F8FAFC" },
    objects: [
      { rect: { x: 0, y: 0, w: 13.333, h: 0.16, fill: { color: "0F766E" }, line: { color: "0F766E" } } },
      { text: { text: "OpenDesk TW・完整簡報功能驗證", options: { x: 0.65, y: 7.04, w: 5.2, h: 0.2, fontFace: fontSans, fontSize: 9, color: "64748B", margin: 0 } } },
    ],
    slideNumber: { x: 11.8, y: 7.0, w: 0.75, h: 0.24, align: "right", fontFace: fontSans, fontSize: 10, color: "64748B", margin: 0 },
  });

  const slide1 = presentation.addSlide({ masterName: "OPENDESK_MATRIX" });
  slide1.background = { color: "082F49" };
  slide1.addShape(presentation.ShapeType.arc, { x: 8.7, y: -1.0, w: 5.7, h: 5.7, rotate: 12, fill: { color: "14B8A6", transparency: 18 }, line: { color: "14B8A6", transparency: 100 } });
  slide1.addText("OpenDesk TW", { x: 0.8, y: 1.2, w: 7.2, h: 0.78, fontFace: fontSans, fontSize: 42, bold: true, color: "FFFFFF", margin: 0 });
  slide1.addText("簡報進階功能矩陣", { x: 0.82, y: 2.15, w: 7.2, h: 0.55, fontFace: fontSerif, fontSize: 25, color: "A5F3FC", margin: 0 });
  slide1.addText("母片・投影片編號・表格・圖表・備忘稿・轉場", { x: 0.82, y: 3.08, w: 7.9, h: 0.38, fontFace: fontSans, fontSize: 17, color: "CBD5E1", margin: 0 });
  slide1.addNotes("講者備忘稿：確認簡報者檢視可讀取這段文字。第 1 張投影片。")

  const slide2 = presentation.addSlide({ masterName: "OPENDESK_MATRIX" });
  slide2.addText("資料圖表與表格", { x: 0.7, y: 0.52, w: 6.3, h: 0.55, fontFace: fontSans, fontSize: 30, bold: true, color: "0F3D56", margin: 0 });
  slide2.addText("圖表資料、表格樣式與中文字型應在往返存檔後保持", { x: 0.72, y: 1.18, w: 7.3, h: 0.3, fontFace: fontSans, fontSize: 14, color: "64748B", margin: 0 });
  slide2.addChart(presentation.ChartType.bar, [{
    name: "驗證項目",
    labels: ["文字", "試算表", "簡報", "PDF"],
    values: [12, 14, 10, 6],
  }], {
    x: 0.72, y: 1.72, w: 6.1, h: 4.55,
    catAxisLabelFontFace: fontSans, valAxisLabelFontFace: fontSans,
    showLegend: false, showTitle: true, title: "模組驗證項目數",
    chartColors: ["0F766E"], showValue: true, valGridLine: { color: "E2E8F0", size: 1 },
    border: { color: "CBD5E1", pt: 1 },
  });
  slide2.addTable([
    [{ text: "能力", options: { bold: true, color: "FFFFFF", fill: { color: "0F766E" } } }, { text: "驗證方式", options: { bold: true, color: "FFFFFF", fill: { color: "0F766E" } } }],
    ["母片／頁碼", "OOXML 結構"],
    ["圖表／表格", "物件與資料"],
    ["備忘稿", "Notes XML"],
    ["轉場", "Transition XML"],
  ], { x: 7.25, y: 1.72, w: 5.25, h: 4.3, colW: [2.05, 3.2], rowH: 0.72, fontFace: fontSans, fontSize: 14, border: { color: "CBD5E1", pt: 1 }, fill: { color: "FFFFFF" }, margin: 0.1 });
  slide2.addNotes("講者備忘稿：第 2 張包含可編輯圖表與五列表格。")

  const slide3 = presentation.addSlide({ masterName: "OPENDESK_MATRIX" });
  slide3.addText("物件排列與直覺操作", { x: 0.7, y: 0.52, w: 7.5, h: 0.55, fontFace: fontSans, fontSize: 30, bold: true, color: "0F3D56", margin: 0 });
  const blocks = [
    ["版面", "母片、佈景、對齊", "2563EB"],
    ["媒體", "圖片、音訊、視訊", "EA580C"],
    ["播放", "轉場、動畫、放映", "7C3AED"],
  ];
  blocks.forEach(([title, detail, color], index) => {
    const x = 0.82 + index * 4.15;
    slide3.addShape(presentation.ShapeType.roundRect, { x, y: 1.75, w: 3.65, h: 2.45, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: "CBD5E1", pt: 1 }, shadow: { type: "outer", color: "000000", blur: 4, offset: 1, angle: 135, opacity: 0.12 } });
    slide3.addShape(presentation.ShapeType.ellipse, { x: x + 0.28, y: 2.08, w: 0.62, h: 0.62, fill: { color }, line: { color, transparency: 100 } });
    slide3.addText(title, { x: x + 1.08, y: 2.05, w: 2.1, h: 0.4, fontFace: fontSans, fontSize: 21, bold: true, color: "1E293B", margin: 0 });
    slide3.addText(detail, { x: x + 0.35, y: 3.12, w: 2.95, h: 0.55, fontFace: fontSans, fontSize: 14, color: "475569", align: "center", margin: 0 });
  });
  slide3.addText([
    { text: "點此查看 ONLYOFFICE", options: { hyperlink: { url: "https://www.onlyoffice.com/" }, color: "0F766E", underline: true, bold: true } },
  ], { x: 4.65, y: 5.35, w: 4.0, h: 0.4, fontFace: fontSans, fontSize: 16, align: "center", margin: 0 });
  slide3.addNotes("講者備忘稿：第 3 張驗證圖形、排列、超連結與轉場。")

  const outputPath = path.join(outputDirectory, "OpenDeskTW_完整簡報功能.pptx");
  await presentation.writeFile({ fileName: outputPath });
  await repairPresentation(outputPath);
}

Promise.all([createDocumentMatrix(), createPresentationMatrix()]).catch((error) => {
  console.error(error);
  process.exit(1);
});
