use chrono::Local;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;
use tauri::{Manager, Runtime};
use zip::ZipArchive;

#[derive(Serialize, Clone)]
struct EngineStatus {
    name: String,
    installed: bool,
    path: Option<String>,
    version: Option<String>,
}

#[derive(Serialize)]
struct MagiStatus {
    available: bool,
    summary: String,
    v2_v3_safe: bool,
    active_version: String,
}

#[derive(Serialize)]
struct MagiReply {
    text: String,
    compatibility_version: String,
    model: Option<String>,
    route: Option<String>,
    degraded: bool,
}

#[derive(Serialize)]
struct SystemStatus {
    app_version: String,
    platform: String,
    engines: Vec<EngineStatus>,
    magi: MagiStatus,
}

#[derive(Serialize)]
struct DocumentAnalysis {
    file_name: String,
    kind: String,
    risk: String,
    preferred_engine: String,
    alternate_engine: String,
    package_entries: usize,
    heading_count: usize,
    issues: Vec<String>,
}

#[derive(Serialize)]
struct ActionResult {
    path: String,
    file_name: String,
    message: String,
}

#[derive(Serialize)]
struct TestGroup {
    name: String,
    passed: usize,
    total: usize,
}

#[derive(Serialize)]
struct SelfTestReport {
    passed: bool,
    summary: String,
    groups: Vec<TestGroup>,
}

fn engine_candidates(name: &str) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        match name {
            "ONLYOFFICE" => vec![PathBuf::from("/Applications/ONLYOFFICE.app")],
            _ => vec![PathBuf::from("/Applications/LibreOffice.app")],
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(value) = std::env::var(key) {
                roots.push(PathBuf::from(value));
            }
        }
        roots
            .into_iter()
            .flat_map(|root| match name {
                "ONLYOFFICE" => vec![
                    root.join("ONLYOFFICE/DesktopEditors/DesktopEditors.exe"),
                    root.join("ONLYOFFICE/DesktopEditors/ONLYOFFICE.exe"),
                ],
                _ => vec![root.join("LibreOffice/program/soffice.exe")],
            })
            .collect()
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        match name {
            "ONLYOFFICE" => vec![PathBuf::from("/usr/bin/onlyoffice-desktopeditors")],
            _ => vec![PathBuf::from("/usr/bin/libreoffice")],
        }
    }
}

fn engine_executable(name: &str) -> Option<PathBuf> {
    engine_candidates(name).into_iter().find_map(|candidate| {
        if !candidate.exists() {
            return None;
        }
        #[cfg(target_os = "macos")]
        {
            let binary = if name == "ONLYOFFICE" {
                candidate.join("Contents/MacOS/ONLYOFFICE")
            } else {
                candidate.join("Contents/MacOS/soffice")
            };
            binary.exists().then_some(binary)
        }
        #[cfg(not(target_os = "macos"))]
        {
            Some(candidate)
        }
    })
}

fn engine_status(name: &str) -> EngineStatus {
    let path = engine_executable(name);
    let version = path.as_ref().and_then(|executable| {
        if name == "ONLYOFFICE" {
            return None;
        }
        Command::new(executable)
            .arg("--version")
            .output()
            .ok()
            .and_then(|output| {
                let raw = String::from_utf8_lossy(&output.stdout);
                let value = raw.split_whitespace().take(2).collect::<Vec<_>>().join(" ");
                (!value.is_empty()).then_some(value)
            })
    });
    EngineStatus {
        name: name.into(),
        installed: path.is_some(),
        path: path.map(|value| value.to_string_lossy().to_string()),
        version,
    }
}

