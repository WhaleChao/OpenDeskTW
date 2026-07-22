import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, "..");
const repositoryRoot = path.resolve(projectRoot, "..");
const version = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")).version;
const distRoot = path.join(projectRoot, "dist");
const stageRoot = path.join(distRoot, `corresponding-source-${version}`);
const sourcesRoot = path.join(stageRoot, "sources");
const finalArchive = path.join(
  distRoot,
  `complete-document-workbench-${version}-corresponding-source.tar.gz`,
);
const finalChecksum = `${finalArchive}.sha256`;
const dependencyManifestPath = path.join(
  projectRoot,
  "src-tauri/resources/licenses/third-party/dependency-manifest.json",
);
const pythonManifestPath = path.join(
  projectRoot,
  "src-tauri/resources/licenses/third-party/python/packages.json",
);

function safeName(value) {
  return value.replace(/[^A-Za-z0-9._@+-]+/g, "_");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw result.error || new Error(result.stderr || `${command} 執行失敗（${result.status}）`);
  }
  return result.stdout;
}

function digest(buffer, algorithm, encoding = "hex") {
  return createHash(algorithm).update(buffer).digest(encoding);
}

async function download(url, destination, expected = {}) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) {
    throw new Error(`下載失敗：${response.status} ${url}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (expected.integrity) {
    const [algorithm, wanted] = expected.integrity.split("-", 2);
    const actual = digest(bytes, algorithm, "base64");
    if (actual !== wanted) throw new Error(`npm 完整性驗證失敗：${url}`);
  } else if (expected.sha1 && digest(bytes, "sha1") !== expected.sha1) {
    throw new Error(`npm SHA-1 驗證失敗：${url}`);
  }
  if (expected.sha256 && digest(bytes, "sha256") !== expected.sha256) {
    throw new Error(`PyPI SHA-256 驗證失敗：${url}`);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
  return {
    file: path.relative(stageRoot, destination),
    sha256: digest(bytes, "sha256"),
    bytes: bytes.length,
  };
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function consume() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, consume));
  return results;
}

function listFiles(root, current = root) {
  const files = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

rmSync(stageRoot, { recursive: true, force: true });
rmSync(finalArchive, { force: true });
rmSync(finalChecksum, { force: true });
mkdirSync(sourcesRoot, { recursive: true });

if (!existsSync(dependencyManifestPath) || !existsSync(pythonManifestPath)) {
  throw new Error("缺少相依套件清單；請先執行 npm run legal:bundle");
}
const dependencies = JSON.parse(readFileSync(dependencyManifestPath, "utf8"));
const pythonPackages = JSON.parse(readFileSync(pythonManifestPath, "utf8"));

console.log(`下載 ${dependencies.npm.length} 個 npm 原始碼封存檔……`);
const npmSources = await mapLimit(dependencies.npm, 8, async (item) => {
  const metadataUrl = `https://registry.npmjs.org/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}`;
  const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`無法取得 npm 中繼資料：${item.name}@${item.version}`);
  const metadata = await response.json();
  if (!metadata.dist?.tarball) throw new Error(`npm 套件缺少原始碼封存檔：${item.name}@${item.version}`);
  const destination = path.join(sourcesRoot, "npm", `${safeName(item.name)}-${item.version}.tgz`);
  const saved = await download(metadata.dist.tarball, destination, {
    integrity: metadata.dist.integrity,
    sha1: metadata.dist.shasum,
  });
  return { name: item.name, version: item.version, url: metadata.dist.tarball, ...saved };
});

console.log(`下載 ${pythonPackages.length} 個 Python sdist 原始碼封存檔……`);
const pythonSources = await mapLimit(pythonPackages, 8, async (item) => {
  const metadataUrl = `https://pypi.org/pypi/${encodeURIComponent(item.name)}/${encodeURIComponent(item.version)}/json`;
  const response = await fetch(metadataUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`無法取得 PyPI 中繼資料：${item.name}==${item.version}`);
  const metadata = await response.json();
  const source = metadata.urls.find((candidate) => candidate.packagetype === "sdist");
  if (!source?.url) throw new Error(`Python 套件沒有 sdist：${item.name}==${item.version}`);
  const destination = path.join(sourcesRoot, "python", safeName(source.filename));
  const saved = await download(source.url, destination, { sha256: source.digests?.sha256 });
  return { name: item.name, version: item.version, url: source.url, ...saved };
});

