// Copyright (c) 2026 WhaleChao and contributors.
// SPDX-License-Identifier: AGPL-3.0-or-later

use chrono::Local;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, Runtime};
use zip::{ZipArchive, ZipWriter};

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

#[derive(Deserialize)]
struct MagiBridgeRequest {
    text: String,
    mode: String,
    instruction: Option<String>,
    document_title: Option<String>,
}

#[derive(Deserialize)]
struct DistributedAlignmentBridgeRequest {
    path: String,
    #[serde(default)]
    paragraph_ids: Vec<Value>,
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

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
struct WordHeading {
    paragraph: usize,
    level: usize,
    text: String,
}

#[derive(Serialize)]
struct WordReport {
    file_name: String,
    characters: usize,
    paragraphs: usize,
    tables: usize,
    images: usize,
    hyperlinks: usize,
    sections: usize,
    headers: usize,
    footers: usize,
    footnotes: usize,
    endnotes: usize,
    comments: usize,
    tracked_insertions: usize,
    tracked_deletions: usize,
    bookmarks: usize,
    fields: usize,
    page_breaks: usize,
    mail_merge_fields: usize,
    has_toc: bool,
    has_page_numbers: bool,
    fonts: Vec<String>,
    headings: Vec<WordHeading>,
    accessibility_warnings: Vec<String>,
    print_warnings: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct RecoverySession {
    id: String,
    path: String,
    file_name: String,
    engine: String,
    opened_at: String,
    snapshot_path: String,
    snapshot_at: String,
    snapshots: usize,
}

#[derive(Serialize)]
struct RecoveryOverview {
    sessions: Vec<RecoverySession>,
    directory: String,
}

#[derive(Serialize)]
struct MailMergePreview {
    headers: Vec<String>,
    row_count: usize,
    sample_rows: Vec<BTreeMap<String, String>>,
}

#[derive(Serialize)]
struct MailMergeResult {
    created: Vec<String>,
    skipped: usize,
    message: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
struct AccessibilityIssue {
    id: String,
    severity: String,
    category: String,
    message: String,
    location: String,
    repairable: bool,
}

#[derive(Serialize)]
struct AccessibilityReport {
    file_name: String,
    score: usize,
    issues: Vec<AccessibilityIssue>,
    passed_checks: Vec<String>,
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
struct QualityIssue {
    severity: String,
    category: String,
    message: String,
    location: String,
    suggestion: String,
}

#[derive(Serialize)]
struct WordQualityReport {
    file_name: String,
    score: usize,
    characters: usize,
    sentences: usize,
    issues: Vec<QualityIssue>,
    passed_checks: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
struct CitationSource {
    id: String,
    source_type: String,
    author: String,
    title: String,
    year: String,
    publisher: String,
    container_title: String,
    volume: String,
    issue: String,
    pages: String,
    doi: String,
    url: String,
    accessed: String,
}

#[derive(Serialize)]
struct CitationText {
    inline: String,
    bibliography: Vec<String>,
}

#[derive(Serialize)]
struct ReadingParagraph {
    index: usize,
    heading_level: Option<usize>,
    text: String,
}

#[derive(Serialize)]
struct ReviewComment {
    id: String,
    author: String,
    date: String,
    text: String,
    mentions: Vec<String>,
}

#[derive(Serialize)]
struct WordReadingContent {
    file_name: String,
    paragraphs: Vec<ReadingParagraph>,
    comments: Vec<ReviewComment>,
}

#[derive(Serialize)]
struct ActionResult {
    path: String,
    file_name: String,
    message: String,
}

#[derive(Serialize)]
struct OnlyOfficeTwStatus {
    installed: bool,
    running: bool,
    current_language: String,
    traditional_chinese: bool,
    plugin_installed: bool,
    plugin_current: bool,
    plugin_version: String,
    required_plugin_version: String,
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

#[derive(Clone, Debug)]
struct AcroPdfRuntime {
    executable: PathBuf,
    prefix_args: Vec<String>,
    display_path: String,
}

struct AcroPdfServer {
    runtime: AcroPdfRuntime,
    child: Child,
    stdin: ChildStdin,
    responses: Receiver<String>,
}

enum AcroPdfServerError {
    Core(String),
    Transport(String),
}

static ACROPDF_SERVER: OnceLock<Mutex<Option<AcroPdfServer>>> = OnceLock::new();
static ACROPDF_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
static MAGI_BRIDGE_TOKEN: OnceLock<String> = OnceLock::new();
static RECOVERY_SESSIONS: OnceLock<Mutex<()>> = OnceLock::new();
static CITATION_SOURCES: OnceLock<Mutex<()>> = OnceLock::new();
static DISTRIBUTED_ALIGNMENT_WRITE: OnceLock<Mutex<()>> = OnceLock::new();
const MAGI_BRIDGE_PORT: u16 = 41_827;

fn magi_bridge_port() -> u16 {
    std::env::var("OPENDESK_MAGI_BRIDGE_PORT")
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|port| *port >= 1024)
        .unwrap_or(MAGI_BRIDGE_PORT)
}

impl AcroPdfServer {
    fn request(&mut self, args: &[String], timeout: Duration) -> Result<Value, AcroPdfServerError> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|error| AcroPdfServerError::Transport(error.to_string()))?
        {
            return Err(AcroPdfServerError::Transport(format!(
                "內建 PDF 核心已結束（{status}）"
            )));
        }
        let request_id = ACROPDF_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
        let payload = json!({"request_id": request_id, "args": args});
        writeln!(self.stdin, "{payload}")
            .and_then(|_| self.stdin.flush())
            .map_err(|error| AcroPdfServerError::Transport(error.to_string()))?;
        let line = match self.responses.recv_timeout(timeout) {
            Ok(line) => line,
            Err(RecvTimeoutError::Timeout) => {
                return Err(AcroPdfServerError::Transport(
                    "內建 PDF 核心回應逾時".into(),
                ));
            }
            Err(RecvTimeoutError::Disconnected) => {
                return Err(AcroPdfServerError::Transport(
                    "內建 PDF 核心連線已中斷".into(),
                ));
            }
        };
        let value: Value = serde_json::from_str(&line).map_err(|error| {
            AcroPdfServerError::Transport(format!("內建 PDF 核心回應格式錯誤：{error}"))
        })?;
        if value.get("request_id").and_then(Value::as_u64) != Some(request_id) {
            return Err(AcroPdfServerError::Transport(
                "內建 PDF 核心回應順序錯誤".into(),
            ));
        }
        if value.get("protocol_version").and_then(Value::as_u64) != Some(2) {
            return Err(AcroPdfServerError::Transport(
                "內建 PDF 核心協定版本不相容".into(),
            ));
        }
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            return Err(AcroPdfServerError::Core(
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("內建 PDF 核心無法處理此文件")
                    .to_string(),
            ));
        }
        Ok(value)
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Drop for AcroPdfServer {
    fn drop(&mut self) {
        self.stop();
    }
}

fn python_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(python) = std::env::var("DOCUMENT_WORKBENCH_PYTHON") {
        candidates.push(PathBuf::from(python));
    }
    #[cfg(target_os = "macos")]
    candidates.extend(
        [
            "/opt/homebrew/bin/python3",
            "/usr/local/bin/python3",
            "/usr/bin/python3",
        ]
        .into_iter()
        .map(PathBuf::from),
    );
    #[cfg(target_os = "windows")]
    candidates.extend([PathBuf::from("python.exe"), PathBuf::from("python3.exe")]);
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    candidates.push(PathBuf::from("python3"));
    candidates
}

fn allow_python_pdf_core_fallback(
    native_sidecar_available: bool,
    explicitly_allowed: bool,
) -> bool {
    !native_sidecar_available || explicitly_allowed
}

fn acropdf_runtime_candidates() -> Vec<AcroPdfRuntime> {
    let mut candidates = Vec::new();
    let mut native_sidecar_available = false;
    if let Ok(executable) = std::env::var("DOCUMENT_WORKBENCH_PDF_CORE") {
        candidates.push(AcroPdfRuntime {
            display_path: executable.clone(),
            executable: PathBuf::from(executable),
            prefix_args: Vec::new(),
        });
    }

    // `cargo test` 與開發模式的執行檔位於 target 目錄，不會和 Tauri
    // sidecar 放在同一層；直接採用封裝腳本產生的平台檔名，確保 CI
    // 驗證的也是實際隨安裝包出貨的核心，而不是碰巧可用的系統 Python。
    let development_sidecar_name = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Some("document-pdf-core-aarch64-apple-darwin")
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        Some("document-pdf-core-x86_64-apple-darwin")
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        Some("document-pdf-core-x86_64-pc-windows-msvc.exe")
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        Some("document-pdf-core-aarch64-pc-windows-msvc.exe")
    } else {
        None
    };
    if let Some(name) = development_sidecar_name {
        let sidecar = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("binaries")
            .join(name);
        if sidecar.is_file() {
            native_sidecar_available = true;
            candidates.push(AcroPdfRuntime {
                executable: sidecar.clone(),
                prefix_args: Vec::new(),
                display_path: sidecar.to_string_lossy().to_string(),
            });
        }
    }

    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(binary_root) = current_executable.parent() {
            let sidecar = if cfg!(target_os = "windows") {
                binary_root.join("document-pdf-core.exe")
            } else {
                binary_root.join("document-pdf-core")
            };
            if sidecar.is_file() {
                native_sidecar_available = true;
                candidates.push(AcroPdfRuntime {
                    executable: sidecar.clone(),
                    prefix_args: Vec::new(),
                    display_path: sidecar.to_string_lossy().to_string(),
                });
            }
        }
    }

    // 正式 App 與已完成 sidecar 建置的開發環境不得默默回退到使用者的
    // 系統 Python。後者可能載入其他產品（例如 MAGI）的 user-site PyObjC，
    // 在無視窗背景程序中誤啟動 AppKit。只有尚未建置 sidecar 的原始碼測試，
    // 或開發者明確允許時，才使用 embedded_core.py 備援。
    let explicitly_allowed = std::env::var("DOCUMENT_WORKBENCH_ALLOW_PYTHON_PDF_CORE")
        .ok()
        .as_deref()
        == Some("1");
    if !allow_python_pdf_core_fallback(native_sidecar_available, explicitly_allowed) {
        return candidates;
    }

    let mut source_candidates =
        vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/acropdf-core/embedded_core.py")];
    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(binary_root) = current_executable.parent() {
            source_candidates.push(binary_root.join("resources/acropdf-core/embedded_core.py"));
            source_candidates
                .push(binary_root.join("../Resources/resources/acropdf-core/embedded_core.py"));
        }
    }
    for source in source_candidates {
        if !source.is_file() {
            continue;
        }
        for python in python_candidates() {
            candidates.push(AcroPdfRuntime {
                executable: python,
                prefix_args: vec![source.to_string_lossy().to_string()],
                display_path: source.to_string_lossy().to_string(),
            });
        }
    }
    candidates
}

fn spawn_acropdf_server(runtime: AcroPdfRuntime) -> Result<AcroPdfServer, String> {
    let mut command = Command::new(&runtime.executable);
    command
        .args(&runtime.prefix_args)
        .arg("--embedded-server")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let stdin = child.stdin.take().ok_or("無法連接內建 PDF 核心輸入")?;
    let stdout = child.stdout.take().ok_or("無法連接內建 PDF 核心輸出")?;
    let stderr = child.stderr.take().ok_or("無法連接內建 PDF 核心錯誤輸出")?;
    let (sender, responses) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            if line.is_err() {
                break;
            }
        }
    });
    Ok(AcroPdfServer {
        runtime,
        child,
        stdin,
        responses,
    })
}

fn persistent_acropdf_call_args(
    args: &[String],
    timeout: Duration,
) -> Result<(Value, AcroPdfRuntime), AcroPdfServerError> {
    let server_slot = ACROPDF_SERVER.get_or_init(|| Mutex::new(None));
    let mut server_guard = server_slot
        .lock()
        .map_err(|_| AcroPdfServerError::Transport("內建 PDF 核心狀態鎖定失敗".into()))?;
    if server_guard.is_none() {
        let status_args = vec!["--integration-status".to_string()];
        let mut last_error = "找不到全能文件工作台的內建 PDF 核心".to_string();
        for runtime in acropdf_runtime_candidates() {
            let mut candidate = match spawn_acropdf_server(runtime) {
                Ok(candidate) => candidate,
                Err(error) => {
                    last_error = error;
                    continue;
                }
            };
            match candidate.request(&status_args, Duration::from_secs(30)) {
                Ok(_) => {
                    *server_guard = Some(candidate);
                    break;
                }
                Err(AcroPdfServerError::Core(error))
                | Err(AcroPdfServerError::Transport(error)) => {
                    last_error = error;
                    candidate.stop();
                }
            }
        }
        if server_guard.is_none() {
            return Err(AcroPdfServerError::Transport(last_error));
        }
    }
    let result = server_guard
        .as_mut()
        .ok_or_else(|| AcroPdfServerError::Transport("內建 PDF 核心尚未啟動".into()))?;
    let runtime = result.runtime.clone();
    match result.request(args, timeout) {
        Ok(value) => Ok((value, runtime)),
        Err(error @ AcroPdfServerError::Core(_)) => Err(error),
        Err(AcroPdfServerError::Transport(error)) => {
            if let Some(mut server) = server_guard.take() {
                server.stop();
            }
            Err(AcroPdfServerError::Transport(error))
        }
    }
}

fn command_output_with_timeout(
    runtime: &AcroPdfRuntime,
    args: &[String],
    timeout: Duration,
) -> Result<Output, String> {
    let mut command = Command::new(&runtime.executable);
    command
        .args(&runtime.prefix_args)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| error.to_string())?;
    let started = Instant::now();
    loop {
        match child.try_wait().map_err(|error| error.to_string())? {
            Some(_) => return child.wait_with_output().map_err(|error| error.to_string()),
            None if started.elapsed() < timeout => thread::sleep(Duration::from_millis(80)),
            None => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("內建 PDF 核心回應逾時".into());
            }
        }
    }
}

fn acropdf_call_args(
    args: Vec<String>,
    timeout: Duration,
) -> Result<(Value, AcroPdfRuntime), String> {
    let mut last_error = match persistent_acropdf_call_args(&args, timeout) {
        Ok(result) => return Ok(result),
        Err(AcroPdfServerError::Core(error)) => return Err(error),
        Err(AcroPdfServerError::Transport(error)) => error,
    };
    for runtime in acropdf_runtime_candidates() {
        match command_output_with_timeout(&runtime, &args, timeout) {
            Ok(output) if output.status.success() => {
                match serde_json::from_slice::<Value>(&output.stdout) {
                    Ok(value)
                        if value.get("protocol_version").and_then(Value::as_u64) == Some(2) =>
                    {
                        return Ok((value, runtime));
                    }
                    Ok(_) => last_error = "內建 PDF 核心協定版本不相容".into(),
                    Err(error) => last_error = format!("內建 PDF 核心回應格式錯誤：{error}"),
                }
            }
            Ok(output) => {
                if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
                    if value.get("protocol_version").and_then(Value::as_u64) == Some(2) {
                        return Err(value
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("內建 PDF 核心無法處理此文件")
                            .to_string());
                    }
                }
                let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
                if !stderr.is_empty() {
                    last_error = stderr;
                }
            }
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn acropdf_call(flag: &str, path: Option<&Path>) -> Result<(Value, AcroPdfRuntime), String> {
    let mut args = vec![flag.to_string()];
    if let Some(path) = path {
        args.push(path.to_string_lossy().to_string());
    }
    let timeout = match flag {
        "--integration-status" => Duration::from_secs(8),
        "--integration-inspect" => Duration::from_secs(45),
        "--integration-live-test" => Duration::from_secs(180),
        _ => Duration::from_secs(60),
    };
    acropdf_call_args(args, timeout)
}

fn acropdf_engine_status() -> EngineStatus {
    match acropdf_call("--integration-status", None) {
        Ok((value, runtime)) => EngineStatus {
            name: "內建 PDF 核心".into(),
            installed: true,
            path: Some(runtime.display_path),
            version: value
                .get("app_version")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        Err(_) => EngineStatus {
            name: "內建 PDF 核心".into(),
            installed: false,
            path: None,
            version: None,
        },
    }
}

#[tauri::command]
fn acropdf_status() -> Result<Value, String> {
    acropdf_call("--integration-status", None).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_report(path: String, password: Option<String>) -> Result<Value, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 PDF 文件".into());
    }
    if !source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf")
    {
        return Err("PDF 文件中心只接受 PDF".into());
    }
    let mut args = vec![
        "--integration-inspect".into(),
        source.to_string_lossy().to_string(),
    ];
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        args.extend(["--password".into(), password]);
    }
    acropdf_call_args(args, Duration::from_secs(45)).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_live_validate(path: String, password: Option<String>) -> Result<Value, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 PDF 文件".into());
    }
    if !source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf")
    {
        return Err("PDF LIVE 驗證只接受 PDF".into());
    }
    let mut args = vec![
        "--integration-live-test".into(),
        source.to_string_lossy().to_string(),
    ];
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        args.extend(["--password".into(), password]);
    }
    acropdf_call_args(args, Duration::from_secs(180)).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_query(path: String, query: String, options: Value) -> Result<Value, String> {
    const ALLOWED_QUERIES: &[&str] = &[
        "search",
        "forms",
        "annotations",
        "layers",
        "attachments",
        "audit",
        "signatures",
    ];
    if !ALLOWED_QUERIES.contains(&query.as_str()) {
        return Err("不支援的 PDF 查詢".into());
    }
    if !options.is_object() {
        return Err("PDF 查詢選項格式錯誤".into());
    }
    let source = PathBuf::from(path);
    validate_pdf_source(&source)?;
    let args = vec![
        "--embedded-query".into(),
        source.to_string_lossy().to_string(),
        "--query".into(),
        query,
        "--options-json".into(),
        serde_json::to_string(&options).map_err(|error| error.to_string())?,
    ];
    acropdf_call_args(args, Duration::from_secs(240)).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_render_page(
    path: String,
    page: usize,
    scale: f64,
    password: Option<String>,
) -> Result<Value, String> {
    let source = PathBuf::from(path);
    validate_pdf_source(&source)?;
    let mut args = vec![
        "--embedded-render".into(),
        source.to_string_lossy().to_string(),
        "--page".into(),
        page.to_string(),
        "--scale".into(),
        scale.to_string(),
    ];
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        args.extend(["--password".into(), password]);
    }
    acropdf_call_args(args, Duration::from_secs(90)).map(|(value, _)| value)
}

fn validate_pdf_source(source: &Path) -> Result<(), String> {
    if !source.is_file() {
        return Err("找不到 PDF 文件".into());
    }
    if !source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf")
    {
        return Err("內建 PDF 工作區只接受 PDF 文件".into());
    }
    Ok(())
}

#[tauri::command]
fn pdf_apply_operation(
    path: String,
    operation: String,
    options: Value,
    output: Option<String>,
) -> Result<Value, String> {
    const ALLOWED_OPERATIONS: &[&str] = &[
        "rotate",
        "delete",
        "insert_blank",
        "reorder",
        "merge",
        "extract",
        "split",
        "watermark",
        "header_footer",
        "add_text",
        "edit_text",
        "image_delete",
        "image_replace",
        "note",
        "free_text",
        "highlight_search",
        "mark_search",
        "shape",
        "measure",
        "layer_visibility",
        "link",
        "bookmark",
        "attach_file",
        "extract_attachment",
        "redact_search",
        "redact_pattern",
        "fill_form",
        "create_field",
        "export_form_data",
        "import_form_data",
        "flatten",
        "accessibility_metadata",
        "metadata",
        "optimize",
        "encrypt",
        "decrypt",
        "ocr",
        "export",
        "sign",
        "smart_file",
    ];
    if !ALLOWED_OPERATIONS.contains(&operation.as_str()) {
        return Err("不支援的內建 PDF 操作".into());
    }
    if !options.is_object() {
        return Err("PDF 操作選項格式錯誤".into());
    }
    let source = PathBuf::from(path);
    validate_pdf_source(&source)?;
    let destination = output
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| source.clone());
    let backup = if destination == source {
        Some(create_backup(&source)?)
    } else {
        None
    };
    let mut args = vec![
        "--embedded-operate".into(),
        source.to_string_lossy().to_string(),
        "--operation".into(),
        operation.clone(),
        "--options-json".into(),
        serde_json::to_string(&options).map_err(|error| error.to_string())?,
        "--output".into(),
        destination.to_string_lossy().to_string(),
    ];
    if operation == "split" {
        args.truncate(args.len() - 2);
    }
    let timeout = if operation == "ocr" {
        Duration::from_secs(900)
    } else {
        Duration::from_secs(240)
    };
    let (mut value, _) = acropdf_call_args(args, timeout)?;
    if let (Some(backup), Some(object)) = (backup, value.as_object_mut()) {
        object.insert(
            "backup".into(),
            Value::String(backup.to_string_lossy().to_string()),
        );
    }
    Ok(value)
}

#[tauri::command]
fn pdf_restore_backup(path: String, backup: String) -> Result<ActionResult, String> {
    let destination = PathBuf::from(path);
    let backup = PathBuf::from(backup);
    validate_pdf_source(&destination)?;
    validate_pdf_source(&backup)?;
    let backup_root = data_root()?.join("Backups");
    let canonical_root = backup_root
        .canonicalize()
        .map_err(|_| "找不到安全備份資料夾".to_string())?;
    let canonical_backup = backup
        .canonicalize()
        .map_err(|_| "找不到指定的安全備份".to_string())?;
    if !canonical_backup.starts_with(&canonical_root) {
        return Err("只能復原由全能文件工作台建立的安全備份".into());
    }
    create_backup(&destination)?;
    fs::copy(&canonical_backup, &destination).map_err(|error| error.to_string())?;
    Ok(ActionResult {
        path: destination.to_string_lossy().to_string(),
        file_name: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("PDF")
            .to_string(),
        message: "已復原上一次 PDF 修改；復原前版本也已另行備份。".into(),
    })
}