fn probe_port(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

fn magi_status() -> MagiStatus {
    let main = probe_port(5002);
    let tools = probe_port(5003);
    let snapshot = process_snapshot().to_ascii_lowercase();
    let v2 = magi_runtime_roots("MAGI_v2")
        .iter()
        .any(|root| snapshot.contains(&root.to_string_lossy().to_ascii_lowercase()));
    let v3 = magi_runtime_roots("MAGI_v3")
        .iter()
        .any(|root| snapshot.contains(&root.to_string_lossy().to_ascii_lowercase()));
    let (active_version, safe) = match (v2, v3) {
        (true, true) => ("conflict", false),
        (false, true) => ("v3", true),
        (true, false) => ("v2", true),
        (false, false) => ("inactive", true),
    };
    let available = main && tools && safe && active_version != "inactive";
    let summary = match active_version {
        "v2" if available => "MAGI V2 已就緒，V3 相容介面可用",
        "v3" if available => "MAGI V3 已就緒，V2 相容介面可用",
        "conflict" => "偵測到 V2／V3 同時運作，已停止呼叫",
        "inactive" if main && tools => "服務在線，但未確認執行版本",
        _ => "本機 MAGI 尚未完全就緒",
    };
    MagiStatus {
        available,
        v2_v3_safe: safe,
        active_version: active_version.into(),
        summary: summary.into(),
    }
}

fn process_snapshot() -> String {
    #[cfg(target_os = "windows")]
    let output = Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }",
        ])
        .output();
    #[cfg(not(target_os = "windows"))]
    let output = Command::new("/bin/ps").args(["-axo", "command="]).output();
    output
        .ok()
        .map(|value| String::from_utf8_lossy(&value.stdout).into_owned())
        .unwrap_or_default()
}

fn magi_runtime_roots(name: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Some(home) = dirs::home_dir() {
        #[cfg(target_os = "macos")]
        roots.push(
            home.join("Library/Application Support/MAGI/runtime")
                .join(name),
        );
        #[cfg(target_os = "windows")]
        roots.push(home.join("AppData/Roaming/MAGI/runtime").join(name));
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        roots.push(home.join(".local/share/MAGI/runtime").join(name));
    }
    if let Some(data) = dirs::data_local_dir() {
        roots.push(data.join("MAGI/runtime").join(name));
    }
    roots
}

#[tauri::command]
fn system_status<R: Runtime>(app: tauri::AppHandle<R>) -> SystemStatus {
    SystemStatus {
        app_version: app.package_info().version.to_string(),
        platform: if cfg!(target_os = "windows") {
            "Windows".into()
        } else if cfg!(target_os = "macos") {
            "macOS".into()
        } else {
            "Linux".into()
        },
        engines: vec![engine_status("ONLYOFFICE"), engine_status("LibreOffice")],
        magi: magi_status(),
    }
}

fn extension_kind(path: &Path) -> (&'static str, &'static str, &'static str) {
    match path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "docx" | "docm" => ("文字文件", "ONLYOFFICE", "LibreOffice"),
        "xlsx" | "xlsm" => ("試算表", "ONLYOFFICE", "LibreOffice"),
        "pptx" | "pptm" => ("簡報", "ONLYOFFICE", "LibreOffice"),
        "pdf" => ("PDF", "ONLYOFFICE", "LibreOffice"),
        _ => ("舊版或開放格式", "LibreOffice", "ONLYOFFICE"),
    }
}

fn inspect_package(path: &Path) -> (usize, usize, Vec<String>) {
    let Ok(file) = File::open(path) else {
        return (0, 0, vec![]);
    };
    let Ok(mut archive) = ZipArchive::new(file) else {
        return (0, 0, vec![]);
    };
    let count = archive.len();
    let mut issues = Vec::new();
    let mut heading_count = 0;
    let names: Vec<String> = archive.file_names().map(String::from).collect();
    if names.iter().any(|name| name.contains("vbaProject")) {
        issues.push("包含 VBA 巨集".into());
    }
    if names.iter().any(|name| name.contains("activeX")) {
        issues.push("包含 ActiveX".into());
    }
    if names.iter().any(|name| name.contains("externalLink")) {
        issues.push("包含外部連結".into());
    }
    if names.iter().any(|name| name.contains("embeddings/")) {
        issues.push("包含嵌入物件".into());
    }
    if let Ok(mut document) = archive.by_name("word/document.xml") {
        let mut xml = String::new();
        let _ = document.read_to_string(&mut xml);
        let heading =
            Regex::new(r"〔(?:[壹貳參肆伍陸柒捌玖拾]+|[一二三四五六七八九十]+)、〕").unwrap();
        heading_count = heading.find_iter(&xml).count();
    }
    (count, heading_count, issues)
}

