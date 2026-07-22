import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const source = path.join(
  projectRoot,
  "src-tauri/resources/acropdf-core/embedded_core.py",
);
const requestedTarget = process.argv.find((value) => value.startsWith("--target="))?.slice(9);
const ocrModels = [
  {
    name: "eng.traineddata",
    sha256: "7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2",
  },
  {
    name: "chi_tra.traineddata",
    sha256: "529c5b5797d64b126065cd55f2bb4c7fd7b15790798091b1ff259941a829330b",
  },
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 執行失敗（${result.status}）`);
}

function output(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error || result.status !== 0) throw result.error || new Error(result.stderr);
  return result.stdout;
}

const target =
  requestedTarget ||
  output("rustc", ["-vV"])
    .split(/\r?\n/)
    .find((line) => line.startsWith("host:"))
    ?.slice(5)
    .trim();
if (!target) throw new Error("無法判斷 Rust 目標平台");

const isWindows = target.includes("windows");
const python = process.env.DOCUMENT_WORKBENCH_PYTHON || (isWindows ? "python" : "python3");
const workRoot = path.join(projectRoot, "src-tauri/target/pdf-core", target);
const distRoot = path.join(workRoot, "dist");
const buildRoot = path.join(workRoot, "build");
const specRoot = path.join(workRoot, "spec");
const tessdataRoot = path.join(workRoot, "tessdata");
const binaryName = `document-pdf-core${isWindows ? ".exe" : ""}`;
const builtBinary = path.join(distRoot, binaryName);
const tauriBinary = path.join(
  projectRoot,
  "src-tauri/binaries",
  `document-pdf-core-${target}${isWindows ? ".exe" : ""}`,
);

rmSync(workRoot, { force: true, recursive: true });
mkdirSync(distRoot, { recursive: true });
mkdirSync(buildRoot, { recursive: true });
mkdirSync(specRoot, { recursive: true });
mkdirSync(tessdataRoot, { recursive: true });
mkdirSync(path.dirname(tauriBinary), { recursive: true });

for (const model of ocrModels) {
  const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/${model.name}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`無法下載 OCR 模型 ${model.name}（HTTP ${response.status}）`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== model.sha256) throw new Error(`OCR 模型 ${model.name} 校驗失敗`);
  writeFileSync(path.join(tessdataRoot, model.name), bytes);
}

run(python, [
  "-m",
  "PyInstaller",
  "--name",
  "document-pdf-core",
  "--onefile",
  "--console",
  "--noconfirm",
  "--clean",
  "--collect-all",
  "fitz",
  "--collect-all",
  "docx",
  "--collect-all",
  "openpyxl",
  "--collect-all",
  "pptx",
  "--collect-all",
  "pyhanko",
  "--collect-all",
  "pyhanko_certvalidator",
  "--add-data",
  `${path.join(tessdataRoot, "eng.traineddata")}${path.delimiter}tessdata`,
  "--add-data",
  `${path.join(tessdataRoot, "chi_tra.traineddata")}${path.delimiter}tessdata`,
  "--distpath",
  distRoot,
  "--workpath",
  buildRoot,
  "--specpath",
  specRoot,
  source,
]);

if (!existsSync(builtBinary)) throw new Error(`找不到內建 PDF 核心產物：${builtBinary}`);
copyFileSync(builtBinary, tauriBinary);
if (!isWindows) chmodSync(tauriBinary, 0o755);
console.log(`已建立全能文件工作台內建 PDF 核心：${tauriBinary}`);