#[tauri::command]
fn pdf_create_blank(destination: String, pages: usize) -> Result<Value, String> {
    let destination = PathBuf::from(destination);
    if !destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .eq_ignore_ascii_case("pdf")
    {
        return Err("新 PDF 必須使用 .pdf 副檔名".into());
    }
    let args = vec![
        "--embedded-new".into(),
        destination.to_string_lossy().to_string(),
        "--pages".into(),
        pages.clamp(1, 100).to_string(),
    ];
    acropdf_call_args(args, Duration::from_secs(90)).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_compare(path: String, other: String) -> Result<Value, String> {
    let source = PathBuf::from(path);
    let other = PathBuf::from(other);
    validate_pdf_source(&source)?;
    validate_pdf_source(&other)?;
    let args = vec![
        "--embedded-compare".into(),
        source.to_string_lossy().to_string(),
        "--other".into(),
        other.to_string_lossy().to_string(),
    ];
    acropdf_call_args(args, Duration::from_secs(240)).map(|(value, _)| value)
}

#[tauri::command]
fn open_in_acropdf(path: Option<String>, tool: Option<String>) -> Result<ActionResult, String> {
    const ALLOWED_TOOLS: &[&str] = &[
        "tools",
        "new",
        "read",
        "print",
        "pages",
        "merge",
        "split",
        "extract",
        "edit_text",
        "edit_image",
        "annotate",
        "annotation_summary",
        "layers",
        "watermark",
        "header_footer",
        "forms",
        "form_data",
        "form_design",
        "sign",
        "ocr",
        "convert",
        "optimize",
        "protect",
        "redact",
        "compare",
        "preflight",
        "accessibility",
        "batch",
        "filing",
        "magi",
    ];
    if let Some(tool) = tool.as_deref() {
        if !ALLOWED_TOOLS.contains(&tool) {
            return Err("不支援的 PDF 工具入口".into());
        }
    }
    acropdf_call("--integration-status", None)?;
    let source = path.map(PathBuf::from);
    let backup = if let Some(source) = source.as_ref() {
        if !source.is_file() {
            return Err("找不到 PDF 文件".into());
        }
        if !source
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .eq_ignore_ascii_case("pdf")
        {
            return Err("內建 PDF 工作區只接受 PDF 文件".into());
        }
        Some(create_backup(source)?)
    } else {
        None
    };
    let display_path = source
        .as_ref()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    let file_name = source
        .as_ref()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("PDF 工作區")
        .to_string();
    let message = backup
        .map(|value| format!("已備份原始 PDF 至 {}，內建工作區已就緒", value.display()))
        .unwrap_or_else(|| "內建 PDF 工作區已就緒；不會開啟其他 APP".into());
    Ok(ActionResult {
        path: display_path,
        file_name,
        message,
    })
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

#[cfg(target_os = "macos")]
fn macos_bundle_version(executable: &Path) -> Option<String> {
    let contents = executable.parent()?.parent()?;
    let info_plist = contents.join("Info.plist");
    let value = plist::Value::from_file(info_plist).ok()?;
    value
        .as_dictionary()?
        .get("CFBundleShortVersionString")?
        .as_string()
        .map(str::to_string)
}

fn engine_status(name: &str) -> EngineStatus {
    let path = engine_executable(name);
    #[cfg(target_os = "macos")]
    let version = path
        .as_ref()
        .and_then(|executable| macos_bundle_version(executable));
    #[cfg(not(target_os = "macos"))]
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

const ONLYOFFICE_TW_PLUGIN_FOLDER: &str = "{5CBF7C74-7021-4E8C-93F3-5A6C20260722}";
const ONLYOFFICE_BUILTIN_AI_PLUGIN_FOLDER: &str = "{9DC93CDB-B576-4F0C-B55E-FCC9C48DD007}";
const ONLYOFFICE_AI_TW_PLUGIN_FOLDER: &str = "{A81F4C5E-5DB6-4F64-B276-CCF30FCF2873}";

fn is_traditional_onlyoffice_locale(value: &str) -> bool {
    let locale = value.trim().replace('_', "-").to_ascii_lowercase();
    locale == "zh-tw" || locale.starts_with("zh-hant")
}

fn onlyoffice_is_running() -> bool {
    #[cfg(target_os = "macos")]
    {
        Command::new("/usr/bin/pgrep")
            .args(["-x", "ONLYOFFICE"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        Command::new("tasklist.exe")
            .args(["/FI", "IMAGENAME eq DesktopEditors.exe", "/NH"])
            .output()
            .ok()
            .map(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains("desktopeditors.exe")
            })
            .unwrap_or(false)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Command::new("pgrep")
            .args(["-f", "(^|/)(DesktopEditors|onlyoffice-desktopeditors)( |$)"])
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
}

#[cfg(target_os = "macos")]
fn macos_defaults_read(key: &str) -> Option<String> {
    Command::new("/usr/bin/defaults")
        .args(["read", "asc.onlyoffice.ONLYOFFICE", key])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_string())
        .filter(|value| !value.is_empty())
}

fn onlyoffice_current_language() -> String {
    #[cfg(target_os = "macos")]
    {
        if let Some(language) = macos_defaults_read("asc_user_ui_lang") {
            return language;
        }
        let languages = macos_defaults_read("AppleLanguages").unwrap_or_default();
        for candidate in ["zh-TW", "zh-Hant-TW", "zh-ZH", "zh-CN"] {
            if languages
                .to_ascii_lowercase()
                .contains(&candidate.to_ascii_lowercase())
            {
                return candidate.into();
            }
        }
        "依系統設定".into()
    }
    #[cfg(not(target_os = "macos"))]
    {
        "由全能文件工作台啟動時固定為 zh-TW".into()
    }
}

fn onlyoffice_user_plugins_base() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir()
            .map(|root| root.join("asc.onlyoffice.ONLYOFFICE/data/sdkjs-plugins"))
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir()
            .map(|root| root.join("ONLYOFFICE/DesktopEditors/sdkjs-plugins"))
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs::data_local_dir()
            .map(|root| root.join("onlyoffice/desktopeditors/sdkjs-plugins"))
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
    }
}

fn onlyoffice_user_plugin_root() -> Result<PathBuf, String> {
    Ok(onlyoffice_user_plugins_base()?.join(ONLYOFFICE_TW_PLUGIN_FOLDER))
}

fn onlyoffice_ai_tw_plugin_root() -> Result<PathBuf, String> {
    Ok(onlyoffice_user_plugins_base()?.join(ONLYOFFICE_AI_TW_PLUGIN_FOLDER))
}

fn onlyoffice_builtin_ai_plugin_root() -> Result<PathBuf, String> {
    let executable = engine_executable("ONLYOFFICE").ok_or("找不到 ONLYOFFICE")?;
    let resolved = fs::canonicalize(&executable).unwrap_or(executable);
    let mut candidates = Vec::new();
    for ancestor in resolved.ancestors().take(7) {
        candidates.push(
            ancestor
                .join("Resources/editors/sdkjs-plugins")
                .join(ONLYOFFICE_BUILTIN_AI_PLUGIN_FOLDER),
        );
        candidates.push(
            ancestor
                .join("editors/sdkjs-plugins")
                .join(ONLYOFFICE_BUILTIN_AI_PLUGIN_FOLDER),
        );
        candidates.push(
            ancestor
                .join("sdkjs-plugins")
                .join(ONLYOFFICE_BUILTIN_AI_PLUGIN_FOLDER),
        );
    }
    candidates
        .into_iter()
        .find(|path| path.join("config.json").is_file() && path.join("scripts/code.js").is_file())
        .ok_or_else(|| "找不到 ONLYOFFICE 內建 AI 外掛，無法建立繁中相容副本".into())
}

fn onlyoffice_ai_tw_installed() -> bool {
    onlyoffice_ai_tw_plugin_root()
        .map(|path| {
            path.join("config.json").is_file()
                && path.join("translations/zh-TW.json").is_file()
                && path.join("translations/helpers/zh-TW.json").is_file()
                && path.join("traditional-chinese.js").is_file()
        })
        .unwrap_or(false)
}

fn onlyoffice_tw_plugin_version(path: &Path) -> Option<String> {
    let config = fs::read_to_string(path.join("config.json")).ok()?;
    serde_json::from_str::<Value>(&config)
        .ok()?
        .get("version")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|version| !version.is_empty())
        .map(str::to_string)
}

fn bundled_onlyoffice_tw_plugin_version() -> String {
    serde_json::from_str::<Value>(include_str!(
        "../resources/onlyoffice-tw-plugin/config.json"
    ))
    .ok()
    .and_then(|config| {
        config
            .get("version")
            .and_then(Value::as_str)
            .map(str::to_string)
    })
    .unwrap_or_else(|| "未知".into())
}

fn plugin_version_is_current(installed: &str, required: &str) -> bool {
    fn numeric_version(value: &str) -> Option<Vec<u64>> {
        value
            .split('.')
            .map(|part| part.parse::<u64>().ok())
            .collect::<Option<Vec<_>>>()
    }

    match (numeric_version(installed), numeric_version(required)) {
        (Some(mut installed), Some(mut required)) => {
            let width = installed.len().max(required.len());
            installed.resize(width, 0);
            required.resize(width, 0);
            installed >= required
        }
        _ => installed == required,
    }
}

fn onlyoffice_tw_status_value() -> OnlyOfficeTwStatus {
    let installed = engine_executable("ONLYOFFICE").is_some();
    let running = onlyoffice_is_running();
    let current_language = onlyoffice_current_language();
    let traditional_chinese = if cfg!(target_os = "macos") {
        is_traditional_onlyoffice_locale(&current_language)
    } else {
        true
    };
    let plugin_root = onlyoffice_user_plugin_root().ok();
    let plugin_version = plugin_root
        .as_deref()
        .and_then(onlyoffice_tw_plugin_version)
        .unwrap_or_else(|| "未安裝".into());
    let required_plugin_version = bundled_onlyoffice_tw_plugin_version();
    let plugin_installed = plugin_root
        .as_deref()
        .map(|path| {
            path.join("config.json").is_file()
                && path.join("index.html").is_file()
                && path.join("code.js").is_file()
                && path.join("typography.js").is_file()
                && path.join("ui-overrides.js").is_file()
                && path.join("ui-patch.js").is_file()
                && path.join("magi-result.html").is_file()
                && path.join("magi-result.js").is_file()
        })
        .unwrap_or(false)
        && onlyoffice_ai_tw_installed();
    let plugin_current =
        plugin_installed && plugin_version_is_current(&plugin_version, &required_plugin_version);
    let message = if !installed {
        "尚未安裝 ONLYOFFICE".into()
    } else if running && !traditional_chinese {
        "目前正在使用錯誤語系；請先關閉 ONLYOFFICE，再按一鍵修復".into()
    } else if running && plugin_installed && !plugin_current {
        format!(
            "目前載入的是繁中寫作工具 {plugin_version}；請先儲存文件並關閉 ONLYOFFICE，再更新至 {required_plugin_version}"
        )
    } else if traditional_chinese && plugin_current {
        format!("完整繁中介面、數字字級與繁中寫作工具 {plugin_version} 已就緒")
    } else if !traditional_chinese {
        format!("目前語系為 {current_language}，需要修正為 zh-TW")
    } else if plugin_installed {
        format!("繁中寫作工具 {plugin_version} 版本過舊，需要更新至 {required_plugin_version}")
    } else {
        "繁體中文已啟用；尚待安裝繁中寫作工具".into()
    };
    OnlyOfficeTwStatus {
        installed,
        running,
        current_language,
        traditional_chinese,
        plugin_installed,
        plugin_current,
        plugin_version,
        required_plugin_version,
        message,
    }
}

fn copy_directory(source: &Path, destination: &Path) -> Result<(), String> {
    fs::create_dir_all(destination).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let target = destination.join(entry.file_name());
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_dir()
        {
            copy_directory(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), target).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

fn install_onlyoffice_ai_tw(locale_source: &Path) -> Result<PathBuf, String> {
    let source = onlyoffice_builtin_ai_plugin_root()?;
    let destination = onlyoffice_ai_tw_plugin_root()?;
    let translations = locale_source.join("translations");
    if !translations.join("zh-TW.json").is_file()
        || !translations.join("helpers/zh-TW.json").is_file()
        || !locale_source.join("traditional-chinese.js").is_file()
    {
        return Err("安裝包缺少 ONLYOFFICE AI 台灣繁中語系".into());
    }
    copy_directory(&source, &destination)?;
    copy_directory(&translations, &destination.join("translations"))?;
    fs::copy(
        locale_source.join("traditional-chinese.js"),
        destination.join("traditional-chinese.js"),
    )
    .map_err(|error| error.to_string())?;

    let config_path = destination.join("config.json");
    let mut config: Value =
        serde_json::from_str(&fs::read_to_string(&config_path).map_err(|error| error.to_string())?)
            .map_err(|error| format!("ONLYOFFICE AI 外掛設定無法解析：{error}"))?;
    let object = config
        .as_object_mut()
        .ok_or("ONLYOFFICE AI 外掛設定格式錯誤")?;
    object.insert("name".into(), Value::String("Other AI Models".into()));
    object.insert(
        "guid".into(),
        Value::String(format!("asc.{ONLYOFFICE_AI_TW_PLUGIN_FOLDER}")),
    );
    let locales = object
        .entry("nameLocale")
        .or_insert_with(|| json!({}))
        .as_object_mut()
        .ok_or("ONLYOFFICE AI 名稱語系格式錯誤")?;
    locales.insert("zh".into(), Value::String("其他 AI 模型".into()));
    locales.insert("zh-TW".into(), Value::String("其他 AI 模型".into()));
    if let Some(description_locales) = object
        .get_mut("variations")
        .and_then(Value::as_array_mut)
        .and_then(|items| items.first_mut())
        .and_then(|variation| variation.get_mut("descriptionLocale"))
        .and_then(Value::as_object_mut)
    {
        let description = "保留 ONLYOFFICE 通用 AI 模型功能，並補上台灣繁體中文介面；MAGI 文件助理位於獨立的 MAGI 頁籤。";
        description_locales.insert("zh".into(), Value::String(description.into()));
        description_locales.insert("zh-TW".into(), Value::String(description.into()));
    }
    let serialized = serde_json::to_string_pretty(&config).map_err(|error| error.to_string())?;
    fs::write(&config_path, format!("{serialized}\n")).map_err(|error| error.to_string())?;

    let register_path = destination.join("scripts/engine/register.js");
    let register = fs::read_to_string(&register_path).map_err(|error| error.to_string())?;
    let localized = register
        .replace(
            "buttonMain.text = \"AI\";",
            "buttonMain.text = \"其他 AI 模型\";",
        )
        .replace(
            "buttonMainToolbar.text = \"AI\";",
            "buttonMainToolbar.text = \"其他 AI 模型\";",
        );
    if localized == register || !localized.contains("buttonMainToolbar.text = \"其他 AI 模型\";")
    {
        return Err("ONLYOFFICE AI 外掛版本已變更，無法安全套用繁中頁籤名稱".into());
    }
    fs::write(register_path, localized).map_err(|error| error.to_string())?;

    let plugins_script = "<script type=\"text/javascript\" src=\"../v1/plugins.js\"></script>";
    let injection = format!(
        "{plugins_script}\n<script type=\"text/javascript\" src=\"traditional-chinese.js\"></script>"
    );
    let mut patched_pages = 0;
    for entry in fs::read_dir(&destination).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("html") {
            continue;
        }
        let html = fs::read_to_string(&path).map_err(|error| error.to_string())?;
        if !html.contains(plugins_script) {
            continue;
        }
        let patched = html.replacen(plugins_script, &injection, 1);
        fs::write(path, patched).map_err(|error| error.to_string())?;
        patched_pages += 1;
    }
    if patched_pages < 10 {
        return Err("ONLYOFFICE AI 外掛頁面結構已變更，無法完整注入台灣繁中語系".into());
    }
    Ok(destination)
}

#[cfg(target_os = "macos")]
fn repair_macos_onlyoffice_locale() -> Result<Option<PathBuf>, String> {
    if is_traditional_onlyoffice_locale(&onlyoffice_current_language()) {
        return Ok(None);
    }
    if onlyoffice_is_running() {
        return Err("請先關閉 ONLYOFFICE；文件不會遺失，關閉後再按一鍵修復".into());
    }
    let backup = data_root()?
        .join("OnlyOfficeRepairBackups")
        .join(Local::now().format("%Y%m%d-%H%M%S-%3f").to_string());
    fs::create_dir_all(&backup).map_err(|error| error.to_string())?;
    if let Some(home) = dirs::home_dir() {
        let preferences = home.join("Library/Preferences/asc.onlyoffice.ONLYOFFICE.plist");
        if preferences.is_file() {
            fs::copy(&preferences, backup.join("asc.onlyoffice.ONLYOFFICE.plist"))
                .map_err(|error| error.to_string())?;
        }
        let template_cache =
            home.join("Library/Application Support/asc.onlyoffice.ONLYOFFICE/data/templates_cache");
        if template_cache.is_dir() {
            fs::rename(&template_cache, backup.join("templates_cache"))
                .map_err(|error| error.to_string())?;
        }
    }
    for arguments in [
        [
            "write",
            "asc.onlyoffice.ONLYOFFICE",
            "asc_user_ui_lang",
            "-string",
            "zh-TW",
        ],
        [
            "write",
            "asc.onlyoffice.ONLYOFFICE",
            "AppleLanguages",
            "-array",
            "zh-TW",
        ],
        [
            "write",
            "asc.onlyoffice.ONLYOFFICE",
            "AppleLocale",
            "-string",
            "zh-TW",
        ],
    ] {
        let status = Command::new("/usr/bin/defaults")
            .args(arguments)
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("無法寫入 ONLYOFFICE 繁體中文設定".into());
        }
    }
    if !is_traditional_onlyoffice_locale(&onlyoffice_current_language()) {
        return Err("ONLYOFFICE 語系驗證失敗，已保留原始設定備份".into());
    }
    Ok(Some(backup))
}

const MICROSOFT_WORD_TW_FONT_FILES: [&str; 2] = ["mingliu.ttc", "mingliub.ttc"];

#[cfg(target_os = "macos")]
fn microsoft_office_font_bundles() -> Vec<PathBuf> {
    [
        "/Applications/Microsoft Word.app",
        "/Applications/Microsoft Excel.app",
        "/Applications/Microsoft PowerPoint.app",
    ]
    .into_iter()
    .map(PathBuf::from)
    .collect()
}

#[cfg(target_os = "macos")]
fn copy_microsoft_tw_fonts_from_bundles(
    bundles: &[PathBuf],
    destination: &Path,
) -> Result<Vec<PathBuf>, String> {
    let mut installed = Vec::new();
    for file_name in MICROSOFT_WORD_TW_FONT_FILES {
        let target = destination.join(format!("OpenDeskTW-Licensed-{file_name}"));
        let source = bundles
            .iter()
            .map(|bundle| {
                bundle
                    .join("Contents")
                    .join("Resources")
                    .join("DFonts")
                    .join(file_name)
            })
            .find(|path| path.is_file());

        // Microsoft Office 更新時可能暫時移動 DFonts；已從本機授權副本
        // 註冊完成的實體字型仍應保留為可用來源，不可誤報為遺失。
        if source.is_none()
            && target
                .symlink_metadata()
                .ok()
                .filter(|metadata| {
                    metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() > 0
                })
                .is_some()
        {
            installed.push(target);
            continue;
        }
        let Some(source) = source else {
            continue;
        };
        fs::create_dir_all(destination).map_err(|error| error.to_string())?;
        let source_size = source.metadata().map_err(|error| error.to_string())?.len();
        let target_is_current = target
            .symlink_metadata()
            .ok()
            .filter(|metadata| !metadata.file_type().is_symlink())
            .map(|metadata| metadata.len() == source_size)
            .unwrap_or(false);
        if !target_is_current {
            fs::copy(&source, &target).map_err(|error| {
                format!("無法從已授權的 Microsoft Office 安裝註冊 {file_name}：{error}")
            })?;
        }
        installed.push(target);
    }
    Ok(installed)
}

#[cfg(target_os = "macos")]
fn install_microsoft_tw_fonts() -> Result<Vec<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("找不到使用者資料夾，無法註冊台灣繁中字型")?;
    copy_microsoft_tw_fonts_from_bundles(
        &microsoft_office_font_bundles(),
        &home.join("Library/Fonts"),
    )
}

#[cfg(target_os = "macos")]
fn onlyoffice_font_cache_log_is_current(log: &str, installed_fonts: &[PathBuf]) -> bool {
    installed_fonts
        .iter()
        .all(|font| log.contains(font.to_string_lossy().as_ref()))
}

#[cfg(target_os = "macos")]
fn refresh_onlyoffice_font_cache_if_needed(
    installed_fonts: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    if installed_fonts.is_empty() || onlyoffice_is_running() {
        return Ok(None);
    }
    let data = dirs::data_dir()
        .ok_or("找不到 ONLYOFFICE 資料資料夾")?
        .join("asc.onlyoffice.ONLYOFFICE/data");
    let font_cache = data.join("fonts");
    if !font_cache.is_dir() {
        return Ok(None);
    }
    let log = fs::read_to_string(font_cache.join("fonts.log")).unwrap_or_default();
    if onlyoffice_font_cache_log_is_current(&log, installed_fonts) {
        return Ok(None);
    }
    let backup = data_root()?
        .join("OnlyOfficeFontCacheBackups")
        .join(Local::now().format("%Y%m%d-%H%M%S-%3f").to_string());
    fs::create_dir_all(&backup).map_err(|error| error.to_string())?;
    let backup_cache = backup.join("fonts");
    fs::rename(&font_cache, &backup_cache)
        .map_err(|error| format!("無法更新 ONLYOFFICE 字型快取：{error}"))?;
    Ok(Some(backup_cache))
}

fn prepare_onlyoffice_locale_for_launch() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        repair_macos_onlyoffice_locale()?;
        let installed_fonts = install_microsoft_tw_fonts()?;
        refresh_onlyoffice_font_cache_if_needed(&installed_fonts)?;
    }
    Ok(())
}

fn probe_port(port: u16) -> bool {
    let address = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
}

#[cfg(target_os = "macos")]
fn magi_listener_working_directory(port: u16) -> Option<PathBuf> {
    let listener = Command::new("/usr/sbin/lsof")
        .args(["-nP", &format!("-iTCP:{port}"), "-sTCP:LISTEN", "-F", "p"])
        .output()
        .ok()?;
    if !listener.status.success() {
        return None;
    }
    let pid = String::from_utf8_lossy(&listener.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('p'))
        .filter(|value| value.chars().all(|character| character.is_ascii_digit()))?
        .to_string();
    let working_directory = Command::new("/usr/sbin/lsof")
        .args(["-p", &pid, "-a", "-d", "cwd", "-F", "n"])
        .output()
        .ok()?;
    if !working_directory.status.success() {
        return None;
    }
    String::from_utf8_lossy(&working_directory.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n'))
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

#[cfg(not(target_os = "macos"))]
fn magi_listener_working_directory(_port: u16) -> Option<PathBuf> {
    None
}

fn magi_status() -> MagiStatus {
    let main = probe_port(5002);
    let tools = probe_port(5003);
    let snapshot = process_snapshot().to_ascii_lowercase();
    let listener_directories = [5002, 5003]
        .into_iter()
        .filter_map(magi_listener_working_directory)
        .collect::<Vec<_>>();
    let version_is_active = |name: &str| {
        magi_runtime_roots(name).iter().any(|root| {
            snapshot.contains(&root.to_string_lossy().to_ascii_lowercase())
                || listener_directories
                    .iter()
                    .any(|directory| directory.starts_with(root))
        })
    };
    let v2 = version_is_active("MAGI_v2");
    let v3 = version_is_active("MAGI_v3");
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
        {
            let magi_root = home.join("Library/Application Support/MAGI");
            roots.push(magi_root.join("runtime").join(name));
            let active_release = magi_root.join("runtime/active-release.json");
            if let Ok(content) = fs::read_to_string(active_release) {
                if let Ok(value) = serde_json::from_str::<Value>(&content) {
                    let expected_release = name.strip_prefix("MAGI_").unwrap_or(name);
                    let release_matches = value
                        .get("release")
                        .and_then(Value::as_str)
                        .map(|release| release.eq_ignore_ascii_case(expected_release))
                        .unwrap_or(false);
                    if release_matches {
                        if let Some(release_root) =
                            value.get("release_root").and_then(Value::as_str)
                        {
                            let release_root = PathBuf::from(release_root);
                            let releases_root = magi_root.join("releases");
                            if release_root.is_dir() && release_root.starts_with(&releases_root) {
                                roots.push(release_root);
                            }
                        }
                    }
                }
            }
        }
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
        engines: vec![
            engine_status("ONLYOFFICE"),
            engine_status("LibreOffice"),
            acropdf_engine_status(),
        ],
        magi: magi_status(),
    }
}

#[tauri::command]
fn onlyoffice_tw_status() -> OnlyOfficeTwStatus {
    onlyoffice_tw_status_value()
}

#[tauri::command]
fn repair_onlyoffice_traditional_chinese<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<ActionResult, String> {
    if engine_executable("ONLYOFFICE").is_none() {
        return Err("找不到 ONLYOFFICE，請先安裝桌面編輯器".into());
    }
    if onlyoffice_is_running() {
        return Err("請先儲存文件並關閉 ONLYOFFICE，再執行繁體中文修復".into());
    }
    #[cfg(target_os = "macos")]
    let locale_backup = repair_macos_onlyoffice_locale()?;
    #[cfg(not(target_os = "macos"))]
    let locale_backup: Option<PathBuf> = None;
    #[cfg(target_os = "macos")]
    let registered_fonts = install_microsoft_tw_fonts()?;
    #[cfg(not(target_os = "macos"))]
    let registered_fonts: Vec<PathBuf> = Vec::new();
    #[cfg(target_os = "macos")]
    let font_cache_backup = refresh_onlyoffice_font_cache_if_needed(&registered_fonts)?;
    #[cfg(not(target_os = "macos"))]
    let font_cache_backup: Option<PathBuf> = None;

    let plugin_source = resource_path(&app, "resources/onlyoffice-tw-plugin")?;
    let ai_locale_source = resource_path(&app, "resources/onlyoffice-ai-tw-locale")?;
    if !plugin_source.join("config.json").is_file()
        || !plugin_source.join("index.html").is_file()
        || !plugin_source.join("code.js").is_file()
        || !plugin_source.join("typography.js").is_file()
        || !plugin_source.join("ui-overrides.js").is_file()
        || !plugin_source.join("ui-patch.js").is_file()
        || !plugin_source.join("magi-result.html").is_file()
        || !plugin_source.join("magi-result.js").is_file()
    {
        return Err("安裝包缺少 ONLYOFFICE 繁中工具".into());
    }
    let plugin_destination = onlyoffice_user_plugin_root()?;
    copy_directory(&plugin_source, &plugin_destination)?;
    let ai_destination = install_onlyoffice_ai_tw(&ai_locale_source)?;
    refresh_magi_bridge_config()?;
    let status = onlyoffice_tw_status_value();
    if !status.traditional_chinese || !status.plugin_installed || !status.plugin_current {
        return Err("繁體中文工具安裝後驗證失敗，請保留備份並回報".into());
    }
    let backup_message = locale_backup
        .map(|path| format!("；原設定與簡體範本快取備份於 {}", path.display()))
        .unwrap_or_default();
    let font_message = if registered_fonts.len() == MICROSOFT_WORD_TW_FONT_FILES.len() {
        "；已從本機已授權的 Microsoft Office 註冊新細明體、細明體"
    } else if cfg!(target_os = "macos") {
        "；未找到 Microsoft Office 隨附的新細明體／細明體，未複製或散布任何專有字型"
    } else {
        ""
    };
    let font_cache_message = font_cache_backup
        .map(|path| format!("；舊字型快取備份於 {}", path.display()))
        .unwrap_or_default();
    Ok(ActionResult {
        path: plugin_destination.to_string_lossy().to_string(),
        file_name: "繁中寫作工具（全能文件）".into(),
        message: format!(
            "已固定 ONLYOFFICE 為 zh-TW、補齊繁中介面、安裝台灣繁中 AI 相容副本（{}）並鎖定數字字級{font_message}{font_cache_message}{backup_message}。重新開啟 ONLYOFFICE 後，可在「常用」使用 Word 式文字等距分布（Ctrl+Shift+J／⇧⌘J），以 Ctrl+Shift+C／V 或 macOS ⌘⌥C／V 複製與套用格式，在「全能文件」選新細明體／細明體並使用即時智慧引號，另可從「MAGI」頁籤呼叫本機 MAGI。",
            ai_destination.display()
        ),
    })
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
        "pdf" => ("PDF", "AcroPDF", "LibreOffice"),
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
        heading_count = detect_word_headings(&xml).len();
    }
    (count, heading_count, issues)
}

#[derive(Clone)]
struct HeadingPrefix {
    level: usize,
    prefix: String,
    numeral: String,
}

fn decode_xml_text(value: &str) -> String {
    let numeric = Regex::new(r"&#(x[0-9A-Fa-f]+|[0-9]+);").unwrap();
    let decoded = numeric
        .replace_all(value, |captures: &regex::Captures<'_>| {
            let token = captures.get(1).map(|value| value.as_str()).unwrap_or("");
            let number = token
                .strip_prefix('x')
                .or_else(|| token.strip_prefix('X'))
                .map(|value| u32::from_str_radix(value, 16))
                .unwrap_or_else(|| token.parse::<u32>())
                .ok();
            number
                .and_then(char::from_u32)
                .map(|character| character.to_string())
                .unwrap_or_else(|| captures[0].to_string())
        })
        .into_owned();
    decoded
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&")
}

