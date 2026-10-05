import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawn, spawnSync } from "node:child_process";

const rustc = spawnSync("rustc", ["-vV"], { encoding: "utf8" });
if (rustc.status !== 0) throw new Error("無法取得 Rust 目標平台");
const target = rustc.stdout.match(/^host:\s*(.+)$/m)?.[1]?.trim();
if (!target) throw new Error("找不到 Rust host triple");
const executable = path.resolve(
  "src-tauri/binaries",
  `document-pdf-core-${target}${process.platform === "win32" ? ".exe" : ""}`,
);
const child = spawn(executable, ["--embedded-server"], {
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
});
const lines = readline.createInterface({ input: child.stdout });
const pending = [];
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
lines.on("line", (line) => {
  const next = pending.shift();
  if (!next) return;
  try {
    next.resolve(JSON.parse(line));
  } catch (error) {
    next.reject(error);
  }
});

let requestId = 0;
function request(args, timeoutMs) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`常駐核心逾時：${stderr}`)), timeoutMs);
    pending.push({
      resolve(value) {
        clearTimeout(timeout);
        if (value.request_id !== id) reject(new Error("常駐核心回應順序錯誤"));
        else if (value.ok === false) reject(new Error(value.error));
        else resolve(value);
      },
      reject(error) {
        clearTimeout(timeout);
        reject(error);
      },
    });
    child.stdin.write(`${JSON.stringify({ request_id: id, args })}\n`);
  });
}

const testRoot = mkdtempSync(path.join(tmpdir(), "document-pdf-core-sidecar-"));
try {
  const coldStarted = Date.now();
  const status = await request(["--integration-status"], 45000);
  const coldMs = Date.now() - coldStarted;
  if (!status.persistent_server || status.protocol_version !== 2) {
    throw new Error("封裝核心未啟用 protocol 2 常駐模式");
  }
  const warmStarted = Date.now();
  await request(["--integration-status"], 3000);
  const warmMs = Date.now() - warmStarted;
  if (warmMs > 3000) throw new Error(`常駐核心暖啟動過慢：${warmMs} ms`);

  const pdf = path.join(testRoot, "常駐核心.pdf");
  await request(["--embedded-new", pdf, "--pages", "2"], 5000);
  await request([
    "--embedded-operate", pdf,
    "--operation", "add_text",
    "--options-json", JSON.stringify({ page: 0, text: "常駐核心 LIVE 驗證", x: 72, y: 90 }),
    "--output", pdf,
  ], 5000);
  const found = await request([
    "--embedded-query", pdf,
    "--query", "search",
    "--options-json", JSON.stringify({ text: "LIVE 驗證" }),
  ], 5000);
  if (found.matches !== 1) throw new Error("封裝核心搜尋往返失敗");
  const validated = await request(["--integration-live-test", pdf], 5000);
  if (!validated.passed || validated.roundtrip_pages !== 2) {
    throw new Error("封裝核心 LIVE 往返失敗");
  }
  // Exercise the real bundled OCR models on an image-only generated page.
  const scanned = path.join(testRoot, "scanned.pdf");
  const fixture = spawnSync(process.env.DOCUMENT_WORKBENCH_PYTHON || (process.platform === "win32" ? "python" : "python3"), ["-c", `import fitz,sys
source=fitz.open()
p=source.new_page()
p.insert_text((72,100), 'OpenDesk OCR Verification', fontsize=24)
image=p.get_pixmap(dpi=250, alpha=False).tobytes('png')
scanned=fitz.open()
p=scanned.new_page()
p.insert_image(p.rect, stream=image)
scanned.set_metadata({'title':'Preserved OCR title'})
scanned.save(sys.argv[1])`, scanned], {encoding:"utf8", windowsHide:true});
  if (fixture.status !== 0) throw new Error(fixture.stderr || "OCR fixture failed");
  await request(["--embedded-operate", scanned, "--operation", "ocr", "--options-json", JSON.stringify({language:"eng",dpi:250}), "--output", scanned], 45000);
  const recognized = await request(["--embedded-query", scanned, "--query", "search", "--options-json", JSON.stringify({text:"Verification"})], 5000);
  if (recognized.matches < 1) throw new Error("封裝 OCR 辨識失敗");
  console.log(`封裝 PDF 常駐核心＋實際 OCR：PASS（冷啟動 ${coldMs} ms，後續回應 ${warmMs} ms）`);
} finally {
  child.stdin.end();
  child.kill();
  lines.close();
  rmSync(testRoot, { force: true, recursive: true });
}