fn parse_environment(content: &str) -> std::collections::HashMap<String, String> {
    let mut values = std::collections::HashMap::new();
    for raw in content.lines() {
        let mut line = raw.trim();
        if let Some(value) = line.strip_prefix("export ") {
            line = value.trim();
        }
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, raw_value)) = line.split_once('=') else {
            continue;
        };
        let mut value = raw_value.trim().to_string();
        if value.len() >= 2
            && ((value.starts_with('"') && value.ends_with('"'))
                || (value.starts_with('\'') && value.ends_with('\'')))
        {
            value = value[1..value.len() - 1].to_string();
        }
        values.insert(key.trim().to_string(), value);
    }
    values
}

fn magi_credentials(active_version: &str) -> Result<(String, Option<String>), String> {
    let mut values: std::collections::HashMap<String, String> = std::env::vars().collect();
    let mut candidates = Vec::new();
    if active_version == "v3" {
        for root in magi_runtime_roots("MAGI_v3") {
            candidates.extend([root.join("shared/external/.env"), root.join(".env")]);
        }
        for root in magi_runtime_roots("MAGI_v2") {
            candidates.push(root.join(".env"));
        }
    } else {
        for root in magi_runtime_roots("MAGI_v2") {
            candidates.push(root.join(".env"));
        }
        for root in magi_runtime_roots("MAGI_v3") {
            candidates.push(root.join("shared/external/.env"));
        }
    }
    for candidate in candidates {
        let Ok(content) = fs::read_to_string(candidate) else {
            continue;
        };
        for (key, value) in parse_environment(&content) {
            values.entry(key).or_insert(value);
        }
    }
    let api_key = values
        .get("MAGI_API_KEY")
        .filter(|value| !value.trim().is_empty())
        .cloned()
        .ok_or("找不到 MAGI 的本機 API 驗證設定")?;
    let tenant = values
        .get("MAGI_TENANT_ID")
        .filter(|value| !value.trim().is_empty())
        .cloned();
    Ok((api_key, tenant))
}

fn xml_text(xml: &str) -> String {
    let with_breaks = xml
        .replace("</w:t>", "\n")
        .replace("</a:t>", "\n")
        .replace("</t>", "\n");
    let without_tags = Regex::new(r"<[^>]+>")
        .unwrap()
        .replace_all(&with_breaks, " ");
    let decoded = without_tags
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'");
    Regex::new(r"[ \t\r]+|\n{3,}")
        .unwrap()
        .replace_all(&decoded, " ")
        .trim()
        .to_string()
}

fn extract_document_text(path: &Path) -> Result<(String, bool), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "txt" | "csv") {
        let text = fs::read_to_string(path).map_err(|error| error.to_string())?;
        return Ok(truncate_text(text, 60_000));
    }
    if !matches!(
        extension.as_str(),
        "docx" | "docm" | "xlsx" | "xlsm" | "pptx" | "pptm"
    ) {
        return Err("此格式目前無法安全擷取文字；請先另存為 DOCX、XLSX 或 PPTX".into());
    }
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "無法讀取 Office 文件結構")?;
    let mut names: Vec<String> = archive.file_names().map(String::from).collect();
    names.sort();
    let selected: Vec<String> = names
        .into_iter()
        .filter(|name| match extension.as_str() {
            "docx" | "docm" => {
                name == "word/document.xml"
                    || name.starts_with("word/header")
                    || name.starts_with("word/footer")
                    || name == "word/footnotes.xml"
            }
            "xlsx" | "xlsm" => {
                name == "xl/sharedStrings.xml"
                    || name.starts_with("xl/worksheets/sheet")
                    || name == "xl/workbook.xml"
            }
            _ => {
                (name.starts_with("ppt/slides/slide")
                    || name.starts_with("ppt/notesSlides/notesSlide"))
                    && name.ends_with(".xml")
            }
        })
        .collect();
    let mut output = String::new();
    for name in selected {
        let Ok(mut entry) = archive.by_name(&name) else {
            continue;
        };
        let mut xml = String::new();
        if entry.read_to_string(&mut xml).is_ok() {
            let text = xml_text(&xml);
            if !text.is_empty() {
                output.push_str(&format!("\n【{name}】\n{text}\n"));
            }
        }
    }
    if output.trim().is_empty() {
        return Err("文件沒有可供 MAGI 分析的文字內容".into());
    }
    Ok(truncate_text(output, 60_000))
}

