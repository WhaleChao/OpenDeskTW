const fs = require("fs");
const path = require("path");
const {
  Document,
  Packer,
  Paragraph,
} = require("docx");
const pptxgen = require("pptxgenjs");
const pptxPackageNodeModules = path.dirname(path.dirname(path.dirname(require.resolve("pptxgenjs"))));
const JSZip = require(path.join(pptxPackageNodeModules, "jszip"));

const outputDirectory = process.argv[2];
if (!outputDirectory) {
  throw new Error("usage: generate_blank_templates.js <output-directory>");
}
fs.mkdirSync(outputDirectory, { recursive: true });

async function createDocumentTemplate() {
  const document = new Document({
    creator: "OpenDesk TW",
    title: "空白文字文件",
    description: "OpenDesk TW 繁體中文空白文字文件範本",
    styles: {
      default: {
        document: {
          run: { font: "Noto Sans CJK TC", size: 24, color: "000000" },
          paragraph: { spacing: { line: 360 } },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Sans CJK TC", size: 32, bold: true, color: "000000" },
          paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 0 },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Sans CJK TC", size: 28, bold: true, color: "000000" },
          paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 1 },
        },
        {
          id: "Heading3",
          name: "Heading 3",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Sans CJK TC", size: 24, bold: true, color: "000000" },
          paragraph: { spacing: { before: 160, after: 100 }, outlineLevel: 2 },
        },
        {
          id: "Heading4",
          name: "Heading 4",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Noto Sans CJK TC", size: 24, bold: true, color: "000000" },
          paragraph: { spacing: { before: 120, after: 80 }, outlineLevel: 3 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134, header: 567, footer: 567 },
        },
      },
      children: [new Paragraph({ children: [] })],
    }],
  });
  const buffer = await Packer.toBuffer(document);
  fs.writeFileSync(path.join(outputDirectory, "Blank-Document.docx"), buffer);
}

async function createPresentationTemplate() {
  const presentation = new pptxgen();
  presentation.layout = "LAYOUT_WIDE";
  presentation.author = "OpenDesk TW";
  presentation.company = "OpenDesk TW";
  presentation.subject = "繁體中文空白簡報範本";
  presentation.title = "空白簡報";
  presentation.lang = "zh-TW";
  presentation.theme = {
    headFontFace: "Noto Sans CJK TC",
    bodyFontFace: "Noto Sans CJK TC",
    lang: "zh-TW",
  };
  presentation.defineSlideMaster({
    title: "OPENDESK_TITLE",
    background: { color: "FFFFFF" },
    objects: [
      {
        placeholder: {
          text: "",
          options: {
            name: "title",
            type: "title",
            x: 0.9,
            y: 1.65,
            w: 11.55,
            h: 1.15,
            fontFace: "Noto Sans CJK TC",
            fontSize: 34,
            bold: true,
            align: "center",
            valign: "mid",
            color: "1F2937",
            margin: 0.08,
          },
        },
      },
      {
        placeholder: {
          text: "",
          options: {
            name: "body",
            type: "body",
            x: 1.4,
            y: 3.0,
            w: 10.55,
            h: 0.8,
            fontFace: "Noto Sans CJK TC",
            fontSize: 18,
            align: "center",
            valign: "mid",
            color: "64748B",
            margin: 0.05,
          },
        },
      },
    ],
  });
  const slide = presentation.addSlide({ masterName: "OPENDESK_TITLE" });
  slide.background = { color: "FFFFFF" };
  const outputPath = path.join(outputDirectory, "Blank-Presentation.pptx");
  await presentation.writeFile({ fileName: outputPath });

  // PptxGenJS 4.0.1 writes notesMasterIdLst after sldIdLst. ECMA-376
  // requires it before sldIdLst, so repair the element order before bundling.
  const archive = await JSZip.loadAsync(fs.readFileSync(outputPath));
  const presentationPart = archive.file("ppt/presentation.xml");
  let presentationXML = await presentationPart.async("string");
  const notesMasterMatch = presentationXML.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/);
  if (notesMasterMatch) {
    presentationXML = presentationXML
      .replace(notesMasterMatch[0], "")
      .replace("<p:sldIdLst>", `${notesMasterMatch[0]}<p:sldIdLst>`);
    archive.file("ppt/presentation.xml", presentationXML);
    const repaired = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    fs.writeFileSync(outputPath, repaired);
  }
}

Promise.all([createDocumentTemplate(), createPresentationTemplate()]).catch((error) => {
  console.error(error);
  process.exit(1);
});