console.log(`封裝 ${dependencies.cargo.length} 個 Cargo 套件的實際原始碼……`);
const cargoMetadata = JSON.parse(
  run("cargo", [
    "metadata",
    "--manifest-path",
    path.join(projectRoot, "src-tauri/Cargo.toml"),
    "--format-version",
    "1",
    "--locked",
  ]),
);
const workspaceMembers = new Set(cargoMetadata.workspace_members);
const cargoPackages = cargoMetadata.packages.filter((item) => !workspaceMembers.has(item.id));
const cargoLookup = new Map(cargoPackages.map((item) => [`${item.name}@${item.version}`, item]));
const cargoSources = dependencies.cargo.map((item) => {
  const identity = `${item.name}@${item.version}`;
  const metadata = cargoLookup.get(identity);
  if (!metadata) throw new Error(`Cargo metadata 缺少鎖定套件：${identity}`);
  const sourceDirectory = path.dirname(metadata.manifest_path);
  const destination = path.join(sourcesRoot, "cargo", safeName(identity));
  cpSync(sourceDirectory, destination, { recursive: true, dereference: false });
  return {
    name: item.name,
    version: item.version,
    registry: metadata.source || "上游 Git／本機來源",
    directory: path.relative(stageRoot, destination),
  };
});

console.log("封裝本版本專案原始碼與法律告知……");
const projectArchive = path.join(sourcesRoot, `OpenDeskTW-${version}.tar.gz`);
run("git", [
  "archive",
  "--format=tar.gz",
  `--prefix=OpenDeskTW-${version}/`,
  "-o",
  projectArchive,
  "HEAD",
]);
for (const filename of ["LICENSE", "COPYRIGHT", "SOURCE_OFFER.md", "THIRD_PARTY_NOTICES.md"]) {
  copyFileSync(path.join(repositoryRoot, filename), path.join(stageRoot, filename));
}
cpSync(
  path.join(projectRoot, "src-tauri/resources/licenses/third-party"),
  path.join(stageRoot, "third-party-licenses"),
  { recursive: true },
);

const manifest = {
  product: "全能文件工作台",
  version,
  generatedAt: new Date().toISOString(),
  project: {
    repository: "https://github.com/WhaleChao/OpenDeskTW",
    archive: path.relative(stageRoot, projectArchive),
    revision: run("git", ["rev-parse", "HEAD"]).trim(),
  },
  counts: {
    npm: npmSources.length,
    cargo: cargoSources.length,
    python: pythonSources.length,
  },
  npm: npmSources,
  cargo: cargoSources,
  python: pythonSources,
};
writeFileSync(path.join(stageRoot, "SOURCE_MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const checksumLines = listFiles(stageRoot)
  .filter((file) => path.basename(file) !== "SHA256SUMS")
  .sort((left, right) => left.localeCompare(right, "en"))
  .map((file) => `${digest(readFileSync(file), "sha256")}  ${path.relative(stageRoot, file)}`);
writeFileSync(path.join(stageRoot, "SHA256SUMS"), `${checksumLines.join("\n")}\n`, "utf8");

run("tar", ["-czf", finalArchive, "-C", stageRoot, "."]);
const archiveHash = digest(readFileSync(finalArchive), "sha256");
writeFileSync(finalChecksum, `${archiveHash}  ${path.basename(finalArchive)}\n`, "utf8");

const megabytes = (statSync(finalArchive).size / 1024 / 1024).toFixed(1);
console.log(`AGPL 對應原始碼包：${finalArchive}（${megabytes} MB）`);
console.log(`SHA-256：${archiveHash}`);
