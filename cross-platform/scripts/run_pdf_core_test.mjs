import { spawnSync } from "node:child_process";

const candidates = process.env.DOCUMENT_WORKBENCH_PYTHON
  ? [process.env.DOCUMENT_WORKBENCH_PYTHON]
  : process.platform === "win32"
    ? ["python", "py"]
    : ["python3", "python"];

for (const executable of candidates) {
  const args = executable === "py"
    ? ["-3", "scripts/test_embedded_pdf_core.py"]
    : ["scripts/test_embedded_pdf_core.py"];
  const result = spawnSync(executable, args, { stdio: "inherit" });
  if (result.error?.code === "ENOENT") continue;
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

throw new Error("找不到可執行的 Python 3；可用 DOCUMENT_WORKBENCH_PYTHON 指定路徑。");