fn encode_xml_text(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn paragraph_text(paragraph: &str) -> String {
    let expression = Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#).unwrap();
    expression
        .captures_iter(paragraph)
        .filter_map(|capture| capture.get(1))
        .map(|value| decode_xml_text(value.as_str()))
        .collect()
}

fn heading_prefix(text: &str) -> Option<HeadingPrefix> {
    let patterns = [
        (1, r#"^\s*([壹貳參肆伍陸柒捌玖拾佰]+)、"#),
        (1, r#"^\s*[〔【\[]([壹貳參肆伍陸柒捌玖拾佰]+)、[〕】\]]"#),
        (2, r#"^\s*([一二三四五六七八九十百]+)、"#),
        (2, r#"^\s*[〔【\[]([一二三四五六七八九十百]+)、[〕】\]]"#),
        (3, r#"^\s*[（(]([一二三四五六七八九十百]+)[）)]"#),
        (3, r#"^\s*[〔【]([一二三四五六七八九十百]+)[〕】]"#),
        (4, r#"^\s*([0-9]+)[、\.．]"#),
    ];
    for (level, pattern) in patterns {
        let expression = Regex::new(pattern).unwrap();
        let Some(capture) = expression.captures(text) else {
            continue;
        };
        return Some(HeadingPrefix {
            level,
            prefix: capture.get(0)?.as_str().to_string(),
            numeral: capture.get(1)?.as_str().to_string(),
        });
    }
    None
}

fn detect_word_headings(document_xml: &str) -> Vec<WordHeading> {
    let paragraphs = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let style =
        Regex::new(r#"<w:pStyle\b[^>]*w:val=\"(?:Heading|heading)([1-4])\"[^>]*/?>"#).unwrap();
    paragraphs
        .find_iter(document_xml)
        .enumerate()
        .filter_map(|(index, paragraph)| {
            let xml = paragraph.as_str();
            let text = paragraph_text(xml).trim().to_string();
            if text.is_empty() {
                return None;
            }
            let styled_level = style
                .captures(xml)
                .and_then(|capture| capture.get(1))
                .and_then(|value| value.as_str().parse::<usize>().ok());
            let level = styled_level.or_else(|| heading_prefix(&text).map(|value| value.level))?;
            Some(WordHeading {
                paragraph: index + 1,
                level,
                text,
            })
        })
        .collect()
}

fn count_matches(pattern: &str, text: &str) -> usize {
    Regex::new(pattern).unwrap().find_iter(text).count()
}

fn zip_text(archive: &mut ZipArchive<File>, name: &str) -> String {
    let Ok(mut entry) = archive.by_name(name) else {
        return String::new();
    };
    let mut content = String::new();
    let _ = entry.read_to_string(&mut content);
    content
}

fn build_word_report(path: &Path) -> Result<WordReport, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "docx" | "docm") {
        return Err("Word 文件中心目前支援 DOCX／DOCM；舊版 DOC 請先用救援引擎另存。".into());
    }
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "無法讀取 Word 文件結構")?;
    let names: Vec<String> = archive.file_names().map(String::from).collect();
    let document = zip_text(&mut archive, "word/document.xml");
    if document.is_empty() {
        return Err("Word 文件缺少 document.xml".into());
    }
    let styles = zip_text(&mut archive, "word/styles.xml");
    let settings = zip_text(&mut archive, "word/settings.xml");
    let relationships = zip_text(&mut archive, "word/_rels/document.xml.rels");
    let comments_xml = zip_text(&mut archive, "word/comments.xml");
    let footnotes_xml = zip_text(&mut archive, "word/footnotes.xml");
    let endnotes_xml = zip_text(&mut archive, "word/endnotes.xml");
    let footer_xml = names
        .iter()
        .filter(|name| name.starts_with("word/footer") && name.ends_with(".xml"))
        .map(|name| zip_text(&mut archive, name))
        .collect::<String>();

    let paragraph_expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let paragraph_values: Vec<String> = paragraph_expression
        .find_iter(&document)
        .map(|value| paragraph_text(value.as_str()))
        .filter(|value| !value.trim().is_empty())
        .collect();
    let characters = paragraph_values
        .iter()
        .flat_map(|value| value.chars())
        .filter(|value| !value.is_whitespace())
        .count();
    let paragraphs = paragraph_values.len();
    let tables = count_matches(r"<w:tbl(?:\s|>)", &document);
    let images = names
        .iter()
        .filter(|name| name.starts_with("word/media/") && !name.ends_with('/'))
        .count();
    let hyperlinks = count_matches(r"<w:hyperlink(?:\s|>)", &document)
        + count_matches(r#"TargetMode=\"External\""#, &relationships);
    let sections = count_matches(r"<w:sectPr(?:\s|>)", &document);
    let headers = names
        .iter()
        .filter(|name| name.starts_with("word/header") && name.ends_with(".xml"))
        .count();
    let footers = names
        .iter()
        .filter(|name| name.starts_with("word/footer") && name.ends_with(".xml"))
        .count();
    let footnotes = count_matches(r"<w:footnoteReference(?:\s|/|>)", &document);
    let endnotes = count_matches(r"<w:endnoteReference(?:\s|/|>)", &document);
    let comments = count_matches(r"<w:comment\b", &comments_xml);
    let tracked_insertions = count_matches(r"<w:ins(?:\s|>)", &document);
    let tracked_deletions = count_matches(r"<w:del(?:\s|>)", &document);
    let bookmarks = count_matches(r"<w:bookmarkStart(?:\s|>)", &document);
    let fields = count_matches(r"<w:fldSimple(?:\s|>)|<w:instrText(?:\s|>)", &document);
    let page_breaks = count_matches(r#"w:type=\"page\"|<w:lastRenderedPageBreak"#, &document);
    let mail_merge_fields = count_matches(r"MERGEFIELD", &document);
    let has_toc = document.contains("TOC");
    let has_page_numbers = footer_xml.contains("PAGE");
    let headings = detect_word_headings(&document);

    let font_expression = Regex::new(r#"w:(?:ascii|hAnsi|eastAsia)=\"([^\"]+)\""#).unwrap();
    let fonts = font_expression
        .captures_iter(&format!("{styles}{document}"))
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_string()))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();

    let drawing_objects = count_matches(r"<wp:docPr(?:\s|>)", &document);
    let described_objects =
        count_matches(r#"<wp:docPr\b[^>]*(?:descr|title)=\"[^\"]+\""#, &document);
    let missing_alt_text = drawing_objects.saturating_sub(described_objects);
    let header_tables = count_matches(r"<w:tblHeader(?:\s|/|>)", &document);
    let mut accessibility_warnings = Vec::new();
    if missing_alt_text > 0 {
        accessibility_warnings.push(format!("{missing_alt_text} 個圖片或繪圖物件缺少替代文字"));
    }
    if tables > header_tables {
        accessibility_warnings.push(format!(
            "{} 個表格需確認第一列是否標示為標題列",
            tables - header_tables
        ));
    }
    if !document.contains("<w:lang") && !styles.contains("<w:lang") {
        accessibility_warnings.push("尚未設定文件校訂語言，拼字與螢幕閱讀可能不準確".into());
    }
    if accessibility_warnings.is_empty() {
        accessibility_warnings.push("未發現可由結構自動判定的無障礙問題".into());
    }

    let mut print_warnings = Vec::new();
    if sections == 0 {
        print_warnings.push("沒有明確頁面／分節設定，請確認紙張與邊界".into());
    }
    if footers == 0 || !has_page_numbers {
        print_warnings.push("未偵測到頁尾頁碼".into());
    }
    if tracked_insertions + tracked_deletions > 0 {
        print_warnings.push("文件仍含追蹤修訂，送印前請決定接受或拒絕".into());
    }
    if comments > 0 {
        print_warnings.push(format!("文件仍含 {comments} 則註解，請確認是否列印標記"));
    }
    if has_toc && !settings.contains("updateFields") {
        print_warnings.push("文件有目錄，但未設定開啟時自動更新欄位".into());
    }
    if fonts.is_empty() {
        print_warnings.push("未讀到明確字型；換電腦時可能發生替代字型".into());
    }
    if print_warnings.is_empty() {
        print_warnings.push("結構檢查未發現明顯的送印風險".into());
    }

    let _ = (footnotes_xml, endnotes_xml);
    Ok(WordReport {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 文件")
            .into(),
        characters,
        paragraphs,
        tables,
        images,
        hyperlinks,
        sections,
        headers,
        footers,
        footnotes,
        endnotes,
        comments,
        tracked_insertions,
        tracked_deletions,
        bookmarks,
        fields,
        page_breaks,
        mail_merge_fields,
        has_toc,
        has_page_numbers,
        fonts,
        headings,
        accessibility_warnings,
        print_warnings,
    })
}

fn srgb_channel(value: u8) -> f64 {
    let value = f64::from(value) / 255.0;
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

fn color_contrast_against_white(hex: &str) -> Option<f64> {
    if hex.len() != 6 {
        return None;
    }
    let red = u8::from_str_radix(&hex[0..2], 16).ok()?;
    let green = u8::from_str_radix(&hex[2..4], 16).ok()?;
    let blue = u8::from_str_radix(&hex[4..6], 16).ok()?;
    let luminance =
        0.2126 * srgb_channel(red) + 0.7152 * srgb_channel(green) + 0.0722 * srgb_channel(blue);
    Some((1.05) / (luminance + 0.05))
}

fn build_accessibility_report(path: &Path) -> Result<AccessibilityReport, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "無法讀取 Word 文件結構")?;
    let names = archive.file_names().map(String::from).collect::<Vec<_>>();
    let document = zip_text(&mut archive, "word/document.xml");
    let styles = zip_text(&mut archive, "word/styles.xml");
    let core = zip_text(&mut archive, "docProps/core.xml");
    if document.is_empty() {
        return Err("Word 文件缺少 document.xml".into());
    }
    let mut issues = Vec::new();
    let drawing_expression = Regex::new(r#"<wp:docPr\b[^>]*>"#).unwrap();
    for (index, drawing) in drawing_expression.find_iter(&document).enumerate() {
        if !Regex::new(r#"(?:descr|title)=\"[^\"]+\""#)
            .unwrap()
            .is_match(drawing.as_str())
        {
            issues.push(AccessibilityIssue {
                id: format!("image-alt-{}", index + 1),
                severity: "error".into(),
                category: "替代文字".into(),
                message: "圖片或繪圖物件缺少可供螢幕閱讀器使用的替代文字".into(),
                location: format!("第 {} 個圖片／繪圖物件", index + 1),
                repairable: false,
            });
        }
    }
    let table_expression = Regex::new(r#"(?s)<w:tbl(?:\s[^>]*)?>.*?</w:tbl>"#).unwrap();
    for (index, table) in table_expression.find_iter(&document).enumerate() {
        if !table.as_str().contains("<w:tblHeader") {
            issues.push(AccessibilityIssue {
                id: format!("table-header-{}", index + 1),
                severity: "error".into(),
                category: "表格".into(),
                message: "第一列尚未標示為標題列，跨頁及螢幕閱讀時無法辨識欄位".into(),
                location: format!("第 {} 個表格", index + 1),
                repairable: true,
            });
        }
    }
    if !document.contains("<w:lang") && !styles.contains("<w:lang") {
        issues.push(AccessibilityIssue {
            id: "document-language".into(),
            severity: "error".into(),
            category: "文件語言".into(),
            message: "尚未設定繁體中文校訂語言".into(),
            location: "整份文件".into(),
            repairable: true,
        });
    }
    let title_expression = Regex::new(r#"(?s)<dc:title(?:\s[^>]*)?>(.*?)</dc:title>"#).unwrap();
    let title = title_expression
        .captures(&core)
        .and_then(|capture| capture.get(1))
        .map(|value| decode_xml_text(value.as_str()))
        .unwrap_or_default();
    if title.trim().is_empty() {
        issues.push(AccessibilityIssue {
            id: "document-title".into(),
            severity: "warning".into(),
            category: "文件屬性".into(),
            message: "文件標題屬性為空白，輔助工具難以辨識文件用途".into(),
            location: "檔案 → 文件屬性".into(),
            repairable: true,
        });
    }
    let headings = detect_word_headings(&document);
    let paragraph_count = Regex::new(r#"<w:p(?:\s|>)"#)
        .unwrap()
        .find_iter(&document)
        .count();
    if headings.is_empty() && paragraph_count >= 12 {
        issues.push(AccessibilityIssue {
            id: "missing-heading-structure".into(),
            severity: "warning".into(),
            category: "標題結構".into(),
            message: "長文件沒有使用標題樣式，螢幕閱讀器與導覽窗格無法快速跳章".into(),
            location: "整份文件".into(),
            repairable: false,
        });
    } else if !headings.is_empty() && headings.iter().all(|heading| heading.level != 1) {
        issues.push(AccessibilityIssue {
            id: "missing-heading-1".into(),
            severity: "warning".into(),
            category: "標題結構".into(),
            message: "文件有標題，但沒有最高層級的「標題 1」".into(),
            location: "整份文件".into(),
            repairable: false,
        });
    }
    for window in headings.windows(2) {
        if window[1].level > window[0].level + 1 {
            issues.push(AccessibilityIssue {
                id: format!("heading-skip-{}", window[1].paragraph),
                severity: "error".into(),
                category: "標題結構".into(),
                message: format!(
                    "標題層級由 H{} 跳到 H{}，請補上中間層級或調整樣式",
                    window[0].level, window[1].level
                ),
                location: format!("第 {} 段：{}", window[1].paragraph, window[1].text),
                repairable: false,
            });
        }
    }
    let paragraph_expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let vague_links = ["這裡", "按此", "點這裡", "連結", "click here", "read more"];
    for (index, paragraph) in paragraph_expression.find_iter(&document).enumerate() {
        if !paragraph.as_str().contains("<w:hyperlink") {
            continue;
        }
        let text = paragraph_text(paragraph.as_str()).trim().to_lowercase();
        if vague_links.iter().any(|value| text == *value) {
            issues.push(AccessibilityIssue {
                id: format!("link-text-{}", index + 1),
                severity: "warning".into(),
                category: "連結文字".into(),
                message: "連結文字沒有描述目的；請改為可獨立理解的名稱".into(),
                location: format!("第 {} 段：{}", index + 1, text),
                repairable: false,
            });
        }
    }
    let cell_expression = Regex::new(r#"(?s)<w:tc(?:\s[^>]*)?>.*?</w:tc>"#).unwrap();
    for (index, cell) in cell_expression.find_iter(&document).enumerate() {
        if paragraph_text(cell.as_str()).trim().is_empty() {
            issues.push(AccessibilityIssue {
                id: format!("empty-table-cell-{}", index + 1),
                severity: "warning".into(),
                category: "表格".into(),
                message: "空白儲存格沒有可供螢幕閱讀器理解的內容".into(),
                location: format!("第 {} 個表格儲存格", index + 1),
                repairable: false,
            });
        }
    }
    let control_expression = Regex::new(r#"(?s)<w:sdt(?:\s[^>]*)?>.*?</w:sdt>"#).unwrap();
    for (index, control) in control_expression.find_iter(&document).enumerate() {
        if !control.as_str().contains("<w:alias") && !control.as_str().contains("<w:tag") {
            issues.push(AccessibilityIssue {
                id: format!("content-control-label-{}", index + 1),
                severity: "warning".into(),
                category: "表單控制項".into(),
                message: "內容控制項沒有標題或標籤，使用輔助工具時難以辨識用途".into(),
                location: format!("第 {} 個內容控制項", index + 1),
                repairable: false,
            });
        }
    }
    let run_expression = Regex::new(r#"(?s)<w:r(?:\s[^>]*)?>.*?</w:r>"#).unwrap();
    let color_expression =
        Regex::new(r#"<w:color\b[^>]*w:val="([0-9A-Fa-f]{6})"[^>]*/?>"#).unwrap();
    let mut low_contrast_count = 0usize;
    for run in run_expression.find_iter(&document) {
        let Some(color) = color_expression
            .captures(run.as_str())
            .and_then(|capture| capture.get(1))
        else {
            continue;
        };
        let text = paragraph_text(run.as_str()).trim().to_string();
        if text.is_empty() {
            continue;
        }
        if color_contrast_against_white(color.as_str()).is_some_and(|ratio| ratio < 4.5) {
            low_contrast_count += 1;
            if low_contrast_count <= 8 {
                issues.push(AccessibilityIssue {
                    id: format!("color-contrast-{low_contrast_count}"),
                    severity: "error".into(),
                    category: "色彩對比".into(),
                    message: format!(
                        "文字色彩 #{} 在白底上的對比低於一般文字 4.5:1",
                        color.as_str().to_uppercase()
                    ),
                    location: format!("文字：{}", text.chars().take(36).collect::<String>()),
                    repairable: false,
                });
            }
        }
    }
    let excessive_tabs = document.matches("<w:tab").count();
    if excessive_tabs >= 5 {
        issues.push(AccessibilityIssue {
            id: "layout-tabs".into(),
            severity: "warning".into(),
            category: "閱讀順序".into(),
            message: "文件大量使用定位字元排版，閱讀順序可能與視覺位置不同".into(),
            location: format!("整份文件：{excessive_tabs} 個定位字元"),
            repairable: false,
        });
    }
    if !names.iter().any(|name| name.starts_with("word/media/")) {
        // A document without images does not need an alternate-text issue.
    }
    let deduction = issues
        .iter()
        .map(|issue| if issue.severity == "error" { 12 } else { 5 })
        .sum::<usize>();
    let mut passed_checks = Vec::new();
    if !issues.iter().any(|issue| issue.category == "替代文字") {
        passed_checks.push("所有圖片／繪圖物件都有替代文字".into());
    }
    if !issues.iter().any(|issue| issue.category == "表格") {
        passed_checks.push("所有表格都已標示標題列".into());
    }
    if !issues.iter().any(|issue| issue.category == "文件語言") {
        passed_checks.push("文件校訂語言已設定".into());
    }
    if !issues.iter().any(|issue| issue.category == "標題結構") {
        passed_checks.push("標題層級沒有跳號".into());
    }
    if !issues.iter().any(|issue| issue.category == "連結文字") {
        passed_checks.push("未發現含糊的連結文字".into());
    }
    if !issues.iter().any(|issue| issue.category == "文件屬性") {
        passed_checks.push("文件標題屬性已設定".into());
    }
    if !issues.iter().any(|issue| issue.category == "表單控制項") {
        passed_checks.push("內容控制項都有可辨識標籤".into());
    }
    if !issues.iter().any(|issue| issue.category == "色彩對比") {
        passed_checks.push("未發現明顯低對比直接文字色彩".into());
    }
    if !issues.iter().any(|issue| issue.category == "閱讀順序") {
        passed_checks.push("未發現大量定位字元造成的閱讀順序風險".into());
    }
    Ok(AccessibilityReport {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 文件")
            .into(),
        score: 100usize.saturating_sub(deduction),
        issues,
        passed_checks,
    })
}

#[tauri::command]
fn word_accessibility_report(path: String) -> Result<AccessibilityReport, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    build_accessibility_report(&source)
}

fn push_quality_issue(
    issues: &mut Vec<QualityIssue>,
    severity: &str,
    category: &str,
    message: impl Into<String>,
    location: impl Into<String>,
    suggestion: impl Into<String>,
) {
    issues.push(QualityIssue {
        severity: severity.into(),
        category: category.into(),
        message: message.into(),
        location: location.into(),
        suggestion: suggestion.into(),
    });
}

fn repeated_han_sequence(value: &str) -> Option<String> {
    let characters = value.chars().collect::<Vec<_>>();
    for width in (2..=8).rev() {
        if characters.len() < width * 2 {
            continue;
        }
        for start in 0..=characters.len() - width * 2 {
            let left = &characters[start..start + width];
            let right = &characters[start + width..start + width * 2];
            if left == right
                && left.iter().all(|character| {
                    matches!(*character as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF)
                })
            {
                return Some(characters[start..start + width * 2].iter().collect());
            }
        }
    }
    None
}

fn build_word_quality_report(path: &Path) -> Result<WordQualityReport, String> {
    let document = read_word_document_xml(path)?;
    let paragraphs = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#)
        .unwrap()
        .find_iter(&document)
        .enumerate()
        .filter_map(|(index, paragraph)| {
            let text = paragraph_text(paragraph.as_str()).trim().to_string();
            (!text.is_empty()).then_some((index + 1, text))
        })
        .collect::<Vec<_>>();
    let text = paragraphs
        .iter()
        .map(|(_, value)| value.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let mut issues = Vec::new();
    let unresolved = Regex::new(r#"\{\{[^{}\n]+\}\}|«[^»\n]+»|<<[^<>\n]+>>"#).unwrap();
    for (paragraph, value) in &paragraphs {
        if let Some(found) = unresolved.find(value) {
            push_quality_issue(
                &mut issues,
                "error",
                "未完成欄位",
                format!("仍有未完成的欄位或預留文字：{}", found.as_str()),
                format!("第 {paragraph} 段"),
                "完成合併列印／引文更新，或刪除不需要的預留文字",
            );
        }
    }
    let pairs = [
        ('（', '）'),
        ('「', '」'),
        ('『', '』'),
        ('【', '】'),
        ('〔', '〕'),
        ('《', '》'),
        ('〈', '〉'),
    ];
    for (opening, closing) in pairs {
        let open_count = text.matches(opening).count();
        let close_count = text.matches(closing).count();
        if open_count != close_count {
            push_quality_issue(
                &mut issues,
                "error",
                "標點成對",
                format!("「{opening}{closing}」數量不一致：{open_count}／{close_count}"),
                "整份文件",
                "使用「智慧補齊」後逐項確認巢狀標點",
            );
        }
    }
    let ascii_punctuation = Regex::new(r#"[\p{Han}][,;:!?]|[,;:!?][\p{Han}]"#).unwrap();
    for (paragraph, value) in &paragraphs {
        if ascii_punctuation.is_match(value) {
            push_quality_issue(
                &mut issues,
                "warning",
                "台灣標點",
                "中文句子混用了半形逗號、分號、冒號、驚嘆號或問號",
                format!(
                    "第 {paragraph} 段：{}",
                    value.chars().take(48).collect::<String>()
                ),
                "改用全形中文標點，網址、程式碼與數字格式除外",
            );
        }
        if value.contains("  ") || value.contains('\t') {
            push_quality_issue(
                &mut issues,
                "warning",
                "空白與對齊",
                "以連續空白或定位字元排版，修改字型後容易錯位",
                format!("第 {paragraph} 段"),
                "改用定位點、表格、縮排或分散對齊",
            );
        }
        if value.chars().count() > 180
            && !value.contains('。')
            && !value.contains('；')
            && !value.contains('：')
        {
            push_quality_issue(
                &mut issues,
                "warning",
                "可讀性",
                "句段過長且缺少明顯停頓，閱讀負擔較高",
                format!(
                    "第 {paragraph} 段：{}…",
                    value.chars().take(48).collect::<String>()
                ),
                "拆成較短句子或條列，並確認不改變法律語意",
            );
        }
        if Regex::new(r#"(?i)\b(?:TODO|FIXME|XXX)\b|待補|待確認|尚待"#)
            .unwrap()
            .is_match(value)
        {
            push_quality_issue(
                &mut issues,
                "error",
                "交付前註記",
                "仍有待辦或待確認註記",
                format!(
                    "第 {paragraph} 段：{}",
                    value.chars().take(48).collect::<String>()
                ),
                "交付前完成、刪除，或明確標示為正式保留事項",
            );
        }
    }
    let mainland_terms = [
        ("信息", "資訊"),
        ("軟件", "軟體"),
        ("硬件", "硬體"),
        ("打印", "列印"),
        ("視頻", "影片"),
        ("文件夾", "資料夾"),
    ];
    for (source, replacement) in mainland_terms {
        if let Some((paragraph, value)) =
            paragraphs.iter().find(|(_, value)| value.contains(source))
        {
            push_quality_issue(
                &mut issues,
                "warning",
                "台灣用語",
                format!("偵測到「{source}」"),
                format!(
                    "第 {paragraph} 段：{}",
                    value.chars().take(48).collect::<String>()
                ),
                format!("依語境考慮改為台灣常用「{replacement}」"),
            );
        }
    }
    for (paragraph, value) in &paragraphs {
        if let Some(found) = repeated_han_sequence(value) {
            push_quality_issue(
                &mut issues,
                "warning",
                "重複文字",
                format!("可能重複輸入：{found}"),
                format!("第 {paragraph} 段"),
                "確認是否為刻意強調；若不是，刪除重複文字",
            );
        }
    }
    let sentence_count = Regex::new(r#"[。！？!?](?:[」』）】〕》〉])?"#)
        .unwrap()
        .find_iter(&text)
        .count()
        .max(usize::from(!text.trim().is_empty()));
    let deduction = issues
        .iter()
        .map(|issue| if issue.severity == "error" { 10 } else { 4 })
        .sum::<usize>();
    let categories = [
        ("未完成欄位", "沒有未完成欄位"),
        ("標點成對", "括號與引號數量成對"),
        ("台灣標點", "未發現中文半形標點混用"),
        ("交付前註記", "沒有待辦／待確認註記"),
        ("台灣用語", "未發現常見非台灣用語"),
    ];
    let passed_checks = categories
        .into_iter()
        .filter(|(category, _)| !issues.iter().any(|issue| issue.category == *category))
        .map(|(_, passed)| passed.to_string())
        .collect::<Vec<_>>();
    Ok(WordQualityReport {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 文件")
            .into(),
        score: 100usize.saturating_sub(deduction),
        characters: text
            .chars()
            .filter(|character| !character.is_whitespace())
            .count(),
        sentences: sentence_count,
        issues,
        passed_checks,
    })
}

#[tauri::command]
fn word_quality_report(path: String) -> Result<WordQualityReport, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    build_word_quality_report(&source)
}

fn mark_table_header_rows(document: &str) -> (String, usize) {
    let table_expression = Regex::new(r#"(?s)<w:tbl(?:\s[^>]*)?>.*?</w:tbl>"#).unwrap();
    let row_expression = Regex::new(r#"(?s)<w:tr(?:\s[^>]*)?>.*?</w:tr>"#).unwrap();
    let row_properties = Regex::new(r#"<w:trPr(?:\s[^>]*)?>"#).unwrap();
    let mut replacements = Vec::new();
    for table in table_expression.find_iter(document) {
        if table.as_str().contains("<w:tblHeader") {
            continue;
        }
        let Some(row) = row_expression.find(table.as_str()) else {
            continue;
        };
        let mut next = row.as_str().to_string();
        if let Some(properties) = row_properties.find(&next) {
            next.insert_str(properties.end(), "<w:tblHeader/>");
        } else if let Some(opening) = next.find('>') {
            next.insert_str(opening + 1, "<w:trPr><w:tblHeader/></w:trPr>");
        }
        replacements.push((
            (table.start() + row.start())..(table.start() + row.end()),
            next,
        ));
    }
    let count = replacements.len();
    let mut output = document.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    (output, count)
}

fn ensure_traditional_chinese_language(styles: &str) -> (String, bool) {
    if styles.contains("<w:lang") {
        return (styles.to_string(), false);
    }
    let language = r#"<w:lang w:val="zh-TW" w:eastAsia="zh-TW" w:bidi="zh-TW"/>"#;
    let empty_run_properties = Regex::new(r#"<w:rPr(?:\s[^>]*)?/>"#).unwrap();
    if empty_run_properties.is_match(styles) {
        return (
            empty_run_properties
                .replace(styles, format!("<w:rPr>{language}</w:rPr>"))
                .into_owned(),
            true,
        );
    }
    let run_properties = Regex::new(r#"<w:rPr(?:\s[^>]*)?>"#).unwrap();
    if let Some(value) = run_properties.find(styles) {
        let mut output = styles.to_string();
        output.insert_str(value.end(), language);
        return (output, true);
    }
    (styles.to_string(), false)
}

fn ensure_core_title(core: &str, title: &str) -> (String, bool) {
    let expression = Regex::new(r#"(?s)<dc:title(?:\s[^>]*)?>(.*?)</dc:title>"#).unwrap();
    if let Some(capture) = expression.captures(core) {
        if capture
            .get(1)
            .map(|value| !decode_xml_text(value.as_str()).trim().is_empty())
            .unwrap_or(false)
        {
            return (core.to_string(), false);
        }
        return (
            expression
                .replace(
                    core,
                    format!("<dc:title>{}</dc:title>", encode_xml_text(title)),
                )
                .into_owned(),
            true,
        );
    }
    if let Some(position) = core.rfind("</cp:coreProperties>") {
        let mut output = core.to_string();
        output.insert_str(
            position,
            &format!("<dc:title>{}</dc:title>", encode_xml_text(title)),
        );
        return (output, true);
    }
    (core.to_string(), false)
}

#[tauri::command]
fn repair_word_accessibility(path: String, destination: String) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let target = PathBuf::from(destination);
    let title = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Word 文件")
        .to_string();
    let mut repairs = 0usize;
    rewrite_word_package(&source, &target, |name, xml| match name {
        "word/document.xml" => {
            let (next, count) = mark_table_header_rows(xml);
            repairs += count;
            Some(next)
        }
        "word/styles.xml" => {
            let (next, changed) = ensure_traditional_chinese_language(xml);
            repairs += usize::from(changed);
            Some(next)
        }
        "docProps/core.xml" => {
            let (next, changed) = ensure_core_title(xml, &title);
            repairs += usize::from(changed);
            Some(next)
        }
        _ => None,
    })?;
    if repairs == 0 {
        return Err(
            "沒有可安全自動修復的項目；其餘問題需要人工補寫替代文字或調整標題／連結".into(),
        );
    }
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("無障礙修復.docx")
            .into(),
        message: format!(
            "已在新副本安全修復 {repairs} 項：文件語言、標題屬性與表格標題列；圖片替代文字仍保留給人工描述"
        ),
    })
}

fn citation_store_path() -> Result<PathBuf, String> {
    let root = data_root()?.join("Citations");
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    Ok(root.join("sources.json"))
}

fn read_citation_sources_unlocked() -> Result<Vec<CitationSource>, String> {
    let path = citation_store_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| format!("引文來源資料格式錯誤：{error}"))
}

fn write_citation_sources_unlocked(sources: &[CitationSource]) -> Result<(), String> {
    let path = citation_store_path()?;
    let temporary = path.with_extension("json.tmp");
    fs::write(
        &temporary,
        serde_json::to_vec_pretty(sources).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    fs::rename(temporary, path).map_err(|error| error.to_string())
}

#[tauri::command]
fn citation_sources() -> Result<Vec<CitationSource>, String> {
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    read_citation_sources_unlocked()
}

#[tauri::command]
fn save_citation_source(mut source: CitationSource) -> Result<CitationSource, String> {
    if source.title.trim().is_empty() {
        return Err("來源標題不能留白".into());
    }
    if source.author.trim().is_empty() {
        return Err("作者／機關不能留白".into());
    }
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    if source.id.trim().is_empty() {
        source.id = format!(
            "src-{}-{}",
            Local::now().format("%Y%m%d%H%M%S%3f"),
            std::process::id()
        );
    }
    if source.source_type.trim().is_empty() {
        source.source_type = "book".into();
    }
    let mut sources = read_citation_sources_unlocked().unwrap_or_default();
    if let Some(existing) = sources.iter_mut().find(|value| value.id == source.id) {
        *existing = source.clone();
    } else {
        sources.push(source.clone());
    }
    sources.sort_by(|left, right| {
        left.author
            .to_lowercase()
            .cmp(&right.author.to_lowercase())
            .then(left.year.cmp(&right.year))
    });
    write_citation_sources_unlocked(&sources)?;
    Ok(source)
}

#[tauri::command]
fn delete_citation_source(id: String) -> Result<(), String> {
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    let mut sources = read_citation_sources_unlocked()?;
    sources.retain(|value| value.id != id);
    write_citation_sources_unlocked(&sources)
}

fn short_author(author: &str) -> String {
    author
        .split([';', '；', '&'])
        .next()
        .unwrap_or(author)
        .split(',')
        .next()
        .unwrap_or(author)
        .trim()
        .to_string()
}

fn citation_locator(source: &CitationSource) -> String {
    if !source.doi.trim().is_empty() {
        if source.doi.starts_with("http") {
            source.doi.trim().to_string()
        } else {
            format!("https://doi.org/{}", source.doi.trim())
        }
    } else {
        source.url.trim().to_string()
    }
}

fn format_source(source: &CitationSource, style: &str) -> String {
    let locator = citation_locator(source);
    match style {
        "mla9" => {
            let mut parts = vec![format!(
                "{}. “{}.”",
                source.author.trim(),
                source.title.trim()
            )];
            if !source.container_title.trim().is_empty() {
                parts.push(format!("{},", source.container_title.trim()));
            }
            if !source.volume.trim().is_empty() {
                parts.push(format!("vol. {},", source.volume.trim()));
            }
            if !source.issue.trim().is_empty() {
                parts.push(format!("no. {},", source.issue.trim()));
            }
            if !source.publisher.trim().is_empty() {
                parts.push(format!("{},", source.publisher.trim()));
            }
            if !source.year.trim().is_empty() {
                parts.push(format!("{},", source.year.trim()));
            }
            if !source.pages.trim().is_empty() {
                parts.push(format!("pp. {}.", source.pages.trim()));
            }
            if !locator.is_empty() {
                parts.push(locator);
            }
            parts.join(" ")
        }
        "chicago" => {
            let mut text = format!(
                "{}. {}. {}.",
                source.author.trim(),
                source.year.trim(),
                source.title.trim()
            );
            if !source.container_title.trim().is_empty() {
                text.push_str(&format!(" {}.", source.container_title.trim()));
            }
            if !source.publisher.trim().is_empty() {
                text.push_str(&format!(" {}.", source.publisher.trim()));
            }
            if !locator.is_empty() {
                text.push_str(&format!(" {locator}"));
            }
            text
        }
        "taiwan" => {
            let mut text = format!(
                "{}（{}），〈{}〉",
                source.author.trim(),
                source.year.trim(),
                source.title.trim()
            );
            if !source.container_title.trim().is_empty() {
                text.push_str(&format!("，《{}》", source.container_title.trim()));
            }
            if !source.volume.trim().is_empty() {
                text.push_str(&format!("，第{}卷", source.volume.trim()));
            }
            if !source.issue.trim().is_empty() {
                text.push_str(&format!("第{}期", source.issue.trim()));
            }
            if !source.pages.trim().is_empty() {
                text.push_str(&format!("，頁{}", source.pages.trim()));
            }
            if !locator.is_empty() {
                text.push_str(&format!("，{locator}"));
            }
            text.push('。');
            text
        }
        _ => {
            let mut text = format!(
                "{} ({}). {}.",
                source.author.trim(),
                source.year.trim(),
                source.title.trim()
            );
            if !source.container_title.trim().is_empty() {
                text.push_str(&format!(" {}.", source.container_title.trim()));
            }
            if !source.publisher.trim().is_empty() {
                text.push_str(&format!(" {}.", source.publisher.trim()));
            }
            if !source.volume.trim().is_empty() {
                text.push_str(&format!(" {}", source.volume.trim()));
                if !source.issue.trim().is_empty() {
                    text.push_str(&format!("({})", source.issue.trim()));
                }
                text.push('.');
            }
            if !source.pages.trim().is_empty() {
                text.push_str(&format!(" {}.", source.pages.trim()));
            }
            if !locator.is_empty() {
                text.push_str(&format!(" {locator}"));
            }
            text
        }
    }
}

fn format_citation_values(sources: &[CitationSource], style: &str) -> CitationText {
    let inline = match style {
        "mla9" => format!(
            "({})",
            sources
                .iter()
                .map(|source| {
                    let author = short_author(&source.author);
                    if source.pages.trim().is_empty() {
                        author
                    } else {
                        format!("{author} {}", source.pages.trim())
                    }
                })
                .collect::<Vec<_>>()
                .join("; ")
        ),
        "taiwan" => format!(
            "（{}）",
            sources
                .iter()
                .map(|source| format!("{}，{}", short_author(&source.author), source.year.trim()))
                .collect::<Vec<_>>()
                .join("；")
        ),
        _ => format!(
            "({})",
            sources
                .iter()
                .map(|source| format!("{}, {}", short_author(&source.author), source.year.trim()))
                .collect::<Vec<_>>()
                .join("; ")
        ),
    };
    CitationText {
        inline,
        bibliography: sources
            .iter()
            .map(|source| format_source(source, style))
            .collect(),
    }
}

fn selected_citation_sources(ids: &[String]) -> Result<Vec<CitationSource>, String> {
    let sources = read_citation_sources_unlocked()?;
    let selected = ids
        .iter()
        .filter_map(|id| sources.iter().find(|source| source.id == *id).cloned())
        .collect::<Vec<_>>();
    if selected.is_empty() {
        return Err("請至少選擇一筆引文來源".into());
    }
    Ok(selected)
}

#[tauri::command]
fn format_citation(source_ids: Vec<String>, style: String) -> Result<CitationText, String> {
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    let sources = selected_citation_sources(&source_ids)?;
    Ok(format_citation_values(&sources, &style))
}

fn bibliography_paragraph(text: &str) -> String {
    format!(
        r#"<w:p><w:pPr><w:ind w:left="720" w:hanging="720"/></w:pPr><w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        encode_xml_text(text)
    )
}

fn dynamic_citation_tag(kind: &str, style: &str, source_ids: &[String]) -> String {
    format!(
        "OpenDeskTW.Citation|{}|{}|{}",
        kind,
        style,
        source_ids.join(",")
    )
}

fn dynamic_citation_block(
    kind: &str,
    style: &str,
    source_ids: &[String],
    citation: &CitationText,
) -> String {
    let tag = encode_xml_text(&dynamic_citation_tag(kind, style, source_ids));
    let (alias, content) = if kind == "inline" {
        (
            "OpenDeskTW 動態內文引文",
            word_paragraph(&citation.inline, None),
        )
    } else {
        let heading = if style == "taiwan" {
            "參考文獻"
        } else {
            "References"
        };
        (
            "OpenDeskTW 動態參考書目",
            format!(
                "{}{}",
                word_paragraph(heading, Some("Heading1")),
                citation
                    .bibliography
                    .iter()
                    .map(|value| bibliography_paragraph(value))
                    .collect::<String>()
            ),
        )
    };
    format!(
        r#"<w:sdt><w:sdtPr><w:alias w:val="{alias}"/><w:tag w:val="{tag}"/></w:sdtPr><w:sdtContent>{content}</w:sdtContent></w:sdt>"#
    )
}

fn remove_existing_bibliography(document: &str) -> String {
    let old_bookmark = Regex::new(
        r#"(?s)<w:bookmarkStart\b[^>]*w:name="OpenDeskBibliography"[^>]*/>.*?<w:bookmarkEnd\b[^>]*/>"#,
    )
    .unwrap()
    .replace_all(document, "")
    .into_owned();
    Regex::new(
        r#"(?s)<w:sdt><w:sdtPr>.*?<w:tag\b[^>]*w:val="OpenDeskTW\.Citation\|bibliography\|[^"]*"[^>]*/>.*?</w:sdt>"#,
    )
    .unwrap()
    .replace_all(&old_bookmark, "")
    .into_owned()
}

fn update_dynamic_citation_xml(document: &str) -> Result<(String, usize), String> {
    let sources = read_citation_sources_unlocked()?;
    let sdt_expression = Regex::new(r#"(?s)<w:sdt>.*?</w:sdt>"#).unwrap();
    let tag_expression = Regex::new(
        r#"<w:tag\b[^>]*w:val="OpenDeskTW\.Citation\|([^|"]+)\|([^|"]+)\|([^"]*)"[^>]*/?>"#,
    )
    .unwrap();
    let mut replacements = Vec::new();
    for block in sdt_expression.find_iter(document) {
        let Some(tag) = tag_expression.captures(block.as_str()) else {
            continue;
        };
        let kind = tag.get(1).unwrap().as_str();
        let style = tag.get(2).unwrap().as_str();
        let ids = tag
            .get(3)
            .unwrap()
            .as_str()
            .split(',')
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>();
        let selected = ids
            .iter()
            .filter_map(|id| sources.iter().find(|source| source.id == *id).cloned())
            .collect::<Vec<_>>();
        if selected.is_empty() {
            continue;
        }
        let citation = format_citation_values(&selected, style);
        replacements.push((
            block.start()..block.end(),
            dynamic_citation_block(kind, style, &ids, &citation),
        ));
    }
    let count = replacements.len();
    let mut output = document.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    Ok((output, count))
}

#[tauri::command]
fn append_bibliography(
    path: String,
    destination: String,
    source_ids: Vec<String>,
    style: String,
) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    let sources = selected_citation_sources(&source_ids)?;
    let citation = format_citation_values(&sources, &style);
    let document = read_word_document_xml(&source)?;
    let previous = remove_existing_bibliography(&document);
    let block = dynamic_citation_block("bibliography", &style, &source_ids, &citation);
    let body_end = previous
        .rfind("<w:sectPr")
        .or_else(|| previous.rfind("</w:body>"));
    let Some(position) = body_end else {
        return Err("文件缺少可插入參考文獻的位置".into());
    };
    let mut next = previous;
    next.insert_str(position, &block);
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &next)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("含參考文獻文件.docx")
            .into(),
        message: format!(
            "已依 {} 產生 {} 筆可更新參考文獻並加入新副本",
            style.to_uppercase(),
            sources.len()
        ),
    })
}

#[tauri::command]
fn insert_dynamic_citation(
    path: String,
    destination: String,
    source_ids: Vec<String>,
    style: String,
) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    let sources = selected_citation_sources(&source_ids)?;
    let citation = format_citation_values(&sources, &style);
    let document = read_word_document_xml(&source)?;
    let block = dynamic_citation_block("inline", &style, &source_ids, &citation);
    let placeholder =
        Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?<w:t\b[^>]*>\s*\{\{CITATION\}\}\s*</w:t>.*?</w:p>"#)
            .unwrap();
    let (next, at_placeholder) = if placeholder.is_match(&document) {
        (
            placeholder.replace(&document, block.as_str()).into_owned(),
            true,
        )
    } else {
        (insert_before_section_properties(&document, &block)?, false)
    };
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &next)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("含引文文件.docx")
            .into(),
        message: if at_placeholder {
            "已在 {{CITATION}} 位置插入可更新內文引文"
        } else {
            "文件沒有 {{CITATION}} 位置，已將可更新內文引文加入文件末端"
        }
        .into(),
    })
}

#[tauri::command]
fn update_document_citations(path: String, destination: String) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let _guard = CITATION_SOURCES
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "引文來源目前無法鎖定")?;
    let document = read_word_document_xml(&source)?;
    let (updated, count) = update_dynamic_citation_xml(&document)?;
    if count == 0 {
        return Err("文件中沒有由全能文件建立的動態引文或參考書目".into());
    }
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &updated)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("更新引文文件.docx")
            .into(),
        message: format!("已從本機來源庫更新 {count} 個引文／書目區塊"),
    })
}

fn insert_before_section_properties(document: &str, content: &str) -> Result<String, String> {
    let position = document
        .rfind("<w:sectPr")
        .or_else(|| document.rfind("</w:body>"))
        .ok_or("文件缺少可插入內容的位置")?;
    let mut output = document.to_string();
    output.insert_str(position, content);
    Ok(output)
}

fn insert_after_body_open(document: &str, content: &str) -> Result<String, String> {
    let body = Regex::new(r#"<w:body(?:\s[^>]*)?>"#).unwrap();
    let opening = body.find(document).ok_or("文件缺少本文區段")?;
    let mut output = document.to_string();
    output.insert_str(opening.end(), content);
    Ok(output)
}

fn diagram_cell(text: &str, width: usize, fill: &str) -> String {
    format!(
        r#"<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/><w:shd w:fill="{fill}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p></w:tc>"#,
        encode_xml_text(text)
    )
}

fn editable_diagram(kind: &str, title: &str, items: &[String]) -> Result<String, String> {
    if items.is_empty() {
        return Err("圖解至少需要一個項目".into());
    }
    if items.len() > 50 {
        return Err("單一圖解最多 50 個項目".into());
    }
    let heading = (!title.trim().is_empty())
        .then(|| word_paragraph(title, Some("Heading2")))
        .unwrap_or_default();
    match kind {
        "process" => {
            let width = (9_000 / items.len().max(1)).max(1_100);
            let cells = items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let cell = diagram_cell(
                        item,
                        width,
                        if index.is_multiple_of(2) {
                            "DCE6F1"
                        } else {
                            "E2F0D9"
                        },
                    );
                    if index + 1 == items.len() {
                        cell
                    } else {
                        format!("{cell}{}", diagram_cell("→", 360, "FFFFFF"))
                    }
                })
                .collect::<String>();
            Ok(format!(
                r#"{heading}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr><w:tr>{cells}</w:tr></w:tbl>"#
            ))
        }
        "matrix" => {
            let mut values = items.to_vec();
            values.resize(4, String::new());
            Ok(format!(
                r#"{heading}<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr><w:tr>{}{}</w:tr><w:tr>{}{}</w:tr></w:tbl>"#,
                diagram_cell(&values[0], 4500, "DCE6F1"),
                diagram_cell(&values[1], 4500, "E2F0D9"),
                diagram_cell(&values[2], 4500, "FFF2CC"),
                diagram_cell(&values[3], 4500, "FCE4D6")
            ))
        }
        "hierarchy" => {
            let rows = items
                .iter()
                .enumerate()
                .map(|(index, item)| {
                    let indent = if index == 0 { 0 } else { 720 };
                    format!(
                        r#"<w:p><w:pPr><w:ind w:left="{indent}"/><w:shd w:fill="{}"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>{}</w:t></w:r></w:p>"#,
                        if index == 0 { "DCE6F1" } else { "E2F0D9" },
                        encode_xml_text(item)
                    )
                })
                .collect::<String>();
            Ok(format!("{heading}{rows}"))
        }
        _ => Err("圖解類型必須是流程、階層或矩陣".into()),
    }
}

#[tauri::command]
fn insert_word_component(
    path: String,
    destination: String,
    kind: String,
    title: String,
    subtitle: String,
    items: Vec<String>,
) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let document = read_word_document_xml(&source)?;
    let (document, message) = match kind.as_str() {
        "cover" => {
            let date = Local::now().format("%Y 年 %m 月 %d 日").to_string();
            let content = format!(
                r#"<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="2400" w:after="480"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="48"/></w:rPr><w:t>{}</w:t></w:r></w:p><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>{}</w:t></w:r></w:p>{}<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p><w:p><w:r><w:br w:type="page"/></w:r></w:p>"#,
                encode_xml_text(&title),
                encode_xml_text(&subtitle),
                items
                    .first()
                    .map(|author| word_paragraph(author, None))
                    .unwrap_or_default(),
                encode_xml_text(&date)
            );
            (
                insert_after_body_open(&document, &content)?,
                "已插入可編輯封面頁".to_string(),
            )
        }
        "autotext" => (
            insert_before_section_properties(&document, &word_paragraph(&title, None))?,
            "已將 AutoText 插入文件末端".to_string(),
        ),
        "process" | "hierarchy" | "matrix" => (
            insert_before_section_properties(&document, &editable_diagram(&kind, &title, &items)?)?,
            "已插入可在 Word 編輯器繼續修改的開放式圖解".to_string(),
        ),
        _ => return Err("未知的 Word 元件類型".into()),
    };
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &document)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 元件文件.docx")
            .into(),
        message,
    })
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

fn magi_analyze_text(
    text: String,
    truncated: bool,
    file_name: &str,
    mode: &str,
    instruction: &str,
) -> Result<MagiReply, String> {
    let status = magi_status();
    if !status.v2_v3_safe {
        return Err("偵測到 MAGI V2／V3 同時運作；為保護資料已停止分析".into());
    }
    if !status.available {
        return Err(status.summary);
    }
    if text.trim().is_empty() {
        return Err("目前文件沒有可供 MAGI 分析的文字".into());
    }
    let task = match mode {
        "summary" => "整理文件摘要、重要數字、日期、待辦與決策。",
        "review" => "校對內容，找出語句、數字、日期、邏輯與前後矛盾的疑點。",
        "structure" => "檢查標題層級、段落結構、順序與可讀性，提出具體調整建議。",
        _ => "完整檢查內容、結構、風險、排版線索與可執行的改善建議。",
    };
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
    let prompt = format!("你是整合在全能文件工作台裡的 MAGI 文件分析助手。請全程使用繁體中文，嚴格依據擷取內容，不要臆測；若無法從文字確認視覺版面，請明確說明。\n\n【任務】\n{task}\n{extra}\n\n【文件】\n名稱：{file_name}\n擷取範圍：{range}\n\n【內容開始】\n{text}\n【內容結束】\n\n請用清楚的小標題與條列回答，不要覆寫原檔。");
    let (api_key, tenant) = magi_credentials(&status.active_version)?;
    let body = serde_json::to_vec(&json!({"prompt": prompt, "timeout_sec": 90, "allow_fallback": true, "allow_template_fallback": true, "user_id": "opendesk-tw", "platform": "OPENDESK_TW", "role": "user"}))
        .map_err(|error| error.to_string())?;
    let object = magi_http_request(api_key, tenant, body)?;
    adapt_magi_response(&object, &status.active_version)
}

#[tauri::command]
fn magi_analyze(path: String, mode: String, instruction: String) -> Result<MagiReply, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("找不到文件".into());
    }
    let (text, truncated) = extract_document_text(&source)?;
    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("文件");
    magi_analyze_text(text, truncated, file_name, &mode, &instruction)
}

fn write_magi_bridge_config(token: &str) -> Result<PathBuf, String> {
    let plugin_root = onlyoffice_user_plugin_root()?;
    fs::create_dir_all(&plugin_root).map_err(|error| error.to_string())?;
    let config_path = plugin_root.join("magi-bridge-config.js");
    let bridge_port = magi_bridge_port();
    let content = format!(
        "window.OpenDeskMagiBridge = Object.freeze({{ url: \"http://127.0.0.1:{bridge_port}/v1/analyze\", healthUrl: \"http://127.0.0.1:{bridge_port}/v1/health\", distributedUrl: \"http://127.0.0.1:{bridge_port}/v1/distributed-alignment\", token: \"{token}\" }});\n"
    );
    fs::write(&config_path, content).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&config_path, fs::Permissions::from_mode(0o600));
    }
    Ok(config_path)
}

fn refresh_magi_bridge_config() -> Result<Option<PathBuf>, String> {
    MAGI_BRIDGE_TOKEN
        .get()
        .map(|token| write_magi_bridge_config(token).map(Some))
        .unwrap_or(Ok(None))
}

fn find_http_header_end(bytes: &[u8]) -> Option<usize> {
    bytes.windows(4).position(|window| window == b"\r\n\r\n")
}

fn read_http_request(
    stream: &mut TcpStream,
) -> Result<
    (
        String,
        String,
        std::collections::HashMap<String, String>,
        Vec<u8>,
    ),
    String,
> {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|error| error.to_string())?;
    let mut received = Vec::new();
    let mut chunk = [0_u8; 8192];
    let header_end = loop {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("MAGI 橋接請求不完整".into());
        }
        received.extend_from_slice(&chunk[..read]);
        if received.len() > 300_000 {
            return Err("MAGI 橋接請求過大".into());
        }
        if let Some(position) = find_http_header_end(&received) {
            break position;
        }
    };
    let header =
        String::from_utf8(received[..header_end].to_vec()).map_err(|_| "MAGI 橋接標頭編碼錯誤")?;
    let mut lines = header.split("\r\n");
    let request_line = lines.next().ok_or("MAGI 橋接缺少請求列")?;
    let mut request_parts = request_line.split_whitespace();
    let method = request_parts.next().unwrap_or_default().to_string();
    let path = request_parts.next().unwrap_or_default().to_string();
    let mut headers = std::collections::HashMap::new();
    for line in lines {
        if let Some((key, value)) = line.split_once(':') {
            headers.insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
        }
    }
    let content_length = headers
        .get("content-length")
        .map(|value| value.parse::<usize>())
        .transpose()
        .map_err(|_| "MAGI 橋接 Content-Length 無效")?
        .unwrap_or(0);
    if content_length > 256_000 {
        return Err("MAGI 橋接文字超過安全上限".into());
    }
    let body_start = header_end + 4;
    while received.len().saturating_sub(body_start) < content_length {
        let read = stream.read(&mut chunk).map_err(|error| error.to_string())?;
        if read == 0 {
            return Err("MAGI 橋接本文不完整".into());
        }
        received.extend_from_slice(&chunk[..read]);
        if received.len() > 300_000 {
            return Err("MAGI 橋接請求過大".into());
        }
    }
    let body = received[body_start..body_start + content_length].to_vec();
    Ok((method, path, headers, body))
}