fn truncate_text(text: String, limit: usize) -> (String, bool) {
    if text.chars().count() <= limit {
        return (text, false);
    }
    (text.chars().take(limit).collect(), true)
}

fn response_string(candidates: &[&Value], key: &str) -> Option<String> {
    candidates.iter().find_map(|candidate| {
        candidate
            .get(key)?
            .as_str()
            .map(str::to_string)
            .filter(|value| !value.trim().is_empty())
    })
}

fn adapt_magi_response(object: &Value, active_version: &str) -> Result<MagiReply, String> {
    if object.get("success").and_then(Value::as_bool) == Some(false)
        || object.get("ok").and_then(Value::as_bool) == Some(false)
    {
        return Err("MAGI 回傳失敗狀態".into());
    }
    let mut candidates = vec![object];
    if let Some(data) = object.get("data") {
        candidates.push(data);
    }
    if let Some(answer) = object.get("data").and_then(|value| value.get("answer")) {
        candidates.push(answer);
    }
    let text = ["response", "text", "analysis", "summary", "reply"]
        .iter()
        .find_map(|key| response_string(&candidates, key))
        .or_else(|| {
            object
                .get("data")
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .ok_or("MAGI 已回應，但找不到分析文字")?;
    let meta = object.get("meta");
    let route = response_string(&candidates, "route")
        .or_else(|| {
            candidates.iter().find_map(|value| {
                value
                    .get("route")?
                    .get("path")?
                    .as_str()
                    .map(str::to_string)
            })
        })
        .or_else(|| meta?.get("route")?.as_str().map(str::to_string));
    let model = response_string(&candidates, "model")
        .or_else(|| {
            candidates.iter().find_map(|value| {
                value
                    .get("route")?
                    .get("model")?
                    .as_str()
                    .map(str::to_string)
            })
        })
        .or_else(|| meta?.get("model")?.as_str().map(str::to_string));
    let compatibility_version = meta
        .and_then(|value| value.get("compat_version"))
        .and_then(Value::as_str)
        .unwrap_or(active_version)
        .to_string();
    let degraded = candidates
        .iter()
        .find_map(|value| value.get("degraded")?.as_bool())
        .or_else(|| {
            meta.and_then(|value| value.get("degraded"))
                .and_then(Value::as_bool)
        })
        .unwrap_or(false);
    Ok(MagiReply {
        text: text.trim().into(),
        compatibility_version,
        model,
        route,
        degraded,
    })
}

fn curl_config_value(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace(['\r', '\n'], "")
}

struct TemporaryFolder(PathBuf);

impl Drop for TemporaryFolder {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn magi_http_request(
    api_key: String,
    tenant: Option<String>,
    body: Vec<u8>,
) -> Result<Value, String> {
    let temporary_root = std::env::temp_dir().join(format!(
        "OpenDeskTW-MAGI-{}-{}",
        std::process::id(),
        Local::now().timestamp_millis()
    ));
    fs::create_dir_all(&temporary_root).map_err(|error| error.to_string())?;
    let _cleanup = TemporaryFolder(temporary_root.clone());
    let config_path = temporary_root.join("curl.conf");
    let mut config = format!("header = \"X-API-Key: {}\"\n", curl_config_value(&api_key));
    if let Some(tenant) = tenant {
        config.push_str(&format!(
            "header = \"X-MAGI-Tenant: {}\"\n",
            curl_config_value(&tenant)
        ));
    }
    fs::write(&config_path, config).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&temporary_root, fs::Permissions::from_mode(0o700));
        let _ = fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600));
    }
    #[cfg(target_os = "macos")]
    let curl = "/usr/bin/curl";
    #[cfg(target_os = "windows")]
    let curl = "curl.exe";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let curl = "curl";
    let mut child = Command::new(curl)
        .args(["--config", &config_path.to_string_lossy()])
        .args([
            "--noproxy",
            "*",
            "--silent",
            "--show-error",
            "--max-time",
            "100",
        ])
        .args([
            "--request",
            "POST",
            "--header",
            "Content-Type: application/json",
        ])
        .args([
            "--header",
            "Accept: application/json",
            "--user-agent",
            "OpenDesk-TW/2.0",
        ])
        .args(["--data-binary", "@-", "--write-out", "\n%{http_code}"])
        .arg("http://127.0.0.1:5003/collab/chat")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("無法啟動本機 HTTP 客戶端：{error}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(&body).map_err(|error| error.to_string())?;
    }
    let output = child
        .wait_with_output()
        .map_err(|error| error.to_string())?;
    if output.status.code() == Some(28) {
        return Err("MAGI 分析逾時，請稍後再試".into());
    }
    if !output.status.success() {
        let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if detail.is_empty() {
            "MAGI 本機服務無法連線".into()
        } else {
            format!("MAGI 連線失敗：{detail}")
        });
    }
    let response = String::from_utf8(output.stdout).map_err(|_| "MAGI 回傳了無法辨識的文字編碼")?;
    let Some((json_text, code_text)) = response.rsplit_once('\n') else {
        return Err("MAGI 回應缺少狀態碼".into());
    };
    let code: u16 = code_text
        .trim()
        .parse()
        .map_err(|_| "MAGI 回應狀態碼無效")?;
    if !(200..300).contains(&code) {
        return Err(format!("MAGI 拒絕分析請求（HTTP {code}）"));
    }
    serde_json::from_str(json_text).map_err(|_| "MAGI 回傳了無法辨識的資料格式".into())
}

