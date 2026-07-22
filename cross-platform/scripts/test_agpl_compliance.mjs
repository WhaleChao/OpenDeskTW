import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const read = (relative) => readFileSync(path.join(repositoryRoot, relative), "utf8");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const license = read("LICENSE");
assert(license.includes("GNU AFFERO GENERAL PUBLIC LICENSE"), "根目錄缺少完整 AGPL 條文");
assert(license.includes("Version 3, 19 November 2007"), "AGPL 版本文字不正確");
assert(
  license === read("cross-platform/src-tauri/resources/licenses/AGPL-3.0.txt"),
  "安裝包內 AGPL 條文與根目錄不一致",
);

const packageManifest = JSON.parse(read("cross-platform/package.json"));
const packageLock = JSON.parse(read("cross-platform/package-lock.json"));
assert(packageManifest.license === "AGPL-3.0-or-later", "package.json 未標示 AGPL");
assert(packageLock.packages[""].license === "AGPL-3.0-or-later", "package-lock 未標示 AGPL");
assert(packageManifest.scripts["legal:bundle"], "缺少第三方授權封裝指令");
assert(packageManifest.scripts["legal:source"], "缺少對應原始碼封裝指令");
assert(existsSync(path.join(projectRoot, "scripts/generate_corresponding_source_bundle.mjs")), "缺少對應原始碼產生器");
assert(read("SOURCE_OFFER.md").includes("對應原始碼"), "根目錄缺少對應原始碼說明");
assert(read("cross-platform/src-tauri/resources/licenses/SOURCE_OFFER.md").includes("對應原始碼"), "安裝包缺少對應原始碼說明");

const cargo = read("cross-platform/src-tauri/Cargo.toml");
assert(cargo.includes('license = "AGPL-3.0-or-later"'), "Cargo 套件未標示 AGPL");
const acropdf = read("cross-platform/src-tauri/resources/acropdf-core/ACROPDF-LICENSE");
assert(acropdf.includes("AGPL-3.0-or-later"), "AcroPDF 衍生核心未重新授權為 AGPL");
assert(!acropdf.includes("Proprietary License"), "AcroPDF 仍殘留專有授權");

const interfaceText = read("cross-platform/src/index.html");
const frontend = read("cross-platform/src/main.js");
const backend = read("cross-platform/src-tauri/src/lib.rs");
for (const marker of ["GNU AGPL v3+", "本程式不附帶任何擔保", "檢視原始碼", "完整授權條文", "第三方授權", "對應原始碼說明"]) {
  assert(interfaceText.includes(marker), `互動介面缺少法律告知：${marker}`);
}
assert(frontend.includes('invoke("read_legal_document"'), "介面無法讀取安裝包內授權條文");
assert(frontend.includes('invoke("open_source_repository"'), "介面缺少對應原始碼入口");
assert(backend.includes("fn read_legal_document"), "後端缺少本機授權文件命令");
assert(backend.includes("fn open_source_repository"), "後端缺少原始碼入口命令");

const tauri = JSON.parse(read("cross-platform/src-tauri/tauri.conf.json"));
assert(tauri.build.beforeBuildCommand.includes("legal:bundle"), "正式安裝包未強制產生第三方授權封裝");
const release = read(".github/workflows/release.yml");
assert(release.includes("AGPL-3.0-or-later"), "Release 說明缺少 AGPL 與對應原始碼告知");
assert(release.includes("npm run legal:source"), "Release 未自動建立對應原始碼包");
assert(release.includes("第三方對應原始碼.tar.gz"), "Release 未上傳對應原始碼包");

const bundleRoot = path.join(projectRoot, "src-tauri/resources/licenses/third-party");
assert(existsSync(path.join(bundleRoot, "README.md")), "缺少第三方授權封裝摘要");
assert(existsSync(path.join(bundleRoot, "python/README.md")), "缺少 Python 授權封裝摘要");
const groups = ["npm", "cargo", "python"];
for (const group of groups) {
  const directory = path.join(bundleRoot, group);
  assert(existsSync(directory), `缺少 ${group} 授權目錄`);
  assert(readdirSync(directory).length >= 5, `${group} 授權目錄內容不足`);
}

console.log("AGPL 發行檢查：PASS（完整條文、App 告知、原始碼入口、第三方授權封裝）");