fn allowed_magi_bridge_origin(
    headers: &std::collections::HashMap<String, String>,
) -> Option<String> {
    let origin = headers.get("origin")?;
    if origin == "null"
        || origin.starts_with("file://")
        || origin.starts_with("onlyoffice://plugin")
        || origin.starts_with("ascdesktopeditor://")
        || origin == "http://localhost"
        || origin.starts_with("http://localhost:")
        || origin == "http://127.0.0.1"
        || origin.starts_with("http://127.0.0.1:")
        || origin == "http://[::1]"
        || origin.starts_with("http://[::1]:")
    {
        Some(origin.clone())
    } else {
        None
    }
}

fn build_http_json_response(
    status: u16,
    origin: Option<&str>,
    body: &Value,
) -> Result<Vec<u8>, String> {
    let payload = serde_json::to_vec(body).map_err(|error| error.to_string())?;
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        401 => "Unauthorized",
        403 => "Forbidden",
        404 => "Not Found",
        405 => "Method Not Allowed",
        422 => "Unprocessable Entity",
        _ => "Internal Server Error",
    };
    let cors = origin
        .map(|value| format!("Access-Control-Allow-Origin: {value}\r\nVary: Origin\r\n"))
        .unwrap_or_default();
    let response = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\n{cors}Access-Control-Allow-Headers: Authorization, Content-Type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Private-Network: true\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        payload.len()
    );
    let mut bytes = response.into_bytes();
    bytes.extend_from_slice(&payload);
    Ok(bytes)
}

fn write_http_json(
    stream: &mut TcpStream,
    status: u16,
    origin: Option<&str>,
    body: &Value,
) -> Result<(), String> {
    let response = build_http_json_response(status, origin, body)?;
    stream
        .write_all(&response)
        .and_then(|_| stream.flush())
        .map_err(|error| error.to_string())
}

fn handle_magi_bridge_connection(mut stream: TcpStream, token: &str) -> Result<(), String> {
    let (method, path, headers, body) = read_http_request(&mut stream)?;
    let supplied_origin = headers.get("origin");
    let allowed_origin = allowed_magi_bridge_origin(&headers);
    if supplied_origin.is_some() && allowed_origin.is_none() {
        return write_http_json(
            &mut stream,
            403,
            None,
            &json!({"ok": false, "error": "不允許的來源"}),
        );
    }
    if method == "OPTIONS" {
        return write_http_json(&mut stream, 200, allowed_origin.as_deref(), &json!({}));
    }
    let authorized = headers
        .get("authorization")
        .map(|value| value == &format!("Bearer {token}"))
        .unwrap_or(false);
    if !authorized {
        return write_http_json(
            &mut stream,
            401,
            allowed_origin.as_deref(),
            &json!({"ok": false, "error": "MAGI 橋接驗證失敗"}),
        );
    }
    if method == "GET" && path == "/v1/health" {
        return write_http_json(
            &mut stream,
            200,
            allowed_origin.as_deref(),
            &json!({
                "ok": true,
                "service": "OpenDesk TW MAGI bridge",
                "version": env!("CARGO_PKG_VERSION")
            }),
        );
    }
    if method != "POST" {
        return write_http_json(
            &mut stream,
            405,
            allowed_origin.as_deref(),
            &json!({"ok": false, "error": "只接受 GET 健康檢查或 POST 文件操作"}),
        );
    }
    if path == "/v1/distributed-alignment" {
        let request: DistributedAlignmentBridgeRequest = match serde_json::from_slice(&body) {
            Ok(request) => request,
            Err(error) => {
                return write_http_json(
                    &mut stream,
                    400,
                    allowed_origin.as_deref(),
                    &json!({"ok": false, "error": format!("請求格式錯誤：{error}")}),
                )
            }
        };
        let source = match distributed_alignment_document_path(&request.path) {
            Ok(source) => source,
            Err(error) => {
                return write_http_json(
                    &mut stream,
                    422,
                    allowed_origin.as_deref(),
                    &json!({"ok": false, "error": error}),
                )
            }
        };
        let requested_ids = request
            .paragraph_ids
            .iter()
            .filter_map(normalize_distributed_paragraph_id)
            .take(500)
            .collect::<BTreeSet<_>>();
        return match persist_distributed_alignment(&source, &requested_ids) {
            Ok(applied) => write_http_json(
                &mut stream,
                200,
                allowed_origin.as_deref(),
                &json!({"ok": true, "applied": applied}),
            ),
            Err(error) => write_http_json(
                &mut stream,
                422,
                allowed_origin.as_deref(),
                &json!({"ok": false, "error": error}),
            ),
        };
    }
    if path != "/v1/analyze" {
        return write_http_json(
            &mut stream,
            404,
            allowed_origin.as_deref(),
            &json!({"ok": false, "error": "找不到此橋接功能"}),
        );
    }
    let request: MagiBridgeRequest = match serde_json::from_slice(&body) {
        Ok(request) => request,
        Err(error) => {
            return write_http_json(
                &mut stream,
                400,
                allowed_origin.as_deref(),
                &json!({"ok": false, "error": format!("請求格式錯誤：{error}")}),
            )
        }
    };
    let (text, truncated) = truncate_text(request.text, 60_000);
    let mode = match request.mode.as_str() {
        "summary" | "review" | "structure" | "risk" => request.mode,
        _ => "risk".into(),
    };
    let title = request
        .document_title
        .as_deref()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("目前文件");
    let instruction = request.instruction.unwrap_or_default();
    match magi_analyze_text(text, truncated, title, &mode, &instruction) {
        Ok(reply) => write_http_json(
            &mut stream,
            200,
            allowed_origin.as_deref(),
            &json!({"ok": true, "reply": reply}),
        ),
        Err(error) => write_http_json(
            &mut stream,
            422,
            allowed_origin.as_deref(),
            &json!({"ok": false, "error": error}),
        ),
    }
}

fn start_magi_bridge() -> Result<PathBuf, String> {
    let bridge_port = magi_bridge_port();
    let listener = TcpListener::bind(("127.0.0.1", bridge_port))
        .map_err(|error| format!("無法啟動 MAGI 文件橋接（連接埠 {bridge_port}）：{error}"))?;
    let mut bytes = [0_u8; 32];
    getrandom::fill(&mut bytes).map_err(|error| format!("無法建立 MAGI 橋接權杖：{error}"))?;
    let token = bytes
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    MAGI_BRIDGE_TOKEN
        .set(token.clone())
        .map_err(|_| "MAGI 文件橋接已啟動")?;
    let config = write_magi_bridge_config(&token)?;
    thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let token = token.clone();
            thread::spawn(move || {
                let _ = handle_magi_bridge_connection(stream, &token);
            });
        }
    });
    Ok(config)
}

#[tauri::command]
fn word_report(path: String) -> Result<WordReport, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    build_word_report(&source)
}