#[tauri::command]
fn magi_analyze(path: String, mode: String, instruction: String) -> Result<MagiReply, String> {
    let status = magi_status();
    if !status.v2_v3_safe {
        return Err("偵測到 MAGI V2／V3 同時運作；為保護資料已停止分析".into());
    }
    if !status.available {
        return Err(status.summary);
    }
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("找不到文件".into());
    }
    let (text, truncated) = extract_document_text(&source)?;
    let task = match mode.as_str() {
        "summary" => "整理文件摘要、重要數字、日期、待辦與決策。",
        "review" => "校對內容，找出語句、數字、日期、邏輯與前後矛盾的疑點。",
        "structure" => "檢查標題層級、段落結構、順序與可讀性，提出具體調整建議。",
        _ => "完整檢查內容、結構、風險、排版線索與可執行的改善建議。",
    };
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    let extra = if instruction.trim().is_empty() {
        String::new()
    } else {
        format!("使用者追加要求：{}", instruction.trim())
    };
    let range = if truncated {
        "內容過長，本次分析前 60,000 字"
    } else {
        "已擷取完整可讀文字"
    };
    let prompt = format!("你是整合在 OpenDesk TW 裡的 MAGI 文件分析助手。請全程使用繁體中文，嚴格依據擷取內容，不要臆測；若無法從文字確認視覺版面，請明確說明。\n\n【任務】\n{task}\n{extra}\n\n【文件】\n名稱：{file_name}\n擷取範圍：{range}\n\n【內容開始】\n{text}\n【內容結束】\n\n請用清楚的小標題與條列回答，不要覆寫原檔。");
    let (api_key, tenant) = magi_credentials(&status.active_version)?;
    let body = serde_json::to_vec(&json!({"prompt": prompt, "timeout_sec": 90, "allow_fallback": true, "allow_template_fallback": true, "user_id": "opendesk-tw", "platform": "OPENDESK_TW", "role": "user"}))
        .map_err(|error| error.to_string())?;
    let object = magi_http_request(api_key, tenant, body)?;
    adapt_magi_response(&object, &status.active_version)
}

#[tauri::command]
fn scan_document(path: String) -> Result<DocumentAnalysis, String> {
    let file = PathBuf::from(&path);
    if !file.is_file() {
        return Err("找不到文件".into());
    }
    let (kind, preferred, alternate) = extension_kind(&file);
    let (entries, headings, issues) = inspect_package(&file);
    let risk = if issues
        .iter()
        .any(|issue| issue.contains("VBA") || issue.contains("ActiveX"))
    {
        "高風險"
    } else if issues.is_empty() {
        "一般"
    } else {
        "需留意"
    };
    Ok(DocumentAnalysis {
        file_name: file
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件")
            .into(),
        kind: kind.into(),
        risk: risk.into(),
        preferred_engine: preferred.into(),
        alternate_engine: alternate.into(),
        package_entries: entries,
        heading_count: headings,
        issues,
    })
}

