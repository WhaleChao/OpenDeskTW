import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const outputRoot = path.join(projectRoot, "src-tauri/resources/licenses/third-party");
const licensePattern = /^(license|copying|notice|authors|copyright)(\.|-|$)/i;

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._@+-]+/g, "_");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr || `${command} 執行失敗（${result.status}）`);
  }
  return result.stdout;
}

function copyLicenseFiles(sourceRoot, destinationRoot) {
  if (!existsSync(sourceRoot)) return 0;
  mkdirSync(destinationRoot, { recursive: true });
  let copied = 0;
  for (const entry of readdirSync(sourceRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !licensePattern.test(entry.name)) continue;
    copyFileSync(path.join(sourceRoot, entry.name), path.join(destinationRoot, safeName(entry.name)));
    copied += 1;
  }
  return copied;
}

function nodePackageDirectories(root) {
  if (!existsSync(root)) return [];
  const packages = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const current = path.join(root, entry.name);
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(current, { withFileTypes: true })) {
        if (scoped.isDirectory()) packages.push(path.join(current, scoped.name));
      }
    } else {
      packages.push(current);
    }
  }
  return packages;
}

function collectNpmLicenses() {
  const rows = [];
  const visited = new Set();
  const pending = nodePackageDirectories(path.join(projectRoot, "node_modules"));
  while (pending.length) {
    const directory = pending.shift();
    const manifestPath = path.join(directory, "package.json");
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const identity = `${manifest.name || path.basename(directory)}@${manifest.version || "unknown"}`;
    const realIdentity = path.resolve(directory);
    if (visited.has(realIdentity)) continue;
    visited.add(realIdentity);
    const destination = path.join(outputRoot, "npm", safeName(identity));
    const copied = copyLicenseFiles(directory, destination);
    rows.push([manifest.name || path.basename(directory), manifest.version || "unknown", manifest.license || "請參閱授權原文", copied]);
    pending.push(...nodePackageDirectories(path.join(directory, "node_modules")));
  }
  return rows.sort((left, right) => left[0].localeCompare(right[0], "en"));
}

function collectCargoLicenses() {
  const manifest = path.join(projectRoot, "src-tauri/Cargo.toml");
  const metadata = JSON.parse(run("cargo", ["metadata", "--manifest-path", manifest, "--format-version", "1", "--locked"]));
  const rows = [];
  for (const item of metadata.packages) {
    if (metadata.workspace_members.includes(item.id)) continue;
    const directory = path.dirname(item.manifest_path);
    const destination = path.join(outputRoot, "cargo", safeName(`${item.name}@${item.version}`));
    const copied = copyLicenseFiles(directory, destination);
    rows.push([item.name, item.version, item.license || "請參閱授權原文", copied]);
  }
  return rows.sort((left, right) => left[0].localeCompare(right[0], "en"));
}

function table(title, rows) {
  return [
    `## ${title}`,
    "",
    "| 套件 | 版本 | 授權 | 授權檔數 |",
    "|---|---:|---|---:|",
    ...rows.map(([name, version, license, copied]) => `| ${name} | ${version} | ${String(license).replaceAll("|", "\\|")} | ${copied} |`),
    "",
  ];
}

rmSync(outputRoot, { recursive: true, force: true });
mkdirSync(outputRoot, { recursive: true });

const npmRows = collectNpmLicenses();
const cargoRows = collectCargoLicenses();
const python = process.env.DOCUMENT_WORKBENCH_PYTHON || (process.platform === "win32" ? "python" : "python3");
run(python, [path.join(here, "generate_python_licenses.py"), "--output", path.join(outputRoot, "python")], { stdio: "inherit" });

const npmFiles = npmRows.reduce((total, row) => total + row[3], 0);
const cargoFiles = cargoRows.reduce((total, row) => total + row[3], 0);
if (npmRows.length < 5 || cargoRows.length < 20 || npmFiles < 5 || cargoFiles < 20) {
  throw new Error("npm／Cargo 第三方授權封裝不完整");
}

const summary = [
  "# 全能文件工作台第三方授權封裝",
  "",
  "此目錄由 `npm run legal:bundle` 依當次鎖定相依套件自動產生，並隨 App 一起散布。",
  "整體程式採 `AGPL-3.0-or-later`；各上游元件仍保留本目錄內的版權與授權告知。",
  "",
  ...table("npm／前端套件", npmRows),
  ...table("Cargo／Rust 套件", cargoRows),
  "## Python／PDF sidecar",
  "",
  "請參閱 `python/README.md` 與各套件子目錄。",
  "",
  `統計：npm ${npmRows.length} 個套件／${npmFiles} 份授權檔；Cargo ${cargoRows.length} 個套件／${cargoFiles} 份授權檔。`,
  "",
  `對應原始碼：<https://github.com/WhaleChao/OpenDeskTW>` ,
  "",
];
writeFileSync(path.join(outputRoot, "README.md"), summary.join("\n"), "utf8");
writeFileSync(
  path.join(outputRoot, "dependency-manifest.json"),
  `${JSON.stringify({
    npm: npmRows.map(([name, version, license]) => ({ name, version, license })),
    cargo: cargoRows.map(([name, version, license]) => ({ name, version, license })),
  }, null, 2)}\n`,
  "utf8",
);

copyFileSync(path.join(repositoryRoot, "LICENSE"), path.join(outputRoot, "AGPL-3.0.txt"));
copyFileSync(path.join(repositoryRoot, "THIRD_PARTY_NOTICES.md"), path.join(outputRoot, "PROJECT-THIRD-PARTY-NOTICES.md"));
console.log(`第三方授權封裝：npm ${npmRows.length}、Cargo ${cargoRows.length}，已包含 Python sidecar 清單`);