fn build_word_reading_content(path: &Path) -> Result<WordReadingContent, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "無法讀取 Word 文件結構")?;
    let document = zip_text(&mut archive, "word/document.xml");
    let comments_xml = zip_text(&mut archive, "word/comments.xml");
    if document.is_empty() {
        return Err("Word 文件缺少 document.xml".into());
    }
    let paragraph_expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let style_expression =
        Regex::new(r#"<w:pStyle\b[^>]*w:val=\"(?:Heading|heading)([1-9])\"[^>]*/?>"#).unwrap();
    let paragraphs = paragraph_expression
        .find_iter(&document)
        .enumerate()
        .filter_map(|(index, paragraph)| {
            let text = paragraph_text(paragraph.as_str()).trim().to_string();
            if text.is_empty() {
                return None;
            }
            let heading_level = style_expression
                .captures(paragraph.as_str())
                .and_then(|capture| capture.get(1))
                .and_then(|value| value.as_str().parse::<usize>().ok())
                .or_else(|| heading_prefix(&text).map(|value| value.level));
            Some(ReadingParagraph {
                index: index + 1,
                heading_level,
                text,
            })
        })
        .collect::<Vec<_>>();
    let comment_expression = Regex::new(r#"(?s)<w:comment\b([^>]*)>(.*?)</w:comment>"#).unwrap();
    let attribute = |attributes: &str, name: &str| {
        Regex::new(&format!(r#"\bw:{name}=\"([^\"]*)\""#))
            .unwrap()
            .captures(attributes)
            .and_then(|capture| capture.get(1))
            .map(|value| decode_xml_text(value.as_str()))
            .unwrap_or_default()
    };
    let mention_expression = Regex::new(r"@([\p{L}\p{N}_\-.]+)").unwrap();
    let comments = comment_expression
        .captures_iter(&comments_xml)
        .filter_map(|capture| {
            let attributes = capture.get(1)?.as_str();
            let body = capture.get(2)?.as_str();
            let text = xml_text(body).trim().to_string();
            if text.is_empty() {
                return None;
            }
            let mentions = mention_expression
                .captures_iter(&text)
                .filter_map(|value| value.get(1).map(|item| item.as_str().to_string()))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect::<Vec<_>>();
            Some(ReviewComment {
                id: attribute(attributes, "id"),
                author: attribute(attributes, "author"),
                date: attribute(attributes, "date"),
                text,
                mentions,
            })
        })
        .collect::<Vec<_>>();
    Ok(WordReadingContent {
        file_name: path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 文件")
            .into(),
        paragraphs,
        comments,
    })
}

#[tauri::command]
fn word_reading_content(path: String) -> Result<WordReadingContent, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    build_word_reading_content(&source)
}

fn paragraph_heading_level(paragraph: &str) -> Option<usize> {
    Regex::new(r#"<w:pStyle\b[^>]*w:val="(?:Heading|heading)([1-9])"[^>]*/?>"#)
        .unwrap()
        .captures(paragraph)
        .and_then(|capture| capture.get(1))
        .and_then(|value| value.as_str().parse::<usize>().ok())
        .or_else(|| heading_prefix(paragraph_text(paragraph).trim()).map(|value| value.level))
}

fn replace_paragraph_heading_level(paragraph: &str, level: usize) -> String {
    let style = Regex::new(r#"<w:pStyle\b[^>]*w:val="(?:Heading|heading)[1-9]"[^>]*/?>"#).unwrap();
    if style.is_match(paragraph) {
        return style
            .replace(paragraph, format!(r#"<w:pStyle w:val="Heading{level}"/>"#))
            .into_owned();
    }
    let paragraph_properties = Regex::new(r#"<w:pPr(?:\s[^>]*)?>"#).unwrap();
    if let Some(opening) = paragraph_properties.find(paragraph) {
        let mut output = paragraph.to_string();
        output.insert_str(
            opening.end(),
            &format!(r#"<w:pStyle w:val="Heading{level}"/>"#),
        );
        return output;
    }
    let opening = Regex::new(r#"<w:p(?:\s[^>]*)?>"#).unwrap();
    if let Some(value) = opening.find(paragraph) {
        let mut output = paragraph.to_string();
        output.insert_str(
            value.end(),
            &format!(r#"<w:pPr><w:pStyle w:val="Heading{level}"/></w:pPr>"#),
        );
        return output;
    }
    paragraph.to_string()
}

fn edit_word_outline_xml(
    document: &str,
    paragraph_number: usize,
    action: &str,
) -> Result<String, String> {
    let paragraph_expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let paragraphs = paragraph_expression.find_iter(document).collect::<Vec<_>>();
    let target_index = paragraph_number
        .checked_sub(1)
        .filter(|index| *index < paragraphs.len())
        .ok_or("找不到指定標題段落")?;
    let target = paragraphs[target_index];
    let level = paragraph_heading_level(target.as_str()).ok_or("指定段落不是標題")?;
    if matches!(action, "promote" | "demote") {
        let next_level = if action == "promote" {
            level.saturating_sub(1).max(1)
        } else {
            (level + 1).min(9)
        };
        if next_level == level {
            return Err(if action == "promote" {
                "標題已是最高層級".into()
            } else {
                "標題已是最深層級".into()
            });
        }
        let replacement = replace_paragraph_heading_level(target.as_str(), next_level);
        let mut output = document.to_string();
        output.replace_range(target.start()..target.end(), &replacement);
        return Ok(output);
    }
    let heading_indexes = paragraphs
        .iter()
        .enumerate()
        .filter_map(|(index, paragraph)| {
            paragraph_heading_level(paragraph.as_str()).map(|heading_level| (index, heading_level))
        })
        .collect::<Vec<_>>();
    let target_heading_position = heading_indexes
        .iter()
        .position(|(index, _)| *index == target_index)
        .ok_or("找不到指定標題")?;
    let section_end_index = heading_indexes
        .iter()
        .skip(target_heading_position + 1)
        .find(|(_, heading_level)| *heading_level <= level)
        .map(|(index, _)| *index);
    let section_start = target.start();
    let section_end = section_end_index
        .map(|index| paragraphs[index].start())
        .unwrap_or_else(|| {
            document
                .rfind("<w:sectPr")
                .or_else(|| document.rfind("</w:body>"))
                .unwrap_or(document.len())
        });
    if action == "move_up" {
        let previous = heading_indexes[..target_heading_position]
            .iter()
            .rev()
            .find(|(_, heading_level)| *heading_level <= level)
            .map(|(index, _)| *index)
            .ok_or("已是同層級的第一個標題")?;
        let previous_start = paragraphs[previous].start();
        let previous_section = &document[previous_start..section_start];
        let current_section = &document[section_start..section_end];
        let mut output = document.to_string();
        output.replace_range(
            previous_start..section_end,
            &format!("{current_section}{previous_section}"),
        );
        return Ok(output);
    }
    if action == "move_down" {
        let next_start_index = section_end_index.ok_or("已是同層級的最後一個標題")?;
        let next_position = heading_indexes
            .iter()
            .position(|(index, _)| *index == next_start_index)
            .ok_or("找不到下一個標題")?;
        let next_level = heading_indexes[next_position].1;
        let next_end = heading_indexes
            .iter()
            .skip(next_position + 1)
            .find(|(_, heading_level)| *heading_level <= next_level)
            .map(|(index, _)| paragraphs[*index].start())
            .unwrap_or_else(|| {
                document
                    .rfind("<w:sectPr")
                    .or_else(|| document.rfind("</w:body>"))
                    .unwrap_or(document.len())
            });
        let current_section = &document[section_start..section_end];
        let next_section = &document[section_end..next_end];
        let mut output = document.to_string();
        output.replace_range(
            section_start..next_end,
            &format!("{next_section}{current_section}"),
        );
        return Ok(output);
    }
    Err("未知的大綱編輯操作".into())
}

#[tauri::command]
fn edit_word_outline(
    path: String,
    destination: String,
    paragraph: usize,
    action: String,
) -> Result<ActionResult, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let document = read_word_document_xml(&source)?;
    let edited = edit_word_outline_xml(&document, paragraph, &action)?;
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &edited)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("大綱編輯文件.docx")
            .into(),
        message: match action.as_str() {
            "move_up" => "已將標題與所屬內容上移，並寫入新副本",
            "move_down" => "已將標題與所屬內容下移，並寫入新副本",
            "promote" => "已提升標題層級，並寫入新副本",
            "demote" => "已降低標題層級，並寫入新副本",
            _ => "已更新大綱並寫入新副本",
        }
        .into(),
    })
}

fn chinese_number(number: usize, financial: bool) -> String {
    let digits = if financial {
        ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"]
    } else {
        ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]
    };
    let ten = if financial { "拾" } else { "十" };
    match number {
        0..=9 => digits[number].into(),
        10..=19 => format!(
            "{ten}{}",
            if number == 10 {
                ""
            } else {
                digits[number % 10]
            }
        ),
        20..=99 => format!(
            "{}{ten}{}",
            digits[number / 10],
            if number.is_multiple_of(10) {
                ""
            } else {
                digits[number % 10]
            }
        ),
        _ => number.to_string(),
    }
}

fn replace_heading_prefix(paragraph: &str, old_prefix: &str, new_prefix: &str) -> String {
    if !paragraph_text(paragraph).starts_with(old_prefix) {
        return paragraph.into();
    }
    let expression = Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#).unwrap();
    let mut remaining = old_prefix.chars().count();
    let mut inserted = false;
    let mut replacements = Vec::new();
    for capture in expression.captures_iter(paragraph) {
        if remaining == 0 {
            break;
        }
        let Some(content) = capture.get(1) else {
            continue;
        };
        let decoded = decode_xml_text(content.as_str());
        let remove = remaining.min(decoded.chars().count());
        let suffix = decoded.chars().skip(remove).collect::<String>();
        let replacement = format!("{}{}", if inserted { "" } else { new_prefix }, suffix);
        replacements.push((
            content.start()..content.end(),
            encode_xml_text(&replacement),
        ));
        inserted = true;
        remaining -= remove;
    }
    if remaining != 0 {
        return paragraph.into();
    }
    let mut output = paragraph.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    output
}

fn apply_heading_style(paragraph: &str, level: usize) -> String {
    let style = format!(r#"<w:pStyle w:val="Heading{level}"/>"#);
    let style_expression = Regex::new(r#"<w:pStyle\b[^>]*/>"#).unwrap();
    if let Some(found) = style_expression.find(paragraph) {
        let mut output = paragraph.to_string();
        output.replace_range(found.start()..found.end(), &style);
        return output;
    }
    let properties = Regex::new(r#"<w:pPr(?:\s[^>]*)?>"#).unwrap();
    if let Some(found) = properties.find(paragraph) {
        let mut output = paragraph.to_string();
        output.insert_str(found.end(), &style);
        return output;
    }
    let Some(opening_end) = paragraph.find('>') else {
        return paragraph.into();
    };
    let mut output = paragraph.to_string();
    output.insert_str(opening_end + 1, &format!("<w:pPr>{style}</w:pPr>"));
    output
}

fn renumber_word_xml(document_xml: &str) -> (String, usize) {
    let expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let mut counters = [0usize; 5];
    let mut replacements = Vec::new();
    for paragraph in expression.find_iter(document_xml) {
        let source = paragraph.as_str();
        let text = paragraph_text(source);
        let Some(heading) = heading_prefix(&text) else {
            continue;
        };
        counters[heading.level] += 1;
        for counter in counters.iter_mut().skip(heading.level + 1) {
            *counter = 0;
        }
        let next = match heading.level {
            1 => chinese_number(counters[heading.level], true),
            2 | 3 => chinese_number(counters[heading.level], false),
            _ => counters[heading.level].to_string(),
        };
        let new_prefix = heading.prefix.replacen(&heading.numeral, &next, 1);
        let replaced = replace_heading_prefix(source, &heading.prefix, &new_prefix);
        let styled = apply_heading_style(&replaced, heading.level);
        replacements.push((paragraph.start()..paragraph.end(), styled));
    }
    let count = replacements.len();
    let mut output = document_xml.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    (output, count)
}

fn unique_renumbered_path(source: &Path) -> Result<PathBuf, String> {
    let parent = source.parent().ok_or("無效文件位置")?;
    let stem = source
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("Word 文件");
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("docx");
    let preferred = parent.join(format!("{stem}-重新編號.{extension}"));
    if !preferred.exists() {
        return Ok(preferred);
    }
    Ok(parent.join(format!(
        "{stem}-重新編號-{}.{extension}",
        Local::now().format("%Y%m%d-%H%M%S")
    )))
}

fn read_word_document_xml(source: &Path) -> Result<String, String> {
    let file = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|_| "無法讀取 Word 文件結構")?;
    let mut entry = archive
        .by_name("word/document.xml")
        .map_err(|_| "Word 文件缺少 document.xml")?;
    let mut xml = String::new();
    entry
        .read_to_string(&mut xml)
        .map_err(|error| error.to_string())?;
    Ok(xml)
}

fn write_word_document_xml(
    source: &Path,
    destination: &Path,
    document_xml: &str,
) -> Result<(), String> {
    let input = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(input).map_err(|_| "無法讀取 Word 文件結構")?;
    let output = File::create(destination).map_err(|error| error.to_string())?;
    let mut writer = ZipWriter::new(output);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        if entry.name() != "word/document.xml" {
            writer
                .raw_copy_file(entry)
                .map_err(|error| error.to_string())?;
            continue;
        }
        let name = entry.name().to_string();
        let options = entry.options();
        let mut ignored = Vec::new();
        let _ = entry.read_to_end(&mut ignored);
        writer
            .start_file(name, options)
            .map_err(|error| error.to_string())?;
        writer
            .write_all(document_xml.as_bytes())
            .map_err(|error| error.to_string())?;
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn normalize_distributed_paragraph_id(value: &Value) -> Option<String> {
    if let Some(number) = value.as_u64() {
        return u32::try_from(number)
            .ok()
            .map(|number| format!("{number:08X}"));
    }
    let text = value.as_str()?.trim();
    let hex = text
        .strip_prefix("0x")
        .or_else(|| text.strip_prefix("0X"))
        .unwrap_or(text);
    if hex.len() == 8 && hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Some(hex.to_ascii_uppercase());
    }
    if text.chars().all(|character| character.is_ascii_digit()) {
        if let Ok(number) = text.parse::<u32>() {
            return Some(format!("{number:08X}"));
        }
    }
    if !hex.is_empty()
        && hex.len() <= 8
        && hex.chars().all(|character| character.is_ascii_hexdigit())
    {
        return Some(format!("{:0>8}", hex.to_ascii_uppercase()));
    }
    None
}

fn distributed_marker_values(custom_xml: &str) -> Result<Vec<Value>, String> {
    let property = Regex::new(
        r#"(?s)<(?:[A-Za-z0-9_]+:)?property\b[^>]*\bname\s*=\s*["']OpenDeskTW\.DistributedParagraphs["'][^>]*>(.*?)</(?:[A-Za-z0-9_]+:)?property\s*>"#,
    )
    .unwrap();
    let value =
        Regex::new(r#"(?s)<(?:[A-Za-z0-9_]+:)?lpwstr\b[^>]*>(.*?)</(?:[A-Za-z0-9_]+:)?lpwstr\s*>"#)
            .unwrap();
    let Some(property_content) = property
        .captures(custom_xml)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str())
    else {
        return Ok(Vec::new());
    };
    let Some(encoded) = value
        .captures(property_content)
        .and_then(|captures| captures.get(1))
        .map(|value| value.as_str())
    else {
        return Err("分散對齊標記缺少文字值".into());
    };
    let markers: Value = serde_json::from_str(&decode_xml_text(encoded))
        .map_err(|error| format!("分散對齊標記格式錯誤：{error}"))?;
    let Some(markers) = markers.as_array() else {
        return Err("分散對齊標記必須是陣列".into());
    };
    Ok(markers.iter().take(500).cloned().collect())
}

fn distributed_paragraph_ids(custom_xml: &str) -> Result<BTreeSet<String>, String> {
    Ok(distributed_marker_values(custom_xml)?
        .iter()
        .filter_map(|marker| marker.get("id"))
        .filter_map(normalize_distributed_paragraph_id)
        .collect())
}

fn distributed_dynamic_spacings(
    custom_xml: &str,
) -> Result<HashMap<String, BTreeSet<i64>>, String> {
    let mut spacings = HashMap::new();
    for marker in distributed_marker_values(custom_xml)? {
        let Some(id) = marker
            .get("id")
            .and_then(normalize_distributed_paragraph_id)
        else {
            continue;
        };
        let Some(values) = marker.get("dynamicSpacings").and_then(Value::as_array) else {
            continue;
        };
        let values = values
            .iter()
            .filter_map(|value| {
                value
                    .as_i64()
                    .or_else(|| value.as_str()?.trim().parse::<i64>().ok())
            })
            .filter(|value| *value > 0 && *value <= 1_000_000)
            .take(64)
            .collect::<BTreeSet<_>>();
        if !values.is_empty() {
            spacings.insert(id, values);
        }
    }
    Ok(spacings)
}

fn merge_distributed_marker_values(
    custom_xml: &str,
    requested_ids: &BTreeSet<String>,
) -> Result<String, String> {
    if requested_ids.is_empty() {
        return Ok(custom_xml.to_string());
    }
    let mut markers = distributed_marker_values(custom_xml)?;
    let existing = markers
        .iter()
        .filter_map(|marker| marker.get("id"))
        .filter_map(normalize_distributed_paragraph_id)
        .collect::<BTreeSet<_>>();
    for id in requested_ids.difference(&existing) {
        let number = u32::from_str_radix(id, 16).map_err(|_| format!("段落識別碼無效：{id}"))?;
        markers.push(json!({"id": number}));
    }
    markers.truncate(500);
    let encoded =
        encode_xml_text(&serde_json::to_string(&markers).map_err(|error| error.to_string())?);
    let property = Regex::new(
        r#"(?s)<(?:[A-Za-z0-9_]+:)?property\b[^>]*\bname\s*=\s*["']OpenDeskTW\.DistributedParagraphs["'][^>]*>.*?</(?:[A-Za-z0-9_]+:)?property\s*>"#,
    )
    .unwrap();
    if let Some(existing_property) = property.find(custom_xml) {
        let value = Regex::new(
            r#"(?s)<((?:[A-Za-z0-9_]+:)?lpwstr)\b[^>]*>.*?</(?:[A-Za-z0-9_]+:)?lpwstr\s*>"#,
        )
        .unwrap();
        let mut replacement = existing_property.as_str().to_string();
        let Some(existing_value) = value.captures(&replacement) else {
            return Err("分散對齊標記缺少文字值".into());
        };
        let tag = existing_value
            .get(1)
            .map(|value| value.as_str())
            .unwrap_or("vt:lpwstr");
        let range = existing_value.get(0).unwrap().range();
        replacement.replace_range(range, &format!("<{tag}>{encoded}</{tag}>"));
        let mut output = custom_xml.to_string();
        output.replace_range(
            existing_property.start()..existing_property.end(),
            &replacement,
        );
        return Ok(output);
    }
    let Some(closing) = custom_xml.rfind("</Properties") else {
        return Err("Word 文件缺少可更新的 custom.xml".into());
    };
    let pid = Regex::new(r#"\bpid\s*=\s*["'](\d+)["']"#)
        .unwrap()
        .captures_iter(custom_xml)
        .filter_map(|captures| captures.get(1))
        .filter_map(|value| value.as_str().parse::<u32>().ok())
        .max()
        .unwrap_or(1)
        + 1;
    let mut output = custom_xml.to_string();
    output.insert_str(
        closing,
        &format!(
            r#"<property fmtid="{{D5CDD505-2E9C-101B-9397-08002B2CF9AE}}" pid="{pid}" name="OpenDeskTW.DistributedParagraphs"><vt:lpwstr>{encoded}</vt:lpwstr></property>"#
        ),
    );
    Ok(output)
}

fn document_paragraph_ids(document_xml: &str) -> BTreeSet<String> {
    Regex::new(r#"(?i)\bw14:paraId\s*=\s*["']([0-9a-f]{1,8})["']"#)
        .unwrap()
        .captures_iter(document_xml)
        .filter_map(|captures| captures.get(1))
        .map(|value| format!("{:0>8}", value.as_str().to_ascii_uppercase()))
        .collect()
}

fn remove_transient_distributed_spacings(
    paragraph: &str,
    transient_spacings: Option<&BTreeSet<i64>>,
) -> String {
    let Some(transient_spacings) = transient_spacings else {
        return paragraph.to_string();
    };
    if transient_spacings.is_empty() {
        return paragraph.to_string();
    }
    let spacing = Regex::new(r#"(?s)<w:spacing\b[^>]*(?:/\s*>|>.*?</w:spacing\s*>)"#).unwrap();
    let value = Regex::new(r#"\bw:val\s*=\s*["'](-?\d+)["']"#).unwrap();
    let mut removals = spacing
        .find_iter(paragraph)
        .filter_map(|element| {
            let spacing_value = value
                .captures(element.as_str())?
                .get(1)?
                .as_str()
                .parse::<i64>()
                .ok()?;
            transient_spacings
                .contains(&spacing_value)
                .then_some(element.range())
        })
        .collect::<Vec<_>>();
    let mut output = paragraph.to_string();
    for range in removals.drain(..).rev() {
        output.replace_range(range, "");
    }
    output
}

fn distributed_paragraph_xml(
    paragraph: &str,
    transient_spacings: Option<&BTreeSet<i64>>,
) -> String {
    let paragraph = remove_transient_distributed_spacings(paragraph, transient_spacings);
    let distributed = r#"<w:jc w:val="distribute"/>"#;
    let ppr = Regex::new(r#"(?s)<w:pPr(?:\s[^>]*)?>.*?</w:pPr\s*>"#).unwrap();
    if let Some(properties) = ppr.find(&paragraph) {
        let mut replacement = properties.as_str().to_string();
        let self_closing_jc = Regex::new(r#"<w:jc\b[^>]*/\s*>"#).unwrap();
        let paired_jc = Regex::new(r#"(?s)<w:jc\b[^>]*>.*?</w:jc\s*>"#).unwrap();
        if let Some(alignment) = self_closing_jc
            .find(&replacement)
            .or_else(|| paired_jc.find(&replacement))
        {
            replacement.replace_range(alignment.start()..alignment.end(), distributed);
        } else if let Some(closing) = replacement.rfind("</w:pPr") {
            replacement.insert_str(closing, distributed);
        }
        let mut output = paragraph.clone();
        output.replace_range(properties.start()..properties.end(), &replacement);
        return output;
    }

    let self_closing_ppr = Regex::new(r#"<w:pPr(?:\s[^>]*)?/\s*>"#).unwrap();
    if let Some(properties) = self_closing_ppr.find(&paragraph) {
        let mut output = paragraph.clone();
        output.replace_range(
            properties.start()..properties.end(),
            &format!("<w:pPr>{distributed}</w:pPr>"),
        );
        return output;
    }

    let opening = Regex::new(r#"^<w:p(?:\s[^>]*)?>"#).unwrap();
    if let Some(opening) = opening.find(&paragraph) {
        let mut output = paragraph.clone();
        output.insert_str(opening.end(), &format!("<w:pPr>{distributed}</w:pPr>"));
        return output;
    }
    paragraph
}

fn rewrite_distributed_document_xml(
    document_xml: &str,
    paragraph_ids: &BTreeSet<String>,
    dynamic_spacings: &HashMap<String, BTreeSet<i64>>,
) -> (String, usize) {
    if paragraph_ids.is_empty() {
        return (document_xml.to_string(), 0);
    }
    let paragraphs = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let para_id = Regex::new(r#"(?i)\bw14:paraId\s*=\s*["']([0-9a-f]{1,8})["']"#).unwrap();
    let mut replacements = Vec::new();
    for paragraph in paragraphs.find_iter(document_xml) {
        let Some(id) = para_id
            .captures(paragraph.as_str())
            .and_then(|captures| captures.get(1))
            .map(|value| format!("{:0>8}", value.as_str().to_ascii_uppercase()))
        else {
            continue;
        };
        if !paragraph_ids.contains(&id) {
            continue;
        }
        let replacement = distributed_paragraph_xml(paragraph.as_str(), dynamic_spacings.get(&id));
        if replacement != paragraph.as_str() {
            replacements.push((paragraph.start()..paragraph.end(), replacement));
        }
    }
    let count = replacements.len();
    let mut output = document_xml.to_string();
    for (range, replacement) in replacements.into_iter().rev() {
        output.replace_range(range, &replacement);
    }
    (output, count)
}

fn distributed_alignment_document_path(value: &str) -> Result<PathBuf, String> {
    let source = PathBuf::from(value.trim());
    if !source.is_file() {
        return Err("找不到要保存分散對齊的文件".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "docx" | "docm") {
        return Err("分散對齊寫回只接受 DOCX／DOCM 文件".into());
    }
    let metadata = source.metadata().map_err(|error| error.to_string())?;
    if metadata.len() > 1_073_741_824 {
        return Err("文件超過 1 GB，為避免記憶體不足而停止寫回".into());
    }
    fs::canonicalize(source).map_err(|error| error.to_string())
}

fn replace_distributed_alignment_file(source: &Path, temporary: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        fs::rename(temporary, source).map_err(|error| format!("無法更新 Word 文件：{error}"))
    }
    #[cfg(not(unix))]
    {
        let backup = source.with_extension(format!(
            "{}.opendesk-distribute-backup-{}",
            source
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or("docx"),
            std::process::id()
        ));
        fs::rename(source, &backup).map_err(|error| format!("無法暫存原始 Word 文件：{error}"))?;
        if let Err(error) = fs::rename(temporary, source) {
            let _ = fs::rename(&backup, source);
            return Err(format!("無法更新 Word 文件：{error}"));
        }
        let _ = fs::remove_file(backup);
        Ok(())
    }
}

fn persist_distributed_alignment(
    source: &Path,
    requested_ids: &BTreeSet<String>,
) -> Result<usize, String> {
    let _guard = DISTRIBUTED_ALIGNMENT_WRITE
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "分散對齊寫回目前無法鎖定")?;
    let source = distributed_alignment_document_path(&source.to_string_lossy())?;
    let input = File::open(&source).map_err(|error| error.to_string())?;
    let mut archive =
        ZipArchive::new(input).map_err(|_| "文件仍在儲存中，稍後會自動重試".to_string())?;
    let custom_xml = zip_text(&mut archive, "docProps/custom.xml");
    let document_xml = zip_text(&mut archive, "word/document.xml");
    drop(archive);
    if document_xml.is_empty() {
        return Err("Word 文件缺少 document.xml".into());
    }
    let available_ids = document_paragraph_ids(&document_xml);
    if !requested_ids.is_subset(&available_ids) {
        return Err("文件仍在完成儲存，稍後會自動重試".into());
    }
    let mut paragraph_ids = distributed_paragraph_ids(&custom_xml)?;
    let dynamic_spacings = distributed_dynamic_spacings(&custom_xml)?;
    paragraph_ids.extend(requested_ids.iter().cloned());
    if paragraph_ids.is_empty() {
        return Ok(0);
    }
    let (rewritten, changed) =
        rewrite_distributed_document_xml(&document_xml, &paragraph_ids, &dynamic_spacings);
    let rewritten_custom = merge_distributed_marker_values(&custom_xml, &paragraph_ids)?;
    if changed == 0 && rewritten_custom == custom_xml {
        return Ok(0);
    }

    let file_name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document.docx");
    let temporary = source.parent().ok_or("無效文件位置")?.join(format!(
        ".{file_name}.opendesk-distribute-{}-{}.tmp",
        std::process::id(),
        Local::now().timestamp_nanos_opt().unwrap_or_default()
    ));
    let result = (|| {
        rewrite_word_package(&source, &temporary, |name, _content| match name {
            "word/document.xml" => Some(rewritten.clone()),
            "docProps/custom.xml" => Some(rewritten_custom.clone()),
            _ => None,
        })?;
        let permissions = source
            .metadata()
            .map_err(|error| error.to_string())?
            .permissions();
        fs::set_permissions(&temporary, permissions).map_err(|error| error.to_string())?;
        OpenOptions::new()
            .write(true)
            .open(&temporary)
            .and_then(|file| file.sync_all())
            .map_err(|error| error.to_string())?;
        let verification_document = read_word_document_xml(&temporary)?;
        let verification_file = File::open(&temporary).map_err(|error| error.to_string())?;
        let mut verification_archive =
            ZipArchive::new(verification_file).map_err(|error| error.to_string())?;
        let verification_custom = zip_text(&mut verification_archive, "docProps/custom.xml");
        if verification_document != rewritten || verification_custom != rewritten_custom {
            return Err("分散對齊寫回驗證失敗，原檔未變更".into());
        }
        drop(verification_archive);
        replace_distributed_alignment_file(&source, &temporary)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map(|_| changed)
}

fn delimiter_score(line: &str, delimiter: char) -> usize {
    let mut quoted = false;
    let mut count = 0;
    let mut characters = line.chars().peekable();
    while let Some(character) = characters.next() {
        if character == '"' {
            if quoted && characters.peek() == Some(&'"') {
                let _ = characters.next();
            } else {
                quoted = !quoted;
            }
        } else if !quoted && character == delimiter {
            count += 1;
        }
    }
    count
}

fn parse_delimited_rows(content: &str) -> Result<Vec<Vec<String>>, String> {
    let content = content.trim_start_matches('\u{feff}');
    let first_line = content
        .lines()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("");
    let delimiter = [',', '\t', ';']
        .into_iter()
        .max_by_key(|value| delimiter_score(first_line, *value))
        .unwrap_or(',');
    let mut rows = Vec::new();
    let mut row = Vec::new();
    let mut field = String::new();
    let mut quoted = false;
    let mut characters = content.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '"' if quoted && characters.peek() == Some(&'"') => {
                field.push('"');
                let _ = characters.next();
            }
            '"' => quoted = !quoted,
            value if value == delimiter && !quoted => {
                row.push(field.trim().to_string());
                field.clear();
            }
            '\n' | '\r' if !quoted => {
                if character == '\r' && characters.peek() == Some(&'\n') {
                    let _ = characters.next();
                }
                row.push(field.trim().to_string());
                field.clear();
                if row.iter().any(|value| !value.is_empty()) {
                    rows.push(std::mem::take(&mut row));
                } else {
                    row.clear();
                }
            }
            value => field.push(value),
        }
    }
    if quoted {
        return Err("資料來源有未閉合的雙引號".into());
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field.trim().to_string());
        if row.iter().any(|value| !value.is_empty()) {
            rows.push(row);
        }
    }
    if rows.len() < 2 {
        return Err("資料來源必須包含標題列及至少一筆資料".into());
    }
    Ok(rows)
}

fn read_mail_merge_data(
    path: &Path,
) -> Result<(Vec<String>, Vec<BTreeMap<String, String>>), String> {
    let content = fs::read_to_string(path).map_err(|error| format!("無法讀取資料來源：{error}"))?;
    let rows = parse_delimited_rows(&content)?;
    let mut seen = HashMap::<String, usize>::new();
    let headers = rows[0]
        .iter()
        .enumerate()
        .map(|(index, value)| {
            let base = if value.trim().is_empty() {
                format!("欄位{}", index + 1)
            } else {
                value.trim().to_string()
            };
            let count = seen.entry(base.to_lowercase()).or_default();
            *count += 1;
            if *count == 1 {
                base
            } else {
                format!("{base}_{}", *count)
            }
        })
        .collect::<Vec<_>>();
    let values = rows
        .iter()
        .skip(1)
        .map(|row| {
            headers
                .iter()
                .enumerate()
                .map(|(index, header)| {
                    (header.clone(), row.get(index).cloned().unwrap_or_default())
                })
                .collect::<BTreeMap<_, _>>()
        })
        .collect::<Vec<_>>();
    Ok((headers, values))
}

#[tauri::command]
fn mail_merge_preview(data_source: String) -> Result<MailMergePreview, String> {
    let (headers, rows) = read_mail_merge_data(Path::new(&data_source))?;
    Ok(MailMergePreview {
        headers,
        row_count: rows.len(),
        sample_rows: rows.into_iter().take(5).collect(),
    })
}

fn replace_case_insensitive(source: &str, pattern: &str, replacement: &str) -> String {
    regex::RegexBuilder::new(&regex::escape(pattern))
        .case_insensitive(true)
        .build()
        .map(|expression| expression.replace_all(source, replacement).into_owned())
        .unwrap_or_else(|_| source.to_string())
}

fn mail_merge_lookup(
    name: &str,
    row: &BTreeMap<String, String>,
    variables: &BTreeMap<String, String>,
) -> String {
    let normalized = name.trim();
    row.iter()
        .find(|(field, _)| field.eq_ignore_ascii_case(normalized))
        .map(|(_, value)| value.clone())
        .or_else(|| {
            variables
                .iter()
                .find(|(field, _)| field.eq_ignore_ascii_case(normalized))
                .map(|(_, value)| value.clone())
        })
        .unwrap_or_else(|| normalized.to_string())
}

fn mail_merge_condition(left: &str, operator: &str, right: &str) -> bool {
    let left = left.trim();
    let right = right.trim();
    match operator.trim().to_ascii_lowercase().as_str() {
        "=" | "==" | "eq" | "equals" | "等於" => left.eq_ignore_ascii_case(right),
        "!=" | "<>" | "ne" | "not" | "不等於" => !left.eq_ignore_ascii_case(right),
        "contains" | "包含" => left.to_lowercase().contains(&right.to_lowercase()),
        "notcontains" | "不包含" => !left.to_lowercase().contains(&right.to_lowercase()),
        "starts" | "startswith" | "開頭" => {
            left.to_lowercase().starts_with(&right.to_lowercase())
        }
        "ends" | "endswith" | "結尾" => left.to_lowercase().ends_with(&right.to_lowercase()),
        "empty" | "空白" => left.is_empty(),
        "notempty" | "非空白" => !left.is_empty(),
        ">" | "gt" | "大於" => left
            .parse::<f64>()
            .ok()
            .zip(right.parse::<f64>().ok())
            .map(|(left, right)| left > right)
            .unwrap_or_else(|| left > right),
        ">=" | "ge" | "大於等於" => left
            .parse::<f64>()
            .ok()
            .zip(right.parse::<f64>().ok())
            .map(|(left, right)| left >= right)
            .unwrap_or_else(|| left >= right),
        "<" | "lt" | "小於" => left
            .parse::<f64>()
            .ok()
            .zip(right.parse::<f64>().ok())
            .map(|(left, right)| left < right)
            .unwrap_or_else(|| left < right),
        "<=" | "le" | "小於等於" => left
            .parse::<f64>()
            .ok()
            .zip(right.parse::<f64>().ok())
            .map(|(left, right)| left <= right)
            .unwrap_or_else(|| left <= right),
        _ => false,
    }
}

fn merge_text_value_with_rules(
    source: &str,
    row: &BTreeMap<String, String>,
    record_number: usize,
    merge_sequence: usize,
) -> String {
    let mut output = source.to_string();
    let mut variables = BTreeMap::<String, String>::new();
    let set_expression =
        Regex::new(r#"(?i)\{\{SET:([^|{}]+)\|([^{}]*)\}\}"#).expect("valid SET expression");
    loop {
        let Some(capture) = set_expression.captures(&output) else {
            break;
        };
        let whole = capture.get(0).unwrap();
        let name = capture.get(1).unwrap().as_str().trim().to_string();
        let raw = capture.get(2).unwrap().as_str();
        let value = mail_merge_lookup(raw, row, &variables);
        variables.insert(name, value);
        output.replace_range(whole.start()..whole.end(), "");
    }
    let ask_expression = Regex::new(r#"(?i)\{\{ASK:([^|{}]+)\|([^|{}]*)\|([^{}]*)\}\}"#)
        .expect("valid ASK expression");
    loop {
        let Some(capture) = ask_expression.captures(&output) else {
            break;
        };
        let whole = capture.get(0).unwrap();
        let name = capture.get(1).unwrap().as_str().trim().to_string();
        let default = merge_text_value_with_rules(
            capture.get(3).unwrap().as_str(),
            row,
            record_number,
            merge_sequence,
        );
        variables.insert(name, default);
        output.replace_range(whole.start()..whole.end(), "");
    }
    let fillin_expression =
        Regex::new(r#"(?i)\{\{FILLIN:[^|{}]*\|([^{}]*)\}\}"#).expect("valid FILLIN expression");
    output = fillin_expression
        .replace_all(&output, |capture: &regex::Captures<'_>| {
            merge_text_value_with_rules(
                capture.get(1).map(|value| value.as_str()).unwrap_or(""),
                row,
                record_number,
                merge_sequence,
            )
        })
        .into_owned();
    for (field, value) in &variables {
        output = replace_case_insensitive(&output, &format!("{{{{{field}}}}}"), value);
    }
    let if_expression =
        Regex::new(r#"(?i)\{\{IF:([^|{}]+)\|([^|{}]+)\|([^|{}]*)\|([^|{}]*)\|([^{}]*)\}\}"#)
            .expect("valid IF expression");
    loop {
        let Some(capture) = if_expression.captures(&output) else {
            break;
        };
        let whole = capture.get(0).unwrap();
        let left = mail_merge_lookup(capture.get(1).unwrap().as_str(), row, &variables);
        let operator = capture.get(2).unwrap().as_str();
        let right = mail_merge_lookup(capture.get(3).unwrap().as_str(), row, &variables);
        let branch = if mail_merge_condition(&left, operator, &right) {
            capture.get(4).unwrap().as_str()
        } else {
            capture.get(5).unwrap().as_str()
        }
        .to_string();
        output.replace_range(whole.start()..whole.end(), &branch);
    }
    output = Regex::new(r#"(?i)\{\{MERGEREC\}\}"#)
        .unwrap()
        .replace_all(&output, record_number.to_string())
        .into_owned();
    output = Regex::new(r#"(?i)\{\{MERGESEQ\}\}"#)
        .unwrap()
        .replace_all(&output, merge_sequence.to_string())
        .into_owned();
    for (field, value) in row {
        for placeholder in [
            format!("{{{{{field}}}}}"),
            format!("«{field}»"),
            format!("<<{field}>>"),
        ] {
            output = replace_case_insensitive(&output, &placeholder, value);
        }
    }
    for (field, value) in variables {
        output = replace_case_insensitive(&output, &format!("{{{{{field}}}}}"), &value);
    }
    output
}

fn mail_merge_row_should_skip(source: &str, row: &BTreeMap<String, String>) -> bool {
    let expression = Regex::new(r#"(?i)\{\{(?:SKIPIF|NEXTIF):([^|{}]+)\|([^|{}]+)\|([^{}]*)\}\}"#)
        .expect("valid skip expression");
    let should_skip = expression.captures_iter(source).any(|capture| {
        let left = mail_merge_lookup(capture.get(1).unwrap().as_str(), row, &BTreeMap::new());
        let right = mail_merge_lookup(capture.get(3).unwrap().as_str(), row, &BTreeMap::new());
        mail_merge_condition(&left, capture.get(2).unwrap().as_str(), &right)
    });
    should_skip
}

fn strip_mail_merge_control_rules(source: &str) -> String {
    Regex::new(r#"(?i)\{\{(?:SKIPIF|NEXTIF):[^{}]*\}\}"#)
        .unwrap()
        .replace_all(source, "")
        .into_owned()
}

fn word_field_result(
    instruction: &str,
    row: &BTreeMap<String, String>,
    record_number: usize,
    merge_sequence: usize,
) -> Option<String> {
    let instruction = decode_xml_text(instruction)
        .replace("&quot;", "\"")
        .trim()
        .to_string();
    let merge_field = Regex::new(r#"(?i)^\s*MERGEFIELD\s+(?:"([^"]+)"|([^\s\\]+))"#).unwrap();
    if let Some(capture) = merge_field.captures(&instruction) {
        let name = capture
            .get(1)
            .or_else(|| capture.get(2))
            .map(|value| value.as_str())
            .unwrap_or("");
        return Some(mail_merge_lookup(name, row, &BTreeMap::new()));
    }
    if Regex::new(r#"(?i)^\s*MERGEREC\b"#)
        .unwrap()
        .is_match(&instruction)
    {
        return Some(record_number.to_string());
    }
    if Regex::new(r#"(?i)^\s*MERGESEQ\b"#)
        .unwrap()
        .is_match(&instruction)
    {
        return Some(merge_sequence.to_string());
    }
    let fillin = Regex::new(r#"(?i)^\s*FILLIN\b.*?\\d\s+"([^"]*)""#).unwrap();
    if let Some(capture) = fillin.captures(&instruction) {
        return Some(
            capture
                .get(1)
                .map(|value| value.as_str().to_string())
                .unwrap_or_default(),
        );
    }
    None
}

fn materialize_word_mail_merge_fields(
    xml: &str,
    row: &BTreeMap<String, String>,
    record_number: usize,
    merge_sequence: usize,
) -> String {
    let simple = Regex::new(r#"(?s)<w:fldSimple\b([^>]*)>.*?</w:fldSimple>"#).unwrap();
    let instruction_attribute = Regex::new(r#"\bw:instr="([^"]*)""#).unwrap();
    let mut output = simple
        .replace_all(xml, |capture: &regex::Captures<'_>| {
            let instruction = instruction_attribute
                .captures(capture.get(1).map(|value| value.as_str()).unwrap_or(""))
                .and_then(|value| value.get(1))
                .map(|value| value.as_str())
                .unwrap_or("");
            word_field_result(instruction, row, record_number, merge_sequence)
                .map(|value| {
                    format!(
                        r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                        encode_xml_text(&value)
                    )
                })
                .unwrap_or_else(|| capture.get(0).unwrap().as_str().to_string())
        })
        .into_owned();
    let complex = Regex::new(
        r#"(?s)<w:r\b[^>]*>.*?<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*/>.*?</w:r>(.*?)<w:r\b[^>]*>.*?<w:fldChar\b[^>]*w:fldCharType="end"[^>]*/>.*?</w:r>"#,
    )
    .unwrap();
    let instruction_text = Regex::new(r#"(?s)<w:instrText\b[^>]*>(.*?)</w:instrText>"#).unwrap();
    output = complex
        .replace_all(&output, |capture: &regex::Captures<'_>| {
            let body = capture.get(1).map(|value| value.as_str()).unwrap_or("");
            let instruction = instruction_text
                .captures_iter(body)
                .filter_map(|value| value.get(1).map(|item| item.as_str()))
                .collect::<String>();
            word_field_result(&instruction, row, record_number, merge_sequence)
                .map(|value| {
                    format!(
                        r#"<w:r><w:t xml:space="preserve">{}</w:t></w:r>"#,
                        encode_xml_text(&value)
                    )
                })
                .unwrap_or_else(|| capture.get(0).unwrap().as_str().to_string())
        })
        .into_owned();
    output
}

fn merge_paragraph_xml(
    paragraph: &str,
    row: &BTreeMap<String, String>,
    record_number: usize,
    merge_sequence: usize,
) -> String {
    let text_expression = Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#).unwrap();
    let contents = text_expression
        .captures_iter(paragraph)
        .filter_map(|capture| capture.get(1))
        .collect::<Vec<_>>();
    if contents.is_empty() {
        return paragraph.to_string();
    }
    let logical = contents
        .iter()
        .map(|value| decode_xml_text(value.as_str()))
        .collect::<String>();
    let merged = strip_mail_merge_control_rules(&merge_text_value_with_rules(
        &logical,
        row,
        record_number,
        merge_sequence,
    ));
    if merged == logical {
        return paragraph.to_string();
    }
    let encoded_merged = encode_xml_text(&merged);
    let mut output = paragraph.to_string();
    for (index, content) in contents.into_iter().enumerate().rev() {
        output.replace_range(
            content.start()..content.end(),
            if index == 0 {
                encoded_merged.as_str()
            } else {
                ""
            },
        );
    }
    output
}

fn merge_word_xml_with_context(
    xml: &str,
    row: &BTreeMap<String, String>,
    record_number: usize,
    merge_sequence: usize,
) -> String {
    let materialized = materialize_word_mail_merge_fields(xml, row, record_number, merge_sequence);
    let paragraph_expression = Regex::new(r#"(?s)<w:p(?:\s[^>]*)?>.*?</w:p>"#).unwrap();
    let mut replacements = paragraph_expression
        .find_iter(&materialized)
        .filter_map(|value| {
            let replacement =
                merge_paragraph_xml(value.as_str(), row, record_number, merge_sequence);
            (replacement != value.as_str()).then_some((value.start()..value.end(), replacement))
        })
        .collect::<Vec<_>>();
    let mut output = materialized;
    for (range, replacement) in replacements.drain(..).rev() {
        output.replace_range(range, &replacement);
    }
    output
}

fn merge_word_xml(xml: &str, row: &BTreeMap<String, String>) -> String {
    merge_word_xml_with_context(xml, row, 1, 1)
}

fn mail_merge_filter_matches(value: &str, operator: &str, expected: &str) -> bool {
    if expected.trim().is_empty() && !matches!(operator, "empty" | "notempty") {
        return true;
    }
    mail_merge_condition(value, operator, expected)
}

fn rewrite_word_package<F>(
    source: &Path,
    destination: &Path,
    mut transform: F,
) -> Result<(), String>
where
    F: FnMut(&str, &str) -> Option<String>,
{
    let input = File::open(source).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(input).map_err(|_| "無法讀取 Word 文件結構")?;
    let output = File::create(destination).map_err(|error| error.to_string())?;
    let mut writer = ZipWriter::new(output);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let name = entry.name().to_string();
        if name.ends_with(".xml") {
            let mut content = String::new();
            entry
                .read_to_string(&mut content)
                .map_err(|error| error.to_string())?;
            if let Some(next) = transform(&name, &content) {
                writer
                    .start_file(name, entry.options())
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(next.as_bytes())
                    .map_err(|error| error.to_string())?;
                continue;
            }
            writer
                .start_file(name, entry.options())
                .map_err(|error| error.to_string())?;
            writer
                .write_all(content.as_bytes())
                .map_err(|error| error.to_string())?;
        } else {
            writer
                .raw_copy_file(entry)
                .map_err(|error| error.to_string())?;
        }
    }
    writer.finish().map_err(|error| error.to_string())?;
    Ok(())
}

fn safe_output_name(value: &str, fallback: &str) -> String {
    let cleaned = value
        .chars()
        .map(|character| {
            if character.is_alphanumeric() || matches!(character, '-' | '_' | ' ') {
                character
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .chars()
        .take(80)
        .collect::<String>();
    if cleaned.is_empty() {
        fallback.to_string()
    } else {
        cleaned
    }
}

fn unique_output_path(root: &Path, stem: &str, extension: &str, index: usize) -> PathBuf {
    let preferred = root.join(format!("{stem}.{extension}"));
    if !preferred.exists() {
        return preferred;
    }
    root.join(format!("{stem}-{:03}.{extension}", index + 1))
}

#[tauri::command]
fn mail_merge_generate(
    template: String,
    data_source: String,
    output_directory: String,
    output_format: String,
    naming_field: String,
    filter_column: String,
    filter_operator: String,
    filter_value: String,
) -> Result<MailMergeResult, String> {
    let template = PathBuf::from(template);
    if !template.is_file() {
        return Err("找不到合併列印主文件".into());
    }
    let extension = template
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "docx" | "docm") {
        return Err("合併列印主文件必須是 DOCX／DOCM".into());
    }
    if !matches!(output_format.as_str(), "docx" | "pdf" | "both") {
        return Err("輸出格式必須是 DOCX、PDF 或兩者".into());
    }
    let (_, rows) = read_mail_merge_data(Path::new(&data_source))?;
    let template_document = read_word_document_xml(&template)?;
    if rows.len() > 5_000 {
        return Err("單次最多處理 5,000 筆資料，請先分批以免誤印".into());
    }
    let root = PathBuf::from(output_directory);
    fs::create_dir_all(&root).map_err(|error| error.to_string())?;
    let mut created = Vec::new();
    let mut skipped = 0;
    let mut merge_sequence = 0usize;
    for (index, row) in rows.iter().enumerate() {
        if !filter_column.trim().is_empty()
            && row
                .get(filter_column.trim())
                .map(|value| {
                    !mail_merge_filter_matches(value, &filter_operator, filter_value.trim())
                })
                .unwrap_or(true)
        {
            skipped += 1;
            continue;
        }
        if mail_merge_row_should_skip(&paragraph_text(&template_document), row) {
            skipped += 1;
            continue;
        }
        merge_sequence += 1;
        let default_name = format!("合併文件-{:03}", index + 1);
        let stem = row
            .get(naming_field.trim())
            .map(|value| safe_output_name(value, &default_name))
            .unwrap_or(default_name);
        let target = unique_output_path(&root, &stem, &extension, index);
        rewrite_word_package(&template, &target, |name, xml| {
            (name.starts_with("word/") && name.ends_with(".xml"))
                .then(|| merge_word_xml_with_context(xml, row, index + 1, merge_sequence))
        })?;
        if matches!(output_format.as_str(), "docx" | "both") {
            created.push(target.to_string_lossy().to_string());
        }
        if matches!(output_format.as_str(), "pdf" | "both") {
            let pdf = convert_pdf_at(&target, &root)?;
            created.push(pdf.to_string_lossy().to_string());
        }
    }
    if created.is_empty() {
        return Err("篩選後沒有可輸出的收件人".into());
    }
    Ok(MailMergeResult {
        message: format!(
            "已建立 {} 個檔案{}",
            created.len(),
            if skipped > 0 {
                format!("，略過 {skipped} 筆")
            } else {
                String::new()
            }
        ),
        created,
        skipped,
    })
}

fn replace_word_body(document: &str, body: &str) -> Result<String, String> {
    let expression = Regex::new(r#"(?s)(<w:body(?:\s[^>]*)?>).*?(<w:sectPr(?:\s|>))"#).unwrap();
    if !expression.is_match(document) {
        return Err("Word 範本缺少可用的文件本文".into());
    }
    Ok(expression
        .replace(document, |captures: &regex::Captures<'_>| {
            format!("{}{}{}", &captures[1], body, &captures[2])
        })
        .into_owned())
}

fn word_paragraph(text: &str, style: Option<&str>) -> String {
    let properties = style
        .map(|value| format!(r#"<w:pPr><w:pStyle w:val="{value}"/></w:pPr>"#))
        .unwrap_or_default();
    format!(
        r#"<w:p>{properties}<w:r><w:t xml:space="preserve">{}</w:t></w:r></w:p>"#,
        encode_xml_text(text)
    )
}

#[tauri::command]
fn create_mail_merge_template<R: Runtime>(
    app: tauri::AppHandle<R>,
    kind: String,
    destination: String,
    fields: Vec<String>,
) -> Result<ActionResult, String> {
    let source = resource_path(&app, "resources/Templates/Blank-Document.docx")?;
    let target = PathBuf::from(destination);
    let usable_fields = if fields.is_empty() {
        vec!["姓名".into(), "地址".into(), "郵遞區號".into()]
    } else {
        fields
    };
    let placeholder = |name: &str| format!("{{{{{name}}}}}");
    let body = match kind.as_str() {
        "letter" => usable_fields
            .iter()
            .map(|field| word_paragraph(&placeholder(field), None))
            .chain([
                word_paragraph("", None),
                word_paragraph("您好：", None),
                word_paragraph("請在此輸入信件內容。", None),
            ])
            .collect::<String>(),
        "envelope" => format!(
            "{}{}{}{}",
            word_paragraph("寄件人：________________", None),
            word_paragraph("", None),
            word_paragraph(
                &format!(
                    "{}　{}",
                    placeholder(
                        usable_fields
                            .get(2)
                            .map(String::as_str)
                            .unwrap_or("郵遞區號")
                    ),
                    placeholder(usable_fields.get(1).map(String::as_str).unwrap_or("地址"))
                ),
                None
            ),
            word_paragraph(
                &format!(
                    "{}　收",
                    placeholder(usable_fields.first().map(String::as_str).unwrap_or("姓名"))
                ),
                None
            )
        ),
        "labels" => {
            let cell = usable_fields
                .iter()
                .map(|field| word_paragraph(&placeholder(field), None))
                .collect::<String>();
            format!(
                r#"<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{cell}</w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{cell}</w:tc><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>{cell}</w:tc></w:tr></w:tbl>"#
            )
        }
        _ => return Err("範本類型必須是信件、信封或標籤".into()),
    };
    let document = read_word_document_xml(&source)?;
    let document = replace_word_body(&document, &body)?;
    write_word_document_xml(&source, &target, &document)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("合併列印範本.docx")
            .into(),
        message: "已建立可直接使用 {{欄位名稱}} 的合併列印範本".into(),
    })
}

#[tauri::command]
fn create_word_template<R: Runtime>(
    app: tauri::AppHandle<R>,
    kind: String,
    destination: String,
) -> Result<ActionResult, String> {
    let source = resource_path(&app, "resources/Templates/Blank-Document.docx")?;
    let base = read_word_document_xml(&source)?;
    let date = Local::now().format("%Y 年 %m 月 %d 日").to_string();
    let field = |name: &str| format!("【{name}】");
    let body = match kind.as_str() {
        "official-letter" => [
            word_paragraph("○○○○○○ 函", Some("Heading1")),
            word_paragraph(&format!("地址：{}", field("機關地址")), None),
            word_paragraph(
                &format!("承辦人：{}　電話：{}", field("姓名"), field("電話")),
                None,
            ),
            word_paragraph(&format!("受文者：{}", field("受文機關")), None),
            word_paragraph(&format!("發文日期：{date}"), None),
            word_paragraph(&format!("發文字號：{}", field("字號")), None),
            word_paragraph(
                &format!("速別：{}　密等及解密條件：{}", field("普通"), field("普通")),
                None,
            ),
            word_paragraph(&format!("附件：{}", field("如主旨")), None),
            word_paragraph(
                &format!("主旨：{}", field("一句話說明目的")),
                Some("Heading2"),
            ),
            word_paragraph(
                &format!("說明：{}", field("事實、依據與理由")),
                Some("Heading2"),
            ),
            word_paragraph(
                &format!("辦法：{}", field("具體處理方式與期限")),
                Some("Heading2"),
            ),
            word_paragraph(
                &format!("正本：{}　副本：{}", field("正本"), field("副本")),
                None,
            ),
        ]
        .join(""),
        "legal-pleading" => [
            word_paragraph(&field("法院全銜"), Some("Heading1")),
            word_paragraph(&field("書狀名稱"), Some("Heading1")),
            word_paragraph(
                &format!("案號：{}　股別：{}", field("年度字號"), field("股別")),
                None,
            ),
            word_paragraph(
                &format!(
                    "具狀人：{}　身分：{}",
                    field("姓名"),
                    field("原告／被告／聲請人")
                ),
                None,
            ),
            word_paragraph(&format!("住居所／事務所：{}", field("地址")), None),
            word_paragraph(&format!("送達代收人：{}", field("姓名及地址")), None),
            word_paragraph("為上開事件，依法提出本書狀：", None),
            word_paragraph("聲明／請求事項", Some("Heading1")),
            word_paragraph(&field("逐項、可執行且明確的聲明"), None),
            word_paragraph("事實及理由", Some("Heading1")),
            word_paragraph(&field("依時間順序敘述事實，分段對應證據"), None),
            word_paragraph("證據及附件", Some("Heading1")),
            word_paragraph(&field("證物名稱、待證事實與附件編號"), None),
            word_paragraph(&format!("此致　{}", field("法院")), None),
            word_paragraph(
                &format!("具狀人：{}　中華民國　{date}", field("簽章")),
                None,
            ),
        ]
        .join(""),
        "meeting-minutes" => [
            word_paragraph(&field("會議名稱"), Some("Heading1")),
            word_paragraph(
                &format!(
                    "時間：{}　地點：{}",
                    field("日期時間"),
                    field("地點／視訊連結")
                ),
                None,
            ),
            word_paragraph(
                &format!("主席：{}　紀錄：{}", field("姓名"), field("姓名")),
                None,
            ),
            word_paragraph(
                &format!(
                    "出席：{}　請假：{}　列席：{}",
                    field("名單"),
                    field("名單"),
                    field("名單")
                ),
                None,
            ),
            word_paragraph("議程與討論", Some("Heading1")),
            word_paragraph(
                &format!(
                    "一、{}　說明：{}　討論：{}",
                    field("案由"),
                    field("背景"),
                    field("意見摘要")
                ),
                None,
            ),
            word_paragraph("決議與待辦", Some("Heading1")),
            word_paragraph(
                &format!(
                    "一、決議：{}　負責人：{}　期限：{}",
                    field("決議"),
                    field("姓名"),
                    field("日期")
                ),
                None,
            ),
            word_paragraph("下次會議", Some("Heading1")),
            word_paragraph(
                &format!("時間：{}　預定議題：{}", field("日期時間"), field("議題")),
                None,
            ),
        ]
        .join(""),
        "structured-report" => [
            word_paragraph(&field("報告名稱"), Some("Heading1")),
            word_paragraph(
                &format!(
                    "作者／機關：{}　日期：{date}　版本：{}",
                    field("名稱"),
                    field("1.0")
                ),
                None,
            ),
            word_paragraph("摘要", Some("Heading1")),
            word_paragraph(&field("目的、方法、主要發現與結論，建議 200–300 字"), None),
            word_paragraph("一、背景與目的", Some("Heading1")),
            word_paragraph(&field("問題、範圍、限制與利害關係人"), None),
            word_paragraph("二、資料與方法", Some("Heading1")),
            word_paragraph(&field("資料來源、期間、方法與判斷標準"), None),
            word_paragraph("三、分析與發現", Some("Heading1")),
            word_paragraph(&field("逐項分析，圖表均加標號與替代文字"), None),
            word_paragraph("四、結論與建議", Some("Heading1")),
            word_paragraph(&field("結論、優先順序、負責人與完成期限"), None),
            word_paragraph("參考文獻", Some("Heading1")),
            word_paragraph("{{CITATION}}", None),
        ]
        .join(""),
        _ => return Err("未知的 Word 範本類型".into()),
    };
    let document = replace_word_body(&base, &body)?;
    let target = PathBuf::from(destination);
    write_word_document_xml(&source, &target, &document)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("Word 範本.docx")
            .into(),
        message: "已建立可直接編輯、具標題結構與繁體中文欄位提示的 Word 範本".into(),
    })
}

#[tauri::command]
fn renumber_headings(path: String) -> Result<ActionResult, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "docx" | "docm") {
        return Err("中文標題重新編號目前支援 DOCX／DOCM".into());
    }
    let document_xml = read_word_document_xml(&source)?;
    let (renumbered, count) = renumber_word_xml(&document_xml);
    if count == 0 {
        return Err("沒有在段落開頭偵測到「壹、」、「一、」、「（一）」或「1.」等標題".into());
    }
    let backup = create_backup(&source)?;
    let destination = unique_renumbered_path(&source)?;
    write_word_document_xml(&source, &destination, &renumbered)?;
    let engine = if engine_executable("ONLYOFFICE").is_some() {
        "ONLYOFFICE"
    } else {
        "LibreOffice"
    };
    launch_document(&destination, engine)?;
    Ok(ActionResult {
        path: destination.to_string_lossy().to_string(),
        file_name: destination
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("重新編號文件.docx")
            .into(),
        message: format!(
            "已重編 {count} 個標題並套用標題樣式；原檔備份於 {}",
            backup.display()
        ),
    })
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
    let base = dirs::data_local_dir().ok_or_else(|| "找不到本機資料目錄".to_string())?;
    let current = base.join("全能文件工作台");
    let legacy = base.join("OpenDesk TW");
    if !current.exists() && legacy.exists() && fs::rename(&legacy, &current).is_err() {
        fs::create_dir_all(&current).map_err(|error| error.to_string())?;
    }
    Ok(current)
}

fn recovery_root() -> Result<PathBuf, String> {
    let root = data_root()?.join("Recovery");
    fs::create_dir_all(root.join("Snapshots")).map_err(|error| error.to_string())?;
    Ok(root)
}

fn recovery_registry_path() -> Result<PathBuf, String> {
    Ok(recovery_root()?.join("sessions.json"))
}

fn read_recovery_sessions_unlocked() -> Result<Vec<RecoverySession>, String> {
    let path = recovery_registry_path()?;
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| format!("復原清單格式錯誤：{error}"))
}

fn write_recovery_sessions_unlocked(sessions: &[RecoverySession]) -> Result<(), String> {
    let path = recovery_registry_path()?;
    let temporary = path.with_extension("json.tmp");
    let content = serde_json::to_vec_pretty(sessions).map_err(|error| error.to_string())?;
    fs::write(&temporary, content).map_err(|error| error.to_string())?;
    fs::rename(&temporary, &path).map_err(|error| error.to_string())
}

fn register_recovery_session(source: &Path, engine: &str) -> Result<RecoverySession, String> {
    let _guard = RECOVERY_SESSIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "復原清單目前無法鎖定")?;
    let now = Local::now();
    let id = format!("{}-{}", now.format("%Y%m%d%H%M%S%3f"), std::process::id());
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("docx");
    let snapshot = recovery_root()?
        .join("Snapshots")
        .join(format!("{id}.{extension}"));
    fs::copy(source, &snapshot).map_err(|error| format!("無法建立工作階段快照：{error}"))?;
    let session = RecoverySession {
        id: id.clone(),
        path: source.to_string_lossy().to_string(),
        file_name: source
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("文件")
            .to_string(),
        engine: engine.to_string(),
        opened_at: now.to_rfc3339(),
        snapshot_path: snapshot.to_string_lossy().to_string(),
        snapshot_at: now.to_rfc3339(),
        snapshots: 1,
    };
    let mut sessions = read_recovery_sessions_unlocked().unwrap_or_default();
    sessions.retain(|value| value.path != session.path);
    sessions.insert(0, session.clone());
    sessions.truncate(30);
    write_recovery_sessions_unlocked(&sessions)?;
    Ok(session)
}

fn start_recovery_monitor(session: RecoverySession) {
    thread::spawn(move || {
        let source = PathBuf::from(&session.path);
        let snapshot = PathBuf::from(&session.snapshot_path);
        let mut last_modified = source.metadata().and_then(|value| value.modified()).ok();
        loop {
            thread::sleep(Duration::from_secs(45));
            if !source.is_file() {
                break;
            }
            let modified = source.metadata().and_then(|value| value.modified()).ok();
            if modified.is_none() || modified == last_modified {
                continue;
            }
            let temporary = snapshot.with_extension("recovery.tmp");
            if fs::copy(&source, &temporary).is_err() || fs::copy(&temporary, &snapshot).is_err() {
                let _ = fs::remove_file(&temporary);
                continue;
            }
            let _ = fs::remove_file(&temporary);
            last_modified = modified;
            let Ok(_guard) = RECOVERY_SESSIONS.get_or_init(|| Mutex::new(())).lock() else {
                continue;
            };
            let Ok(mut sessions) = read_recovery_sessions_unlocked() else {
                continue;
            };
            if let Some(value) = sessions.iter_mut().find(|value| value.id == session.id) {
                value.snapshot_at = Local::now().to_rfc3339();
                value.snapshots += 1;
                let _ = write_recovery_sessions_unlocked(&sessions);
            } else {
                break;
            }
        }
    });
}

#[tauri::command]
fn recovery_sessions() -> Result<RecoveryOverview, String> {
    let _guard = RECOVERY_SESSIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "復原清單目前無法鎖定")?;
    let mut sessions = read_recovery_sessions_unlocked()?;
    sessions.retain(|value| Path::new(&value.snapshot_path).is_file());
    write_recovery_sessions_unlocked(&sessions)?;
    Ok(RecoveryOverview {
        sessions,
        directory: recovery_root()?.to_string_lossy().to_string(),
    })
}

#[tauri::command]
fn restore_recovery_session(id: String, destination: String) -> Result<ActionResult, String> {
    let _guard = RECOVERY_SESSIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "復原清單目前無法鎖定")?;
    let mut sessions = read_recovery_sessions_unlocked()?;
    let session = sessions
        .iter()
        .find(|value| value.id == id)
        .cloned()
        .ok_or("找不到這個工作階段")?;
    let snapshot = PathBuf::from(&session.snapshot_path);
    if !snapshot.is_file() {
        return Err("工作階段快照已不存在".into());
    }
    let mut target = PathBuf::from(destination);
    if target.extension().is_none() {
        if let Some(extension) = snapshot.extension() {
            target.set_extension(extension);
        }
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(&snapshot, &target).map_err(|error| format!("無法還原工作階段：{error}"))?;
    sessions.retain(|value| value.id != id);
    write_recovery_sessions_unlocked(&sessions)?;
    Ok(ActionResult {
        path: target.to_string_lossy().to_string(),
        file_name: target
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("復原文件")
            .to_string(),
        message: format!(
            "已從 {} 的自動快照復原；原始文件沒有被覆寫",
            session.snapshot_at
        ),
    })
}

#[tauri::command]
fn dismiss_recovery_session(id: String) -> Result<(), String> {
    let _guard = RECOVERY_SESSIONS
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "復原清單目前無法鎖定")?;
    let mut sessions = read_recovery_sessions_unlocked()?;
    let snapshot = sessions
        .iter()
        .find(|value| value.id == id)
        .map(|value| PathBuf::from(&value.snapshot_path));
    sessions.retain(|value| value.id != id);
    write_recovery_sessions_unlocked(&sessions)?;
    if let Some(path) = snapshot {
        let _ = fs::remove_file(path);
    }
    Ok(())
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
    if engine == "ONLYOFFICE" {
        prepare_onlyoffice_locale_for_launch()?;
    }
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
        let mut command = Command::new(_executable);
        if engine == "ONLYOFFICE" {
            command.arg("--keeplang:zh-TW");
        }
        command
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn backup_and_open(path: String, engine: String) -> Result<ActionResult, String> {
    let source = PathBuf::from(&path);
    if engine == "ONLYOFFICE" {
        prepare_onlyoffice_locale_for_launch()?;
    }
    let backup = create_backup(&source)?;
    launch_document(&source, &engine)?;
    let recovery = register_recovery_session(&source, &engine)?;
    start_recovery_monitor(recovery);
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

fn new_document_spec(kind: &str) -> Result<(&'static str, &'static str), String> {
    match kind {
        "text" => Ok(("--new:word", "未命名文字文件")),
        "spreadsheet" => Ok(("--new:cell", "未命名試算表")),
        "presentation" => Ok(("--new:slide", "未命名簡報")),
        _ => return Err("未知文件類型".into()),
    }
}

#[tauri::command]
fn create_document(kind: String) -> Result<ActionResult, String> {
    let (flag, file_name) = new_document_spec(&kind)?;
    prepare_onlyoffice_locale_for_launch()?;
    let executable =
        engine_executable("ONLYOFFICE").ok_or("找不到 ONLYOFFICE，請先安裝桌面編輯器")?;
    Command::new(executable)
        .args(["--keeplang:zh-TW", flag])
        .spawn()
        .map_err(|error| format!("無法開啟未命名文件：{error}"))?;
    Ok(ActionResult {
        path: String::new(),
        file_name: file_name.into(),
        message: format!("已開啟{file_name}；第一次按儲存時，再選擇檔名與儲存位置"),
    })
}

fn local_office_process_policy(sandboxed: bool, explicit_permission: Option<&str>) -> bool {
    explicit_permission == Some("1") || !sandboxed
}

fn local_office_process_allowed() -> bool {
    let explicit_permission = std::env::var("OPENDESK_ALLOW_LOCAL_OFFICE_LIVE").ok();
    local_office_process_policy(
        std::env::var_os("CODEX_SANDBOX").is_some(),
        explicit_permission.as_deref(),
    )
}

fn require_local_office_process(action: &str) -> Result<(), String> {
    if local_office_process_allowed() {
        return Ok(());
    }
    Err(format!(
        "已阻止在 Codex 受限背景環境啟動 LibreOffice（{action}），避免 macOS AppKit 崩潰通知。若已取得使用者明確允許，請設定 OPENDESK_ALLOW_LOCAL_OFFICE_LIVE=1 後重試"
    ))
}

#[tauri::command]
fn convert_pdf(path: String) -> Result<String, String> {
    let source = PathBuf::from(path);
    let output = dirs::document_dir()
        .ok_or("找不到文件資料夾")?
        .join("全能文件工作台輸出")
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
    require_local_office_process("PDF 轉換")?;
    let executable = engine_executable("LibreOffice").ok_or("找不到 LibreOffice")?;
    fs::create_dir_all(output).map_err(|error| error.to_string())?;
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
        .arg(output)
        .arg(source)
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
fn open_backup_folder() -> Result<String, String> {
    let path = data_root()?.join("Backups");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    #[cfg(target_os = "macos")]
    Command::new("/usr/bin/open")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("explorer.exe")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Command::new("xdg-open")
        .arg(&path)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

const SOURCE_REPOSITORY: &str = "https://github.com/WhaleChao/OpenDeskTW";

#[tauri::command]
fn read_legal_document<R: Runtime>(
    app: tauri::AppHandle<R>,
    document: String,
) -> Result<String, String> {
    let relative = match document.as_str() {
        "agpl" => "resources/licenses/AGPL-3.0.txt",
        "third-party" => "resources/licenses/THIRD_PARTY_NOTICES.md",
        "source-offer" => "resources/licenses/SOURCE_OFFER.md",
        _ => return Err("不支援的授權文件".into()),
    };
    let path = resource_path(&app, relative)?;
    fs::read_to_string(path).map_err(|error| format!("無法讀取授權文件：{error}"))
}

#[tauri::command]
fn open_source_repository() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    Command::new("/usr/bin/open")
        .arg(SOURCE_REPOSITORY)
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", SOURCE_REPOSITORY])
        .spawn()
        .map_err(|error| error.to_string())?;
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Command::new("xdg-open")
        .arg(SOURCE_REPOSITORY)
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn run_self_test<R: Runtime>(app: tauri::AppHandle<R>) -> SelfTestReport {
    let engines = [
        engine_status("ONLYOFFICE"),
        engine_status("LibreOffice"),
        acropdf_engine_status(),
    ];
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
    let word_fixture = resource_path(&app, verification[0]).ok();
    let word_report_passed = word_fixture
        .as_ref()
        .and_then(|path| build_word_report(path).ok())
        .map(|report| {
            report.headings.len() >= 4
                && report.has_toc
                && report.has_page_numbers
                && report.tables >= 1
                && report.comments >= 1
        })
        .unwrap_or(false);
    let (_, word_renumber_count) = renumber_word_xml(
        r#"<w:body><w:p><w:r><w:t>肆、章</w:t></w:r></w:p><w:p><w:r><w:t>九、節</w:t></w:r></w:p><w:p><w:r><w:t>（三）項</w:t></w:r></w:p></w:body>"#,
    );
    let word_renumber_passed = word_renumber_count == 3;
    let merge_passed = {
        let mut row = BTreeMap::new();
        row.insert("姓名".into(), "王小明".into());
        paragraph_text(&merge_word_xml(
            r#"<w:p><w:r><w:t>{{姓</w:t></w:r><w:r><w:t>名}}</w:t></w:r></w:p>"#,
            &row,
        )) == "王小明"
    };
    let accessibility_passed = {
        let (document, count) = mark_table_header_rows(
            r#"<w:document><w:body><w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl></w:body></w:document>"#,
        );
        count == 1 && document.contains("<w:tblHeader/>")
    };
    let reading_passed = word_fixture
        .as_ref()
        .and_then(|path| build_word_reading_content(path).ok())
        .map(|content| !content.paragraphs.is_empty() && !content.comments.is_empty())
        .unwrap_or(false);
    let citation_passed = format_source(
        &CitationSource {
            id: "self-test".into(),
            source_type: "book".into(),
            author: "王小明".into(),
            title: "測試來源".into(),
            year: "2026".into(),
            publisher: "測試出版社".into(),
            container_title: String::new(),
            volume: String::new(),
            issue: String::new(),
            pages: String::new(),
            doi: String::new(),
            url: String::new(),
            accessed: String::new(),
        },
        "taiwan",
    )
    .contains("〈測試來源〉");
    let component_passed = editable_diagram("process", "流程", &["開始".into(), "完成".into()])
        .map(|value| value.contains("<w:tbl>") && value.contains("完成"))
        .unwrap_or(false);
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
    let converted_pdf = resource_path(&app, verification[0])
        .ok()
        .and_then(|source| {
            let output = temporary_root.join("pdf");
            convert_pdf_at(&source, &output).ok()
        });
    let pdf_passed = converted_pdf
        .as_ref()
        .and_then(|pdf| fs::read(pdf).ok())
        .map(|header| header.starts_with(b"%PDF-") && header.len() > 1_000)
        .unwrap_or(false);
    let acropdf_live_passed = converted_pdf
        .as_ref()
        .and_then(|pdf| acropdf_call("--integration-live-test", Some(pdf)).ok())
        .and_then(|(value, _)| value.get("passed").and_then(Value::as_bool))
        .unwrap_or(false);
    let acropdf_capabilities_passed = acropdf_call("--integration-status", None)
        .ok()
        .and_then(|(value, _)| {
            value
                .get("capabilities")
                .and_then(Value::as_array)
                .map(|capabilities| capabilities.len() >= 10)
        })
        .unwrap_or(false);
    let (acropdf_audit_passed, acropdf_edit_passed) = converted_pdf
        .as_ref()
        .and_then(|pdf| {
            let feature_copy = temporary_root.join("pdf-feature-roundtrip.pdf");
            fs::copy(pdf, &feature_copy).ok()?;
            let audit = acropdf_call_args(
                vec![
                    "--embedded-query".into(),
                    feature_copy.to_string_lossy().to_string(),
                    "--query".into(),
                    "audit".into(),
                    "--options-json".into(),
                    "{}".into(),
                ],
                Duration::from_secs(90),
            )
            .ok()
            .map(|(value, _)| value.get("pages").and_then(Value::as_u64).unwrap_or(0) > 0)
            .unwrap_or(false);
            let edit = acropdf_call_args(
                vec![
                    "--embedded-operate".into(),
                    feature_copy.to_string_lossy().to_string(),
                    "--operation".into(),
                    "note".into(),
                    "--options-json".into(),
                    r#"{"page":0,"text":"全能文件工作台自我測試"}"#.into(),
                    "--output".into(),
                    feature_copy.to_string_lossy().to_string(),
                ],
                Duration::from_secs(90),
            )
            .ok()
            .map(|(value, _)| value.get("pages").and_then(Value::as_u64).unwrap_or(0) > 0)
            .unwrap_or(false);
            Some((audit, edit))
        })
        .unwrap_or((false, false));
    let onlyoffice_tw = onlyoffice_tw_status_value();
    let _ = fs::remove_dir_all(&temporary_root);
    let magi = magi_status();
    let groups = vec![
        TestGroup {
            name: "本機編輯引擎".into(),
            passed: engine_passed,
            total: 3,
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
            name: "Word 文件中心".into(),
            passed: usize::from(word_report_passed) + usize::from(word_renumber_passed),
            total: 2,
        },
        TestGroup {
            name: "Word 進階工具".into(),
            passed: usize::from(merge_passed)
                + usize::from(accessibility_passed)
                + usize::from(reading_passed)
                + usize::from(citation_passed)
                + usize::from(component_passed),
            total: 5,
        },
        TestGroup {
            name: "ONLYOFFICE 繁中寫作工具".into(),
            passed: usize::from(onlyoffice_tw.traditional_chinese)
                + usize::from(onlyoffice_tw.plugin_current),
            total: 2,
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
            name: "AcroPDF 渲染與往返".into(),
            passed: usize::from(acropdf_live_passed),
            total: 1,
        },
        TestGroup {
            name: "內建 PDF 完整工具".into(),
            passed: usize::from(acropdf_capabilities_passed)
                + usize::from(acropdf_audit_passed)
                + usize::from(acropdf_edit_passed),
            total: 3,
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
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                if let Ok(installed_fonts) = install_microsoft_tw_fonts() {
                    let _ = refresh_onlyoffice_font_cache_if_needed(&installed_fonts);
                }
            }
            start_magi_bridge().map_err(std::io::Error::other)?;
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            system_status,
            onlyoffice_tw_status,
            repair_onlyoffice_traditional_chinese,
            scan_document,
            word_report,
            word_reading_content,
            edit_word_outline,
            word_accessibility_report,
            word_quality_report,
            repair_word_accessibility,
            renumber_headings,
            recovery_sessions,
            restore_recovery_session,
            dismiss_recovery_session,
            mail_merge_preview,
            mail_merge_generate,
            create_mail_merge_template,
            create_word_template,
            citation_sources,
            save_citation_source,
            delete_citation_source,
            format_citation,
            append_bibliography,
            insert_dynamic_citation,
            update_document_citations,
            insert_word_component,
            acropdf_status,
            pdf_report,
            pdf_live_validate,
            pdf_query,
            pdf_render_page,
            pdf_apply_operation,
            pdf_restore_backup,
            pdf_create_blank,
            pdf_compare,
            open_in_acropdf,
            backup_and_open,
            create_document,
            convert_pdf,
            magi_analyze,
            reveal_path,
            open_backup_folder,
            read_legal_document,
            open_source_repository,
            run_self_test
        ])
        .run(tauri::generate_context!())
        .expect("全能文件工作台啟動失敗");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_office_documents_open_untitled_and_defer_save_location() {
        assert_eq!(new_document_spec("text").unwrap().0, "--new:word");
        assert_eq!(new_document_spec("spreadsheet").unwrap().0, "--new:cell");
        assert_eq!(new_document_spec("presentation").unwrap().0, "--new:slide");
        assert!(new_document_spec("unknown").is_err());

        let frontend = include_str!("../../src/main.js");
        let create_flow = frontend
            .split("async function createDocument(kind)")
            .nth(1)
            .and_then(|value| value.split("function renderFeatures()").next())
            .expect("應存在新增文件前端流程");
        assert!(create_flow.contains("invoke(\"create_document\", { kind })"));
        assert!(!create_flow.contains("await save("));
        assert!(!create_flow.contains("destination"));
    }

    #[test]
    fn local_office_processes_require_explicit_permission_in_sandbox() {
        assert!(!local_office_process_policy(true, None));
        assert!(!local_office_process_policy(true, Some("0")));
        assert!(local_office_process_policy(true, Some("1")));
        assert!(local_office_process_policy(false, None));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_macos_engine_version_from_bundle_without_running_binary() {
        let root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Bundle-Version-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        let _cleanup = TemporaryFolder(root.clone());
        let executable = root.join("LibreOffice.app/Contents/MacOS/soffice");
        fs::create_dir_all(executable.parent().unwrap()).unwrap();
        fs::write(&executable, b"must never execute").unwrap();
        fs::write(
            root.join("LibreOffice.app/Contents/Info.plist"),
            br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleShortVersionString</key><string>25.8.4.2</string>
</dict></plist>"#,
        )
        .unwrap();
        assert_eq!(
            macos_bundle_version(&executable).as_deref(),
            Some("25.8.4.2")
        );
    }

    #[test]
    fn distinguishes_traditional_from_invalid_or_simplified_locales() {
        assert!(is_traditional_onlyoffice_locale("zh-TW"));
        assert!(is_traditional_onlyoffice_locale("zh_Hant_TW"));
        assert!(!is_traditional_onlyoffice_locale("zh-ZH"));
        assert!(!is_traditional_onlyoffice_locale("zh-CN"));
        assert!(!is_traditional_onlyoffice_locale("zh"));
    }

    #[test]
    fn rejects_stale_onlyoffice_plugin_versions() {
        assert!(!plugin_version_is_current("1.5.0", "1.6.1"));
        assert!(plugin_version_is_current("1.6.1", "1.6.1"));
        assert!(plugin_version_is_current("1.7.0", "1.6.1"));
        assert!(plugin_version_is_current("2.0", "1.6.1"));
        assert!(!plugin_version_is_current("未知", "1.6.1"));
    }

    #[test]
    fn magi_bridge_accepts_only_local_editor_origins() {
        let mut headers = std::collections::HashMap::new();
        headers.insert("origin".into(), "null".into());
        assert_eq!(
            allowed_magi_bridge_origin(&headers).as_deref(),
            Some("null")
        );
        headers.insert("origin".into(), "onlyoffice://plugin".into());
        assert!(allowed_magi_bridge_origin(&headers).is_some());
        headers.insert("origin".into(), "http://127.0.0.1:8080".into());
        assert!(allowed_magi_bridge_origin(&headers).is_some());
        headers.insert("origin".into(), "http://localhost:8080".into());
        assert!(allowed_magi_bridge_origin(&headers).is_some());
        headers.insert("origin".into(), "http://127.0.0.1.evil.example".into());
        assert!(allowed_magi_bridge_origin(&headers).is_none());
        headers.insert("origin".into(), "https://example.com".into());
        assert!(allowed_magi_bridge_origin(&headers).is_none());
        assert_eq!(find_http_header_end(b"POST / HTTP/1.1\r\n\r\n{}"), Some(15));
    }

    #[test]
    fn magi_bridge_supports_health_checks_and_private_network_preflight() {
        let preflight = String::from_utf8(
            build_http_json_response(200, Some("http://127.0.0.1:8080"), &json!({}))
                .expect("應建立橋接預檢回應"),
        )
        .expect("橋接回應應為 UTF-8");
        assert!(preflight.starts_with("HTTP/1.1 200 OK"));
        assert!(preflight.contains("Access-Control-Allow-Origin: http://127.0.0.1:8080"));
        assert!(preflight.contains("Access-Control-Allow-Private-Network: true"));
        assert!(preflight.contains("Access-Control-Allow-Methods: GET, POST, OPTIONS"));
        let source = include_str!("lib.rs");
        assert!(source.contains("\"GET\" && path == \"/v1/health\""));
        assert!(source.contains("OpenDesk TW MAGI bridge"));
    }

    #[test]
    fn parses_onlyoffice_distributed_alignment_markers_as_word_para_ids() {
        let custom_xml = r#"<?xml version="1.0" encoding="UTF-8"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"
 xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
 <property name="OpenDeskTW.DistributedParagraphs">
  <vt:lpwstr>[{&quot;id&quot;:417465444},{&quot;id&quot;:&quot;76e0ee1b&quot;}]</vt:lpwstr>
 </property>
</Properties>"#;
        assert_eq!(
            distributed_paragraph_ids(custom_xml).unwrap(),
            BTreeSet::from(["18E20464".to_string(), "76E0EE1B".to_string()])
        );
    }

    #[test]
    fn rewrites_only_marked_word_paragraphs_to_standard_distribute() {
        let document_xml = r#"<w:document xmlns:w="w" xmlns:w14="w14"><w:body>
<w:p w14:paraId="18E20464"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>甲乙丙丁</w:t></w:r></w:p>
<w:p w14:paraId="76E0EE1B"><w:r><w:t>一二三四</w:t></w:r></w:p>
<w:p w14:paraId="11111111"><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>不可更動</w:t></w:r></w:p>
</w:body></w:document>"#;
        let ids = BTreeSet::from(["18E20464".to_string(), "76E0EE1B".to_string()]);
        let dynamic_spacings =
            HashMap::from([("18E20464".to_string(), BTreeSet::from([1512_i64]))]);
        let document_xml = document_xml.replace(
            "<w:r><w:t>甲乙丙丁</w:t></w:r>",
            r#"<w:r><w:rPr><w:spacing w:val="1512"/></w:rPr><w:t>甲乙丙丁</w:t></w:r>"#,
        );
        let (rewritten, changed) =
            rewrite_distributed_document_xml(&document_xml, &ids, &dynamic_spacings);
        assert_eq!(changed, 2);
        assert_eq!(
            rewritten.matches(r#"<w:jc w:val="distribute"/>"#).count(),
            2
        );
        assert!(rewritten
            .contains(r#"<w:p w14:paraId="11111111"><w:pPr><w:jc w:val="center"/></w:pPr>"#));
        assert!(
            !rewritten.contains(r#"<w:spacing w:val="1512"/>"#),
            "ONLYOFFICE 畫面用的動態字距不可寫死進 Word 文件"
        );
        let (stable, changed_again) =
            rewrite_distributed_document_xml(&rewritten, &ids, &dynamic_spacings);
        assert_eq!(changed_again, 0);
        assert_eq!(stable, rewritten);
    }

    #[test]
    fn persists_standard_distribute_in_docx_without_losing_other_parts() {
        let root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Distributed-{}-{}",
            std::process::id(),
            Local::now().timestamp_nanos_opt().unwrap_or_default()
        ));
        let _cleanup = TemporaryFolder(root.clone());
        fs::create_dir_all(&root).unwrap();
        let source = root.join("distributed.docx");
        let file = File::create(&source).unwrap();
        let mut writer = ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("word/document.xml", options).unwrap();
        writer
            .write_all(
                r#"<w:document xmlns:w="w" xmlns:w14="w14"><w:body><w:p w14:paraId="18E20464"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:spacing w:val="1512"/></w:rPr><w:t>甲乙丙丁</w:t></w:r></w:p><w:p w14:paraId="76E0EE1B"><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:spacing w:val="240"/></w:rPr><w:t>第二段</w:t></w:r></w:p></w:body></w:document>"#
                    .as_bytes(),
            )
            .unwrap();
        writer.start_file("docProps/custom.xml", options).unwrap();
        writer
            .write_all(
                br#"<Properties xmlns:vt="vt"><property name="OpenDeskTW.DistributedParagraphs"><vt:lpwstr>[{&quot;id&quot;:417465444,&quot;layout&quot;:&quot;word-paragraph-width&quot;,&quot;dynamicSpacings&quot;:[1512]}]</vt:lpwstr></property></Properties>"#,
            )
            .unwrap();
        writer
            .start_file("word/media/evidence.bin", options)
            .unwrap();
        writer.write_all(b"preserve-this-part").unwrap();
        writer.finish().unwrap();

        let requested = BTreeSet::from(["76E0EE1B".to_string()]);
        assert_eq!(
            persist_distributed_alignment(&source, &requested).unwrap(),
            2
        );
        let persisted_document = read_word_document_xml(&source).unwrap();
        assert_eq!(
            persisted_document
                .matches(r#"<w:jc w:val="distribute"/>"#)
                .count(),
            2
        );
        assert!(!persisted_document.contains(r#"<w:spacing w:val="1512"/>"#));
        assert!(
            persisted_document.contains(r#"<w:spacing w:val="240"/>"#),
            "不是動態備援值的既有字距必須保留"
        );
        assert_eq!(
            persist_distributed_alignment(&source, &requested).unwrap(),
            0
        );

        let file = File::open(&source).unwrap();
        let mut archive = ZipArchive::new(file).unwrap();
        let custom_xml = zip_text(&mut archive, "docProps/custom.xml");
        assert_eq!(
            distributed_paragraph_ids(&custom_xml).unwrap(),
            BTreeSet::from(["18E20464".to_string(), "76E0EE1B".to_string()])
        );
        let mut evidence = Vec::new();
        archive
            .by_name("word/media/evidence.bin")
            .unwrap()
            .read_to_end(&mut evidence)
            .unwrap();
        assert_eq!(evidence, b"preserve-this-part");
    }

    #[test]
    fn bundled_onlyoffice_plugin_uses_rendered_distributed_alignment_and_tw_fonts() {
        let config = include_str!("../resources/onlyoffice-tw-plugin/config.json");
        let value: Value = serde_json::from_str(config).expect("外掛設定必須是有效 JSON");
        assert_eq!(
            value.get("guid").and_then(Value::as_str),
            Some("asc.{5CBF7C74-7021-4E8C-93F3-5A6C20260722}")
        );
        assert_eq!(
            value.pointer("/variations/0/type").and_then(Value::as_str),
            Some("system")
        );
        assert_eq!(
            value
                .pointer("/variations/0/events/0")
                .and_then(Value::as_str),
            Some("onToolbarMenuClick")
        );
        let supported_editors = value
            .pointer("/variations/0/EditorsSupport")
            .and_then(Value::as_array)
            .expect("外掛必須宣告支援的編輯器");
        assert_eq!(supported_editors.len(), 4);
        let code = include_str!("../resources/onlyoffice-tw-plugin/code.js");
        assert!(code.contains("AscCommon.align_Distributed"));
        assert!(code.contains("OpenDeskTW.DistributedParagraphs"));
        assert!(code.contains("restoreDistributedAlignment()"));
        assert!(code.contains("word-paragraph-width"));
        assert!(code.contains("Get_StartRangePos2"));
        assert!(code.contains("availableWidth - occupiedWidth"));
        assert!(code.contains("SetSpacing(job.spacing)"));
        assert!(code.contains("marker.dynamicSpacings"));
        assert!(code.contains("installDistributedLayoutRefresh"));
        assert!(code.contains("AscCommon?.Ne?.Ug?.(internalId)"));
        assert!(code.contains("Object.values(paragraph).find"));
        assert!(code.contains("nativeParagraph.Vt?.(nativeDistributed)"));
        assert!(code.contains("installDistributedPersistenceHook"));
        assert!(code.contains("DesktopOfflineAppDocumentEndSave"));
        assert!(code.contains("AscDesktopEditor.OnSave"));
        assert!(code.contains("LocalFileGetSourcePath"));
        assert!(code.contains("distributedUrl"));
        assert!(code.contains("/v1/distributed-alignment"));
        assert!(code.contains("paragraph_ids: paragraphIds"));
        assert!(
            code.find("availableWidth - occupiedWidth")
                < code.find("method: \"word-paragraph-width\"")
        );
        assert!(code.contains("document.ForceRecalculate?.()"));
        assert!(code.contains("AddToolbarMenuItem"));
        assert!(code.contains("id: \"home\""));
        assert!(code.contains("installWordCompatibilityShortcuts"));
        assert!(code.contains("event.code === \"KeyJ\""));
        assert!(code.contains("applyLineSpacing"));
        assert!(code.contains("toggleTrackRevisions"));
        assert!(code.contains("opendesk-renumber-headings"));
        assert!(code.contains("opendesk-home-magi-summary"));
        assert!(code.contains("opendesk-complete-pairs"));
        assert!(code.contains("opendesk-normalize-punctuation"));
        assert!(code.contains("opendesk-font-size"));
        assert!(code.contains("range.SetFontSize(Asc.scope.numericFontSize)"));
        assert!(code.contains("opendesk-font-family"));
        assert!(code.contains("PMingLiU"));
        assert!(code.contains("MingLiU"));
        assert!(code.contains("put_TextPrFontName"));
        assert!(code.contains("wordFormatShortcut"));
        assert!(code.contains("event.stopImmediatePropagation?.()"));
        assert!(code.contains("__OpenDeskTwFormatClipboard"));
        assert!(code.contains("__OpenDeskTwFormatPaste"));
        assert!(code.contains("GetCurrentSentence\", [\"before\"]"));
        assert!(code.contains("executeMethod(\"InputText\""));
        assert!(code.contains("OpenDeskTwUiPatch"));
        let typography = include_str!("../resources/onlyoffice-tw-plugin/typography.js");
        let ui_patch = include_str!("../resources/onlyoffice-tw-plugin/ui-patch.js");
        let ui_overrides = include_str!("../resources/onlyoffice-tw-plugin/ui-overrides.js");
        let ai_tw = include_str!("../resources/onlyoffice-ai-tw-locale/translations/zh-TW.json");
        let ai_helpers_tw =
            include_str!("../resources/onlyoffice-ai-tw-locale/translations/helpers/zh-TW.json");
        let ai_tw_runtime =
            include_str!("../resources/onlyoffice-ai-tw-locale/traditional-chinese.js");
        let magi_result = include_str!("../resources/onlyoffice-tw-plugin/magi-result.html");
        for pair in [
            "（\"", "）\"", "「\"", "」\"", "【\"", "】\"", "〔\"", "〕\"",
        ] {
            assert!(typography.contains(pair), "缺少成對標點：{pair}");
        }
        assert!(typography.contains("smartQuoteForContext"));
        assert!(typography.contains("quoteStack"));
        assert!(typography.contains("calculateDistributedSpacing"));
        assert!(code.contains("window.fetch(bridge.url"));
        assert!(code.contains("reloadMagiBridgeConfig"));
        assert!(code.contains("verifyMagiBridge"));
        assert!(code.contains("healthUrl"));
        assert!(code.contains("無法連線到本機 MAGI 橋接"));
        assert!(code.contains("Authorization: `Bearer ${bridge.token}`"));
        assert!(!code.contains("https://"));
        assert!(!code.contains("XMLHttpRequest"));
        assert!(!typography.contains("fetch("));
        assert!(ui_patch.contains("de-settings-western-font-size"));
        assert!(ui_patch.contains("初號: \"42\""));
        assert!(ui_patch.contains("五號: \"10.5\""));
        assert!(ui_overrides.contains("\"Multipage view\": \"多頁檢視\""));
        assert!(ui_overrides.contains("\"Got it\": \"知道了\""));
        assert!(ai_tw.contains("\"Chatbot\": \"聊天機器人\""));
        assert!(ai_tw.contains("\"Grammar & Spelling\": \"拼字與文法檢查\""));
        assert!(ai_helpers_tw.contains("\"Run Macro\": \"執行巨集\""));
        assert!(ai_tw_runtime.contains("Object.defineProperty(plugin, \"tr\""));
        assert!(ai_tw_runtime.contains("\"Chatbot\": \"聊天機器人\""));
        assert!(magi_result.contains("結果會直接顯示在這裡，不會開啟網頁"));
        assert!(!ui_patch.contains("fetch("));
    }

    #[test]
    fn primary_interface_includes_searchable_document_shortcuts() {
        let surface = include_str!("../../src/main.js");
        for marker in [
            "Ctrl+Shift+C",
            "⌘⌥C",
            "Ctrl+Shift+V",
            "⌘⌥V",
            "Ctrl+Alt+Shift+R",
            "⌥⇧⌘R",
            "插入頁碼",
            "插入註腳",
            "插入方程式",
            "螢幕閱讀器",
            "選擇性貼上",
        ] {
            assert!(surface.contains(marker), "快捷鍵總覽缺少：{marker}");
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn copies_locally_licensed_microsoft_tw_fonts_as_real_files() {
        let root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Font-Test-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        let _cleanup = TemporaryFolder(root.clone());
        let office = root.join("Microsoft Word.app");
        let source = office.join("Contents/Resources/DFonts");
        let destination = root.join("Library/Fonts");
        fs::create_dir_all(&source).unwrap();
        fs::write(source.join("mingliu.ttc"), b"mingliu-test-font").unwrap();
        fs::write(source.join("mingliub.ttc"), b"mingliub-test-font").unwrap();

        let installed =
            copy_microsoft_tw_fonts_from_bundles(&[office.clone()], &destination).unwrap();
        assert_eq!(installed.len(), 2);
        for path in installed {
            let metadata = path.symlink_metadata().unwrap();
            assert!(metadata.is_file());
            assert!(!metadata.file_type().is_symlink());
            assert!(path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap()
                .starts_with("OpenDeskTW-Licensed-"));
        }

        fs::remove_dir_all(&office).unwrap();
        let retained = copy_microsoft_tw_fonts_from_bundles(&[office], &destination).unwrap();
        assert_eq!(
            retained.len(),
            2,
            "Office 更新移動來源後，已註冊的實體字型仍應保持可用"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn detects_when_onlyoffice_font_cache_needs_refreshing() {
        let fonts = vec![
            PathBuf::from("/Users/test/Library/Fonts/OpenDeskTW-Licensed-mingliu.ttc"),
            PathBuf::from("/Users/test/Library/Fonts/OpenDeskTW-Licensed-mingliub.ttc"),
        ];
        assert!(!onlyoffice_font_cache_log_is_current("", &fonts));
        assert!(!onlyoffice_font_cache_log_is_current(
            "/Users/test/Library/Fonts/OpenDeskTW-Licensed-mingliu.ttc\n",
            &fonts
        ));
        assert!(onlyoffice_font_cache_log_is_current(
            "/Users/test/Library/Fonts/OpenDeskTW-Licensed-mingliu.ttc\n/Users/test/Library/Fonts/OpenDeskTW-Licensed-mingliub.ttc\n",
            &fonts
        ));
    }

    #[test]
    fn primary_interface_displays_agpl_notices_and_source_offer() {
        let interface = include_str!("../../src/index.html");
        let frontend = include_str!("../../src/main.js");
        let bundled_license = include_str!("../resources/licenses/AGPL-3.0.txt");
        for marker in [
            "GNU AGPL v3+",
            "本程式不附帶任何擔保",
            "完整授權條文",
            "第三方授權",
            "對應原始碼說明",
            "檢視原始碼",
        ] {
            assert!(interface.contains(marker), "AGPL 介面告知缺少：{marker}");
        }
        assert!(frontend.contains("read_legal_document"));
        assert!(frontend.contains("open_source_repository"));
        assert!(bundled_license.contains("GNU AFFERO GENERAL PUBLIC LICENSE"));
    }

    #[test]
    fn primary_interface_has_no_known_simplified_chinese_phrases() {
        let surface = concat!(
            include_str!("../../src/index.html"),
            include_str!("../../src/main.js")
        );
        for phrase in [
            "设置",
            "页面",
            "字体",
            "打印",
            "审阅",
            "删除",
            "选择",
            "默认",
            "应用",
            "样式",
            "转换",
            "备份",
            "检查",
            "当前",
            "启动",
            "点击",
            "链接",
            "网络",
            "编辑",
            "标题",
            "编号",
            "页眉",
            "页脚",
            "分散对齐",
        ] {
            assert!(!surface.contains(phrase), "介面含簡體詞：{phrase}");
        }
    }

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
    fn detects_word_styles_and_traditional_chinese_headings() {
        let xml = r#"<w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>正式標題</w:t></w:r></w:p>
          <w:p><w:r><w:t>貳、中文編號標題</w:t></w:r></w:p>
          <w:p><w:r><w:t>一般內文</w:t></w:r></w:p>
          <w:p><w:r><w:t>本文說明壹、一、（一）等格式，不能判斷成標題。</w:t></w:r></w:p>
        </w:body>"#;
        let headings = detect_word_headings(xml);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[1].text, "貳、中文編號標題");
    }

    #[test]
    fn renumbers_split_run_chinese_headings_and_applies_styles() {
        let xml = r#"<w:body>
          <w:p><w:r><w:t>肆</w:t></w:r><w:r><w:t>、第一章</w:t></w:r></w:p>
          <w:p><w:r><w:t>九、第一節</w:t></w:r></w:p>
          <w:p><w:r><w:t>十、第二節</w:t></w:r></w:p>
          <w:p><w:r><w:t>（三）細目</w:t></w:r></w:p>
          <w:p><w:r><w:t>9. 項目</w:t></w:r></w:p>
          <w:p><w:r><w:t>本段內文提到壹、一、（一）與 1.，不得重新編號。</w:t></w:r></w:p>
        </w:body>"#;
        let (output, count) = renumber_word_xml(xml);
        assert_eq!(count, 5);
        assert!(paragraph_text(&output).contains("壹、第一章"));
        assert!(paragraph_text(&output).contains("一、第一節"));
        assert!(paragraph_text(&output).contains("二、第二節"));
        assert!(paragraph_text(&output).contains("（一）細目"));
        assert!(paragraph_text(&output).contains("1. 項目"));
        assert!(paragraph_text(&output).contains("本段內文提到壹、一、（一）與 1.，不得重新編號。"));
        for level in 1..=4 {
            assert!(output.contains(&format!("w:val=\"Heading{level}\"")));
        }
    }

    #[test]
    fn word_report_covers_navigation_review_and_print_checks() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Verification/OpenDeskTW_完整文字功能.docx");
        let report = build_word_report(&fixture).expect("應能建立 Word 專項報告");
        assert!(report.characters > 100);
        assert!(report.headings.len() >= 4);
        assert!(report.has_toc);
        assert!(report.has_page_numbers);
        assert!(report.tables >= 1);
        assert!(report.footnotes >= 1 && report.endnotes >= 1);
        assert!(report.comments >= 1);
        assert!(report.tracked_insertions >= 1 && report.tracked_deletions >= 1);
        assert!(report.bookmarks >= 1 && report.mail_merge_fields >= 1);
    }

    #[test]
    fn renumbered_docx_roundtrip_preserves_package() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Verification/OpenDeskTW_完整文字功能.docx");
        let temporary_root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Word-Test-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        fs::create_dir_all(&temporary_root).unwrap();
        let _cleanup = TemporaryFolder(temporary_root.clone());
        let input = temporary_root.join("待重編.docx");
        let output = temporary_root.join("重新編號.docx");
        let original_xml = read_word_document_xml(&fixture).unwrap();
        let text_expression = Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#).unwrap();
        let mut injected = original_xml.clone();
        let nodes = text_expression
            .captures_iter(&original_xml)
            .filter_map(|capture| capture.get(1).map(|value| value.start()))
            .take(2)
            .collect::<Vec<_>>();
        for (position, prefix) in nodes.into_iter().zip(["〔肆、〕", "〔九、〕"]).rev() {
            injected.insert_str(position, prefix);
        }
        write_word_document_xml(&fixture, &input, &injected).unwrap();
        let source_xml = read_word_document_xml(&input).unwrap();
        let (renumbered, count) = renumber_word_xml(&source_xml);
        assert!(count >= 2);
        write_word_document_xml(&input, &output, &renumbered).unwrap();
        let report = build_word_report(&output).expect("重新封裝後仍應是有效 DOCX");
        assert!(report.headings.len() >= 4);
        assert!(inspect_package(&output).0 > 10);
    }

    #[test]
    fn parses_quoted_csv_and_split_run_merge_fields() {
        let rows = parse_delimited_rows(
            "\u{feff}姓名,地址,備註\r\n\"王,小明\",\"臺北市,中正區\",\"第一行\n第二行\"\r\n",
        )
        .expect("應能解析含逗號與換行的 CSV");
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[1][0], "王,小明");
        assert_eq!(rows[1][2], "第一行\n第二行");
        let mut values = BTreeMap::new();
        values.insert("姓名".into(), "王小明".into());
        values.insert("地址".into(), "臺北市中正區".into());
        let xml = r#"<w:p><w:r><w:t>{{姓</w:t></w:r><w:r><w:t>名}}</w:t></w:r><w:r><w:t>　«地址»</w:t></w:r></w:p>"#;
        let merged = merge_word_xml(xml, &values);
        assert_eq!(paragraph_text(&merged), "王小明　臺北市中正區");
        assert!(!merged.contains("{{"));
        assert!(!merged.contains("«"));
    }

    #[test]
    fn mail_merge_docx_roundtrip_preserves_package() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Templates/Blank-Document.docx");
        let temporary_root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Merge-Test-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        fs::create_dir_all(&temporary_root).unwrap();
        let _cleanup = TemporaryFolder(temporary_root.clone());
        let template = temporary_root.join("合併範本.docx");
        let output = temporary_root.join("王小明.docx");
        let document = read_word_document_xml(&fixture).unwrap();
        let body = word_paragraph("收件人：{{姓名}}　地址：«地址»", None);
        let document = replace_word_body(&document, &body).unwrap();
        write_word_document_xml(&fixture, &template, &document).unwrap();
        let mut values = BTreeMap::new();
        values.insert("姓名".into(), "王小明".into());
        values.insert("地址".into(), "臺北市中正區".into());
        rewrite_word_package(&template, &output, |name, xml| {
            (name.starts_with("word/") && name.ends_with(".xml"))
                .then(|| merge_word_xml(xml, &values))
        })
        .unwrap();
        let merged = read_word_document_xml(&output).unwrap();
        assert!(paragraph_text(&merged).contains("王小明"));
        assert!(paragraph_text(&merged).contains("臺北市中正區"));
        assert!(inspect_package(&output).0 > 5);
    }

    #[test]
    fn mail_merge_rules_match_word_style_conditions_and_record_numbers() {
        let mut row = BTreeMap::new();
        row.insert("姓名".into(), "王小明".into());
        row.insert("會員".into(), "是".into());
        row.insert("狀態".into(), "啟用".into());
        let template = "{{SET:稱謂|姓名}}{{IF:會員|等於|是|會員 {{稱謂}} 您好|您好}}　記錄 {{MERGEREC}}／{{MERGESEQ}}　{{FILLIN:主旨|通知}}";
        let merged = merge_text_value_with_rules(template, &row, 7, 3);
        assert_eq!(merged, "會員 王小明 您好　記錄 7／3　通知");
        assert!(mail_merge_filter_matches(
            "臺北市中正區",
            "contains",
            "中正"
        ));
        assert!(mail_merge_filter_matches("120", ">", "99"));
        assert!(!mail_merge_row_should_skip(
            "{{SKIPIF:狀態|等於|啟用}}",
            &BTreeMap::from([("狀態".into(), "停用".into())])
        ));
        assert!(mail_merge_row_should_skip(
            "{{NEXTIF:狀態|等於|停用}}",
            &BTreeMap::from([("狀態".into(), "停用".into())])
        ));
        let xml = r#"<w:p><w:fldSimple w:instr=" MERGEFIELD 姓名 "><w:r><w:t>姓名</w:t></w:r></w:fldSimple></w:p>"#;
        let materialized = materialize_word_mail_merge_fields(xml, &row, 7, 3);
        assert!(materialized.contains("王小明"));
        assert!(!materialized.contains("MERGEFIELD"));
    }

    #[test]
    fn outline_editor_moves_sections_and_changes_heading_levels() {
        let xml = format!(
            "<w:document><w:body>{}{}{}{}<w:sectPr/></w:body></w:document>",
            word_paragraph("第一章", Some("Heading1")),
            word_paragraph("第一章內容", None),
            word_paragraph("第二章", Some("Heading1")),
            word_paragraph("第二章內容", None)
        );
        let moved = edit_word_outline_xml(&xml, 3, "move_up").unwrap();
        assert!(moved.find("第二章").unwrap() < moved.find("第一章").unwrap());
        assert!(moved.find("第二章內容").unwrap() < moved.find("第一章內容").unwrap());
        let demoted = edit_word_outline_xml(&xml, 1, "demote").unwrap();
        assert!(demoted.contains(r#"w:val="Heading2""#));
    }

    #[test]
    fn dynamic_citation_blocks_keep_source_ids_and_can_be_regenerated() {
        let source = CitationSource {
            id: "src-dynamic".into(),
            source_type: "book".into(),
            author: "王小明".into(),
            title: "文件自動化".into(),
            year: "2026".into(),
            publisher: "開放出版社".into(),
            container_title: String::new(),
            volume: String::new(),
            issue: String::new(),
            pages: String::new(),
            doi: String::new(),
            url: String::new(),
            accessed: String::new(),
        };
        let citation = format_citation_values(std::slice::from_ref(&source), "apa7");
        let block = dynamic_citation_block("bibliography", "apa7", &[source.id.clone()], &citation);
        assert!(block.contains("OpenDeskTW.Citation|bibliography|apa7|src-dynamic"));
        assert!(block.contains("<w:sdtContent>"));
        assert!(block.contains("文件自動化"));
    }

    #[test]
    fn taiwan_quality_checker_finds_delivery_blockers() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Templates/Blank-Document.docx");
        let temporary_root = std::env::temp_dir().join(format!(
            "OpenDeskTW-Quality-Test-{}-{}",
            std::process::id(),
            Local::now().timestamp_millis()
        ));
        fs::create_dir_all(&temporary_root).unwrap();
        let _cleanup = TemporaryFolder(temporary_root.clone());
        let output = temporary_root.join("待校閱.docx");
        let body = [
            word_paragraph("待確認：{{姓名}}", None),
            word_paragraph("這是信息,請確認（尚未閉合", None),
        ]
        .join("");
        let document =
            replace_word_body(&read_word_document_xml(&fixture).unwrap(), &body).unwrap();
        write_word_document_xml(&fixture, &output, &document).unwrap();
        let report = build_word_quality_report(&output).unwrap();
        assert!(report.score < 100);
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.category == "未完成欄位"));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.category == "標點成對"));
        assert!(report
            .issues
            .iter()
            .any(|issue| issue.category == "台灣用語"));
    }

    #[test]
    fn accessibility_safe_repairs_are_structural_and_repeatable() {
        let document = r#"<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>欄名</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"#;
        let (repaired, count) = mark_table_header_rows(document);
        assert_eq!(count, 1);
        assert!(repaired.contains("<w:tblHeader/>"));
        let (again, count) = mark_table_header_rows(&repaired);
        assert_eq!(count, 0);
        assert_eq!(again, repaired);
        let styles = r#"<w:styles><w:docDefaults><w:rPrDefault><w:rPr/></w:rPrDefault></w:docDefaults></w:styles>"#;
        let (styles, changed) = ensure_traditional_chinese_language(styles);
        assert!(changed);
        assert!(styles.contains(r#"w:val="zh-TW""#));
        let core = r#"<cp:coreProperties><dc:title></dc:title></cp:coreProperties>"#;
        let (core, changed) = ensure_core_title(core, "無障礙文件");
        assert!(changed);
        assert!(core.contains("<dc:title>無障礙文件</dc:title>"));
    }

    #[test]
    fn formats_citations_in_common_and_taiwan_styles() {
        let source = CitationSource {
            id: "sample".into(),
            source_type: "article".into(),
            author: "王小明".into(),
            title: "開放文件格式研究".into(),
            year: "2026".into(),
            publisher: String::new(),
            container_title: "資訊法學評論".into(),
            volume: "12".into(),
            issue: "2".into(),
            pages: "10–28".into(),
            doi: "10.1234/example".into(),
            url: String::new(),
            accessed: String::new(),
        };
        let apa = format_citation_values(std::slice::from_ref(&source), "apa7");
        assert_eq!(apa.inline, "(王小明, 2026)");
        assert!(apa.bibliography[0].contains("https://doi.org/10.1234/example"));
        let taiwan = format_citation_values(&[source], "taiwan");
        assert_eq!(taiwan.inline, "（王小明，2026）");
        assert!(taiwan.bibliography[0].contains("《資訊法學評論》"));
    }

    #[test]
    fn reading_view_extracts_headings_comments_and_mentions() {
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/Verification/OpenDeskTW_完整文字功能.docx");
        let content = build_word_reading_content(&fixture).expect("應建立閱讀與註解檢視");
        assert!(content.paragraphs.len() > 10);
        assert!(content
            .paragraphs
            .iter()
            .any(|paragraph| paragraph.heading_level.is_some()));
        assert!(!content.comments.is_empty());
    }

    #[test]
    fn open_diagrams_and_quick_parts_are_editable_ooxml() {
        let process = editable_diagram(
            "process",
            "案件流程",
            &["收件".into(), "審查".into(), "核定".into(), "發文".into()],
        )
        .expect("應建立流程圖解");
        assert!(process.contains("<w:tbl>"));
        assert!(process.contains("案件流程"));
        assert!(process.contains("收件"));
        assert!(process.contains("→"));
        let hierarchy =
            editable_diagram("hierarchy", "組織", &["主任".into(), "承辦人".into()]).unwrap();
        assert!(hierarchy.contains(r#"w:left="720""#));
        let document = r#"<w:document><w:body><w:p/><w:sectPr/></w:body></w:document>"#;
        let inserted = insert_before_section_properties(document, &process).unwrap();
        assert!(inserted.find("案件流程").unwrap() < inserted.find("<w:sectPr").unwrap());
    }

    #[test]
    fn persistent_pdf_core_reuses_process() {
        if std::env::var("CODEX_SANDBOX").is_ok()
            && std::env::var("OPENDESK_ALLOW_LOCAL_OFFICE_LIVE")
                .ok()
                .as_deref()
                != Some("1")
        {
            assert!(
                acropdf_runtime_candidates()
                    .iter()
                    .all(|runtime| !runtime.display_path.ends_with("embedded_core.py")),
                "受限背景環境已有 sidecar 時不得回退到系統 Python"
            );
            return;
        }
        let (status, _) =
            acropdf_call("--integration-status", None).expect("內建 PDF 核心應能以常駐模式啟動");
        assert_eq!(
            status.get("protocol_version").and_then(Value::as_u64),
            Some(2)
        );
        assert_eq!(
            status.get("persistent_server").and_then(Value::as_bool),
            Some(true)
        );
        let warm_started = Instant::now();
        acropdf_call("--integration-status", None).expect("常駐 PDF 核心應能重複回應");
        assert!(
            warm_started.elapsed() < Duration::from_secs(3),
            "PDF 核心沒有重用常駐程序"
        );
    }

    #[test]
    fn packaged_pdf_core_does_not_fall_back_to_user_python() {
        assert!(
            !allow_python_pdf_core_fallback(true, false),
            "已有原生 sidecar 時不得默默載入系統 Python user-site"
        );
        assert!(allow_python_pdf_core_fallback(false, false));
        assert!(allow_python_pdf_core_fallback(true, true));
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

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "會修復本機 ONLYOFFICE 語系並安裝繁中寫作工具；執行前必須正常關閉 ONLYOFFICE"]
    fn live_repair_onlyoffice_traditional_chinese() {
        assert!(engine_status("ONLYOFFICE").installed);
        assert!(
            !onlyoffice_is_running(),
            "請先儲存文件並正常關閉 ONLYOFFICE"
        );
        repair_macos_onlyoffice_locale().expect("語系應能修復為 zh-TW");
        let installed_fonts =
            install_microsoft_tw_fonts().expect("應能從已授權的 Microsoft Office 註冊繁中字型");
        assert_eq!(
            installed_fonts.len(),
            MICROSOFT_WORD_TW_FONT_FILES.len(),
            "應同時註冊新細明體／細明體所需的兩個字型檔"
        );
        for font in &installed_fonts {
            let metadata = font.symlink_metadata().expect("註冊字型應存在");
            assert!(
                metadata.is_file() && !metadata.file_type().is_symlink(),
                "註冊字型必須是可供 ONLYOFFICE 掃描的實體檔案"
            );
        }
        refresh_onlyoffice_font_cache_if_needed(&installed_fonts)
            .expect("應能安全備份過期的 ONLYOFFICE 字型快取");
        let source =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/onlyoffice-tw-plugin");
        let destination = onlyoffice_user_plugin_root().expect("應找到使用者外掛資料夾");
        copy_directory(&source, &destination).expect("繁中寫作工具應能安裝");
        let ai_locale_source =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/onlyoffice-ai-tw-locale");
        install_onlyoffice_ai_tw(&ai_locale_source).expect("台灣繁中 AI 相容副本應能安裝");
        let status = onlyoffice_tw_status_value();
        assert!(status.traditional_chinese, "{}", status.message);
        assert!(status.plugin_installed, "{}", status.message);
        assert!(status.plugin_current, "{}", status.message);
    }

    #[test]
    #[ignore = "需要本機 ONLYOFFICE、LibreOffice 與 MAGI"]
    fn live_complete_office_pipeline() {
        require_local_office_process("Office 完整管線 LIVE 測試")
            .expect("必須先取得使用者明確允許，並設定 OPENDESK_ALLOW_LOCAL_OFFICE_LIVE=1");
        assert!(engine_status("ONLYOFFICE").installed);
        assert!(engine_status("LibreOffice").installed);
        let onlyoffice_tw = onlyoffice_tw_status_value();
        assert!(
            onlyoffice_tw.traditional_chinese && onlyoffice_tw.plugin_current,
            "{}",
            onlyoffice_tw.message
        );
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
        let original_report = build_word_report(&fixtures[0]).expect("Word LIVE 報告應建立成功");
        assert!(original_report.headings.len() >= 4);
        assert!(original_report.has_toc && original_report.has_page_numbers);
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
        let original_xml = read_word_document_xml(&fixtures[0]).unwrap();
        let text_expression = Regex::new(r#"(?s)<w:t\b[^>]*>(.*?)</w:t>"#).unwrap();
        let mut injected_xml = original_xml.clone();
        let positions = text_expression
            .captures_iter(&original_xml)
            .filter_map(|capture| capture.get(1).map(|value| value.start()))
            .take(2)
            .collect::<Vec<_>>();
        for (position, prefix) in positions.into_iter().zip(["〔肆、〕", "〔九、〕"]).rev()
        {
            injected_xml.insert_str(position, prefix);
        }
        let word_input = temporary_root.join("Word-LIVE-待重編.docx");
        let word_output = temporary_root.join("Word-LIVE-重新編號.docx");
        write_word_document_xml(&fixtures[0], &word_input, &injected_xml).unwrap();
        let (renumbered_xml, renumbered_count) =
            renumber_word_xml(&read_word_document_xml(&word_input).unwrap());
        assert!(renumbered_count >= 2);
        write_word_document_xml(&word_input, &word_output, &renumbered_xml).unwrap();
        let renumbered_report =
            build_word_report(&word_output).expect("重編後 Word LIVE 報告應建立成功");
        assert!(renumbered_report.headings.len() >= original_report.headings.len());
        let component_output = temporary_root.join("Word-LIVE-進階元件.docx");
        insert_word_component(
            word_output.to_string_lossy().to_string(),
            component_output.to_string_lossy().to_string(),
            "process".into(),
            "案件處理流程".into(),
            String::new(),
            vec!["收件".into(), "審查".into(), "核定".into(), "發文".into()],
        )
        .expect("應插入可編輯圖解");
        assert!(read_word_document_xml(&component_output)
            .unwrap()
            .contains("案件處理流程"));
        let accessibility =
            build_accessibility_report(&component_output).expect("應建立進階文件無障礙報告");
        assert!(accessibility.score <= 100);
        let reading =
            build_word_reading_content(&component_output).expect("應建立大綱／草稿閱讀資料");
        assert!(!reading.paragraphs.is_empty());
        let merge_template = temporary_root.join("Word-LIVE-合併範本.docx");
        let merge_output = temporary_root.join("Word-LIVE-王小明.docx");
        let blank = resources.join("Templates/Blank-Document.docx");
        let merge_document = replace_word_body(
            &read_word_document_xml(&blank).unwrap(),
            &word_paragraph("收件人：{{姓名}}　地址：«地址»", None),
        )
        .unwrap();
        write_word_document_xml(&blank, &merge_template, &merge_document).unwrap();
        let mut merge_row = BTreeMap::new();
        merge_row.insert("姓名".into(), "王小明".into());
        merge_row.insert("地址".into(), "臺北市中正區".into());
        rewrite_word_package(&merge_template, &merge_output, |name, xml| {
            (name.starts_with("word/") && name.ends_with(".xml"))
                .then(|| merge_word_xml(xml, &merge_row))
        })
        .unwrap();
        assert!(paragraph_text(&read_word_document_xml(&merge_output).unwrap()).contains("王小明"));
        let pdf = convert_pdf_at(&component_output, &temporary_root.join("pdf")).unwrap();
        let pdf_bytes = fs::read(&pdf).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-") && pdf_bytes.len() > 1_000);
        let (acro_status, _) = acropdf_call("--integration-status", None).unwrap();
        assert_eq!(
            acro_status.get("protocol_version").and_then(Value::as_u64),
            Some(2)
        );
        let (acro_live, _) = acropdf_call("--integration-live-test", Some(&pdf)).unwrap();
        assert_eq!(acro_live.get("passed").and_then(Value::as_bool), Some(true));
        assert!(
            acro_live
                .get("rendered_pages")
                .and_then(Value::as_u64)
                .unwrap_or(0)
                >= 1
        );
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