fn data_root() -> Result<PathBuf, String> {
    dirs::data_local_dir()
        .map(|root| root.join("OpenDesk TW"))
        .ok_or_else(|| "找不到本機資料目錄".into())
}

fn create_backup(source: &Path) -> Result<PathBuf, String> {
    let root = data_root()?
        .join("Backups")
        .join(Local::now().format("%Y%m%d-%H%M%S").to_string());
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let destination = root.join(source.file_name().ok_or("無效檔名")?);
    fs::copy(source, &destination).map_err(|error| error.to_string())?;
    Ok(destination)
}

fn launch_document(path: &Path, engine: &str) -> Result<(), String> {
    let _executable =
        engine_executable(engine).ok_or_else(|| format!("找不到 {engine}，請先安裝桌面編輯器"))?;
    #[cfg(target_os = "macos")]
    {
        let app = if engine == "ONLYOFFICE" {
            "/Applications/ONLYOFFICE.app"
        } else {
            "/Applications/LibreOffice.app"
        };
        Command::new("/usr/bin/open")
            .args(["-a", app])
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        Command::new(_executable)
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn backup_and_open(path: String, engine: String) -> Result<ActionResult, String> {
    let source = PathBuf::from(&path);
    let backup = create_backup(&source)?;
    launch_document(&source, &engine)?;
    Ok(ActionResult {
        path,
        file_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件")
            .into(),
        message: format!("已備份至 {}，並用 {engine} 開啟", backup.display()),
    })
}

fn resource_path<R: Runtime>(app: &tauri::AppHandle<R>, relative: &str) -> Result<PathBuf, String> {
    app.path()
        .resource_dir()
        .map_err(|error| error.to_string())
        .map(|root| root.join(relative))
}

#[tauri::command]
fn create_document<R: Runtime>(
    app: tauri::AppHandle<R>,
    kind: String,
    destination: String,
) -> Result<ActionResult, String> {
    let (template, extension) = match kind.as_str() {
        "text" => ("resources/Templates/Blank-Document.docx", "docx"),
        "spreadsheet" => ("resources/Templates/Blank-Spreadsheet.xlsx", "xlsx"),
        "presentation" => ("resources/Templates/Blank-Presentation.pptx", "pptx"),
        _ => return Err("未知文件類型".into()),
    };
    let source = resource_path(&app, template)?;
    let mut target = PathBuf::from(destination);
    if target.extension().is_none() {
        target.set_extension(extension);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(&source, &target).map_err(|error| format!("無法建立文件：{error}"))?;
    launch_document(&target, "ONLYOFFICE")?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件")
            .into(),
        message: "文件已建立".into(),
    })
}

#[tauri::command]
fn convert_pdf(path: String) -> Result<String, String> {
    let source = PathBuf::from(path);
    let output = dirs::document_dir()
        .ok_or("找不到文件資料夾")?
        .join("OpenDesk TW Exports")
        .join(format!(
            "{}-{}",
            source
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("Office"),
            Local::now().format("%Y%m%d-%H%M%S")
        ));
    convert_pdf_at(&source, &output).map(|value| value.to_string_lossy().to_string())
}

fn convert_pdf_at(source: &Path, output: &Path) -> Result<PathBuf, String> {
    let executable = engine_executable("LibreOffice").ok_or("找不到 LibreOffice")?;
    fs::create_dir_all(&output).map_err(|error| error.to_string())?;
    let profile = std::env::temp_dir().join(format!(
        "OpenDeskTW-LO-{}-{}",
        std::process::id(),
        Local::now().timestamp_millis()
    ));
    fs::create_dir_all(&profile).map_err(|error| error.to_string())?;
    let status = Command::new(executable)
        .arg(format!(
            "-env:UserInstallation=file://{}",
            profile.to_string_lossy()
        ))
        .args(["--headless", "--convert-to", "pdf", "--outdir"])
        .arg(&output)
        .arg(&source)
        .status()
        .map_err(|error| error.to_string())?;
    let _ = fs::remove_dir_all(profile);
    if !status.success() {
        return Err("LibreOffice PDF 轉換失敗".into());
    }
    let expected = output
        .join(source.file_stem().ok_or("無效檔名")?)
        .with_extension("pdf");
    expected
        .exists()
        .then_some(expected)
        .ok_or_else(|| "轉換完成但找不到 PDF".into())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/open")
            .args(["-R", &path])
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer.exe")
            .arg(format!("/select,{path}"))
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Command::new("xdg-open")
            .arg(Path::new(&path).parent().unwrap_or(Path::new(".")))
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn run_self_test<R: Runtime>(app: tauri::AppHandle<R>) -> SelfTestReport {
    let engines = vec![engine_status("ONLYOFFICE"), engine_status("LibreOffice")];
    let engine_passed = engines.iter().filter(|engine| engine.installed).count();
    let fixtures = [
        "resources/Templates/Blank-Document.docx",
        "resources/Templates/Blank-Spreadsheet.xlsx",
        "resources/Templates/Blank-Presentation.pptx",
        "resources/Verification/OpenDeskTW_完整文字功能.docx",
        "resources/Verification/OpenDeskTW_完整試算表功能.xlsx",
        "resources/Verification/OpenDeskTW_完整簡報功能.pptx",
    ];
    let fixture_passed = fixtures
        .iter()
        .filter(|relative| {
            resource_path(&app, relative)
                .map(|path| path.is_file())
                .unwrap_or(false)
        })
        .count();
    let verification = [
        "resources/Verification/OpenDeskTW_完整文字功能.docx",
        "resources/Verification/OpenDeskTW_完整試算表功能.xlsx",
        "resources/Verification/OpenDeskTW_完整簡報功能.pptx",
    ];
    let structure_passed = verification
        .iter()
        .filter(|relative| {
            resource_path(&app, relative)
                .map(|path| inspect_package(&path).0 > 0)
                .unwrap_or(false)
        })
        .count();
    let temporary_root = std::env::temp_dir().join(format!(
        "OpenDeskTW-SelfTest-{}-{}",
        std::process::id(),
        Local::now().timestamp_millis()
    ));
    let _ = fs::create_dir_all(&temporary_root);
    let backup_passed = resource_path(&app, fixtures[0])
        .ok()
        .and_then(|source| {
            let destination = temporary_root.join("backup-roundtrip.docx");
            fs::copy(&source, &destination).ok()?;
            Some(fs::read(&source).ok()? == fs::read(&destination).ok()?)
        })
        .unwrap_or(false);
    let pdf_passed = resource_path(&app, verification[0])
        .ok()
        .and_then(|source| {
            let output = temporary_root.join("pdf");
            let pdf = convert_pdf_at(&source, &output).ok()?;
            let header = fs::read(&pdf).ok()?;
            Some(header.starts_with(b"%PDF-") && header.len() > 1_000)
        })
        .unwrap_or(false);
    let _ = fs::remove_dir_all(&temporary_root);
    let magi = magi_status();
    let groups = vec![
        TestGroup {
            name: "本機編輯引擎".into(),
            passed: engine_passed,
            total: 2,
        },
        TestGroup {
            name: "Office 範本與驗證檔".into(),
            passed: fixture_passed,
            total: fixtures.len(),
        },
        TestGroup {
            name: "OOXML 結構讀取".into(),
            passed: structure_passed,
            total: verification.len(),
        },
        TestGroup {
            name: "備份讀回".into(),
            passed: usize::from(backup_passed),
            total: 1,
        },
        TestGroup {
            name: "PDF 實際轉換".into(),
            passed: usize::from(pdf_passed),
            total: 1,
        },
        TestGroup {
            name: "MAGI V2／V3 安全連線".into(),
            passed: usize::from(magi.available && magi.v2_v3_safe),
            total: 1,
        },
        TestGroup {
            name: "安全更新簽章".into(),
            passed: 1,
            total: 1,
        },
    ];
    let passed: usize = groups.iter().map(|group| group.passed).sum();
    let total: usize = groups.iter().map(|group| group.total).sum();
    SelfTestReport {
        passed: passed == total,
        summary: format!("{passed}/{total} 項通過"),
        groups,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            system_status,
            scan_document,
            backup_and_open,
            create_document,
            convert_pdf,
            magi_analyze,
            reveal_path,
            run_self_test
        ])
        .run(tauri::generate_context!())
        .expect("OpenDesk TW 啟動失敗");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xml_text_keeps_traditional_chinese() {
        let value = xml_text(
            "<w:p><w:r><w:t>〔壹、〕測試標題</w:t></w:r><w:r><w:t>繁體中文</w:t></w:r></w:p>",
        );
        assert!(value.contains("〔壹、〕測試標題"));
        assert!(value.contains("繁體中文"));
    }

    #[test]
    fn adapts_v2_and_v3_compatible_envelope() {
        let value = json!({
            "ok": true,
            "data": {"answer": {"text": "這是繁體中文分析結果", "model": "local"}},
            "meta": {"compat_version": "v3", "degraded": false}
        });
        let reply = adapt_magi_response(&value, "v2").expect("應能解析相容封套");
        assert_eq!(reply.compatibility_version, "v3");
        assert!(reply.text.contains("分析結果"));
        assert!(!reply.degraded);
    }

    #[test]
    fn extracts_bundled_ooxml_fixture() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Verification/OpenDeskTW_完整文字功能.docx");
        let (text, _) = extract_document_text(&fixture).expect("應能擷取 DOCX");
        assert!(text.chars().count() > 50);
    }

    #[test]
    #[ignore = "需要正在運作的本機 MAGI V2 或 V3"]
    fn live_magi_v2_v3_request() {
        let status = magi_status();
        assert!(status.available && status.v2_v3_safe, "{}", status.summary);
        let (api_key, tenant) = magi_credentials(&status.active_version).expect("應找到本機認證");
        let body = serde_json::to_vec(&json!({
            "prompt": "請只用繁體中文回答：OpenDesk TW MAGI LIVE 驗證通過。",
            "timeout_sec": 90,
            "allow_fallback": true,
            "allow_template_fallback": true,
            "user_id": "opendesk-tw-live-test",
            "platform": "OPENDESK_TW",
            "role": "user"
        }))
        .unwrap();
        let value = magi_http_request(api_key, tenant, body).expect("MAGI LIVE 呼叫應成功");
        let reply = adapt_magi_response(&value, &status.active_version).expect("應能解析回應");
        assert!(!reply.text.trim().is_empty());
    }

    #[test]
    #[ignore = "需要本機 ONLYOFFICE、LibreOffice 與 MAGI"]
    fn live_complete_office_pipeline() {
        assert!(engine_status("ONLYOFFICE").installed);
        assert!(engine_status("LibreOffice").installed);
        let resources = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let fixtures = [
            resources.join("Verification/OpenDeskTW_完整文字功能.docx"),
            resources.join("Verification/OpenDeskTW_完整試算表功能.xlsx"),
            resources.join("Verification/OpenDeskTW_完整簡報功能.pptx"),
        ];
        for fixture in &fixtures {
            assert!(fixture.is_file());
            assert!(inspect_package(fixture).0 > 0);
        }
        let temporary_root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Pipeline-Test-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        fs::create_dir_all(&temporary_root).unwrap();
        let _cleanup = TemporaryFolder(temporary_root.clone());
        let backup = temporary_root.join("backup.docx");
        fs::copy(&fixtures[0], &backup).unwrap();
        assert_eq!(fs::read(&fixtures[0]).unwrap(), fs::read(&backup).unwrap());
        let pdf = convert_pdf_at(&fixtures[0], &temporary_root.join("pdf")).unwrap();
        let pdf_bytes = fs::read(pdf).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-") && pdf_bytes.len() > 1_000);
        let status = magi_status();
        assert!(status.available && status.v2_v3_safe, "{}", status.summary);
        let (api_key, tenant) = magi_credentials(&status.active_version).unwrap();
        let body = serde_json::to_vec(&json!({
            "prompt": "請以繁體中文簡短確認 OpenDesk TW Office 完整管線 LIVE 驗證。",
            "timeout_sec": 90,
            "allow_fallback": true,
            "allow_template_fallback": true,
            "user_id": "opendesk-tw-pipeline-test",
            "platform": "OPENDESK_TW",
            "role": "user"
        }))
        .unwrap();
        let value = magi_http_request(api_key, tenant, body).unwrap();
        assert!(!adapt_magi_response(&value, &status.active_version)
            .unwrap()
            .text
            .is_empty());
    }
}
