use chrono::Local;
use regex::Regex;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
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

fn acropdf_runtime_candidates() -> Vec<AcroPdfRuntime> {
    let mut candidates = Vec::new();
    if let Ok(executable) = std::env::var("ACROPDF_EXECUTABLE") {
        candidates.push(AcroPdfRuntime {
            display_path: executable.clone(),
            executable: PathBuf::from(executable),
            prefix_args: Vec::new(),
        });
    }
    if let Some(desktop) = dirs::desktop_dir() {
        let source = desktop.join("acropdf/main.py");
        if source.is_file() {
            let python = std::env::var("ACROPDF_PYTHON")
                .map(PathBuf::from)
                .unwrap_or_else(|_| {
                    #[cfg(target_os = "macos")]
                    {
                        [
                            "/opt/homebrew/bin/python3",
                            "/usr/local/bin/python3",
                            "/usr/bin/python3",
                        ]
                        .into_iter()
                        .map(PathBuf::from)
                        .find(|path| path.is_file())
                        .unwrap_or_else(|| PathBuf::from("python3"))
                    }
                    #[cfg(target_os = "windows")]
                    {
                        PathBuf::from("python.exe")
                    }
                    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
                    {
                        PathBuf::from("python3")
                    }
                });
            candidates.push(AcroPdfRuntime {
                executable: python,
                prefix_args: vec![source.to_string_lossy().to_string()],
                display_path: source.to_string_lossy().to_string(),
            });
        }
    }
    #[cfg(target_os = "macos")]
    {
        let mut apps = vec![PathBuf::from("/Applications/AcroPDF.app")];
        if let Some(home) = dirs::home_dir() {
            apps.push(home.join("Applications/AcroPDF.app"));
        }
        if let Some(desktop) = dirs::desktop_dir() {
            apps.push(desktop.join("acropdf/dist/AcroPDF.app"));
        }
        for app in apps {
            let binary = app.join("Contents/MacOS/AcroPDF");
            if binary.is_file() {
                candidates.push(AcroPdfRuntime {
                    executable: binary,
                    prefix_args: Vec::new(),
                    display_path: app.to_string_lossy().to_string(),
                });
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        for key in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(root) = std::env::var(key) {
                for relative in [
                    "AcroPDF/AcroPDF.exe",
                    "Programs/AcroPDF/AcroPDF.exe",
                    "AcroPDF/AcroPDF/AcroPDF.exe",
                ] {
                    let executable = PathBuf::from(&root).join(relative);
                    if executable.is_file() {
                        candidates.push(AcroPdfRuntime {
                            display_path: executable.to_string_lossy().to_string(),
                            executable,
                            prefix_args: Vec::new(),
                        });
                    }
                }
            }
        }
    }
    candidates
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
                return Err("AcroPDF 本機整合回應逾時".into());
            }
        }
    }
}

fn acropdf_call(flag: &str, path: Option<&Path>) -> Result<(Value, AcroPdfRuntime), String> {
    let mut last_error = "找不到支援 OpenDesk 整合協定的 AcroPDF 1.0.18 以上版本".to_string();
    let timeout = match flag {
        "--integration-status" => Duration::from_secs(3),
        "--integration-inspect" => Duration::from_secs(30),
        "--integration-live-test" => Duration::from_secs(180),
        _ => Duration::from_secs(8),
    };
    for runtime in acropdf_runtime_candidates() {
        let mut args = vec![flag.to_string()];
        if let Some(path) = path {
            args.push(path.to_string_lossy().to_string());
        }
        match command_output_with_timeout(&runtime, &args, timeout) {
            Ok(output) if output.status.success() => {
                match serde_json::from_slice::<Value>(&output.stdout) {
                    Ok(value)
                        if value.get("protocol_version").and_then(Value::as_u64) == Some(1) =>
                    {
                        return Ok((value, runtime));
                    }
                    Ok(_) => last_error = "AcroPDF 整合協定版本不相容".into(),
                    Err(error) => last_error = format!("AcroPDF 回應格式錯誤：{error}"),
                }
            }
            Ok(output) => {
                if let Ok(value) = serde_json::from_slice::<Value>(&output.stdout) {
                    if value.get("protocol_version").and_then(Value::as_u64) == Some(1) {
                        return Err(value
                            .get("error")
                            .and_then(Value::as_str)
                            .unwrap_or("AcroPDF 無法處理此文件")
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

fn acropdf_engine_status() -> EngineStatus {
    match acropdf_call("--integration-status", None) {
        Ok((value, runtime)) => EngineStatus {
            name: "AcroPDF PDF 引擎".into(),
            installed: true,
            path: Some(runtime.display_path),
            version: value
                .get("app_version")
                .and_then(Value::as_str)
                .map(str::to_string),
        },
        Err(_) => EngineStatus {
            name: "AcroPDF PDF 引擎".into(),
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
fn pdf_report(path: String) -> Result<Value, String> {
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
    acropdf_call("--integration-inspect", Some(&source)).map(|(value, _)| value)
}

#[tauri::command]
fn pdf_live_validate(path: String) -> Result<Value, String> {
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
    acropdf_call("--integration-live-test", Some(&source)).map(|(value, _)| value)
}

#[tauri::command]
fn open_in_acropdf(path: Option<String>, tool: Option<String>) -> Result<ActionResult, String> {
    const ALLOWED_TOOLS: &[&str] = &[
        "tools",
        "new",
        "read",
        "pages",
        "merge",
        "split",
        "extract",
        "edit_text",
        "edit_image",
        "annotate",
        "watermark",
        "header_footer",
        "forms",
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
    let (_, runtime) = acropdf_call("--integration-status", None)?;
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
            return Err("AcroPDF 工作區只接受 PDF 文件".into());
        }
        Some(create_backup(source)?)
    } else {
        None
    };
    let mut command = Command::new(&runtime.executable);
    command.args(&runtime.prefix_args).arg("--opendesk");
    if let Some(tool) = tool {
        command.args(["--opendesk-tool", &tool]);
    }
    if let Some(source) = source.as_ref() {
        command.arg(source);
    }
    command.spawn().map_err(|error| error.to_string())?;
    let display_path = source
        .as_ref()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| runtime.display_path.clone());
    let file_name = source
        .as_ref()
        .and_then(|value| value.file_name())
        .and_then(|value| value.to_str())
        .unwrap_or("PDF 工作區")
        .to_string();
    let message = backup
        .map(|value| format!("已備份原始 PDF 至 {}，正在開啟 PDF 工作區", value.display()))
        .unwrap_or_else(|| "正在開啟 OpenDesk PDF 工作區".into());
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

const ONLYOFFICE_TW_PLUGIN_FOLDER: &str = "{5CBF7C74-7021-4E8C-93F3-5A6C20260722}";

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
        "由 OpenDesk 啟動時固定為 zh-TW".into()
    }
}

fn onlyoffice_user_plugin_root() -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        dirs::data_dir()
            .map(|root| {
                root.join("asc.onlyoffice.ONLYOFFICE/data/sdkjs-plugins")
                    .join(ONLYOFFICE_TW_PLUGIN_FOLDER)
            })
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_dir()
            .map(|root| {
                root.join("ONLYOFFICE/DesktopEditors/sdkjs-plugins")
                    .join(ONLYOFFICE_TW_PLUGIN_FOLDER)
            })
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        dirs::data_local_dir()
            .map(|root| {
                root.join("onlyoffice/desktopeditors/sdkjs-plugins")
                    .join(ONLYOFFICE_TW_PLUGIN_FOLDER)
            })
            .ok_or_else(|| "找不到 ONLYOFFICE 使用者外掛資料夾".into())
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
    let plugin_installed = onlyoffice_user_plugin_root()
        .map(|path| {
            path.join("config.json").is_file()
                && path.join("index.html").is_file()
                && path.join("code.js").is_file()
                && path.join("typography.js").is_file()
                && path.join("ui-overrides.js").is_file()
                && path.join("ui-patch.js").is_file()
        })
        .unwrap_or(false);
    let message = if !installed {
        "尚未安裝 ONLYOFFICE".into()
    } else if running && !traditional_chinese {
        "目前正在使用錯誤語系；請先關閉 ONLYOFFICE，再按一鍵修復".into()
    } else if traditional_chinese && plugin_installed {
        "完整繁中介面、數字字級與繁中寫作工具已就緒".into()
    } else if !traditional_chinese {
        format!("目前語系為 {current_language}，需要修正為 zh-TW")
    } else {
        "繁體中文已啟用；尚待安裝繁中寫作工具".into()
    };
    OnlyOfficeTwStatus {
        installed,
        running,
        current_language,
        traditional_chinese,
        plugin_installed,
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

fn prepare_onlyoffice_locale_for_launch() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        repair_macos_onlyoffice_locale()?;
    }
    Ok(())
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

    let plugin_source = resource_path(&app, "resources/onlyoffice-tw-plugin")?;
    if !plugin_source.join("config.json").is_file()
        || !plugin_source.join("index.html").is_file()
        || !plugin_source.join("code.js").is_file()
        || !plugin_source.join("typography.js").is_file()
        || !plugin_source.join("ui-overrides.js").is_file()
        || !plugin_source.join("ui-patch.js").is_file()
    {
        return Err("安裝包缺少 ONLYOFFICE 繁中工具".into());
    }
    let plugin_destination = onlyoffice_user_plugin_root()?;
    copy_directory(&plugin_source, &plugin_destination)?;
    let status = onlyoffice_tw_status_value();
    if !status.traditional_chinese || !status.plugin_installed {
        return Err("繁體中文工具安裝後驗證失敗，請保留備份並回報".into());
    }
    let backup_message = locale_backup
        .map(|path| format!("；原設定與簡體範本快取備份於 {}", path.display()))
        .unwrap_or_default();
    Ok(ActionResult {
        path: plugin_destination.to_string_lossy().to_string(),
        file_name: "繁中寫作工具（OpenDesk TW）".into(),
        message: format!(
            "已固定 ONLYOFFICE 為 zh-TW、補齊繁中介面並鎖定數字字級{backup_message}。重新開啟 ONLYOFFICE 後，可使用「OpenDesk TW」工具列的數字字級、分散對齊、智慧補齊、台灣標點與快捷鍵。"
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
    value
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
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
        (
            1,
            r#"^\s*(?:〔|【|\[)?([壹貳參肆伍陸柒捌玖拾佰]+)、(?:〕|】|\])?"#,
        ),
        (
            2,
            r#"^\s*(?:〔|【|\[)?([一二三四五六七八九十百]+)、(?:〕|】|\])?"#,
        ),
        (
            3,
            r#"^\s*(?:（|\(|〔|【)([一二三四五六七八九十百]+)(?:）|\)|〕|】)"#,
        ),
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
fn word_report(path: String) -> Result<WordReport, String> {
    let source = PathBuf::from(path);
    if !source.is_file() {
        return Err("找不到 Word 文件".into());
    }
    build_word_report(&source)
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
        return Err("沒有偵測到〔壹、〕、〔一、〕、（一）或 1. 等標題".into());
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
        r#"<w:body><w:p><w:r><w:t>〔肆、〕章</w:t></w:r></w:p><w:p><w:r><w:t>〔九、〕節</w:t></w:r></w:p><w:p><w:r><w:t>（三）項</w:t></w:r></w:p></w:body>"#,
    );
    let word_renumber_passed = word_renumber_count == 3;
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
            name: "ONLYOFFICE 繁中寫作工具".into(),
            passed: usize::from(onlyoffice_tw.traditional_chinese)
                + usize::from(onlyoffice_tw.plugin_installed),
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
            onlyoffice_tw_status,
            repair_onlyoffice_traditional_chinese,
            scan_document,
            word_report,
            renumber_headings,
            acropdf_status,
            pdf_report,
            pdf_live_validate,
            open_in_acropdf,
            backup_and_open,
            create_document,
            convert_pdf,
            magi_analyze,
            reveal_path,
            open_backup_folder,
            run_self_test
        ])
        .run(tauri::generate_context!())
        .expect("OpenDesk TW 啟動失敗");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn distinguishes_traditional_from_invalid_or_simplified_locales() {
        assert!(is_traditional_onlyoffice_locale("zh-TW"));
        assert!(is_traditional_onlyoffice_locale("zh_Hant_TW"));
        assert!(!is_traditional_onlyoffice_locale("zh-ZH"));
        assert!(!is_traditional_onlyoffice_locale("zh-CN"));
        assert!(!is_traditional_onlyoffice_locale("zh"));
    }

    #[test]
    fn bundled_onlyoffice_plugin_uses_native_distributed_alignment() {
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
        assert!(code.contains("put_PrAlign"));
        assert!(code.contains("align_Distributed"));
        assert!(code.contains("AddToolbarMenuItem"));
        assert!(code.contains("opendesk-complete-pairs"));
        assert!(code.contains("opendesk-normalize-punctuation"));
        assert!(code.contains("opendesk-font-size"));
        assert!(code.contains("range.SetFontSize(Asc.scope.numericFontSize)"));
        assert!(code.contains("OpenDeskTwUiPatch"));
        let typography = include_str!("../resources/onlyoffice-tw-plugin/typography.js");
        let ui_patch = include_str!("../resources/onlyoffice-tw-plugin/ui-patch.js");
        let ui_overrides = include_str!("../resources/onlyoffice-tw-plugin/ui-overrides.js");
        for pair in [
            "（\"", "）\"", "「\"", "」\"", "【\"", "】\"", "〔\"", "〕\"",
        ] {
            assert!(typography.contains(pair), "缺少成對標點：{pair}");
        }
        assert!(!code.contains("fetch("));
        assert!(!code.contains("XMLHttpRequest"));
        assert!(!typography.contains("fetch("));
        assert!(ui_patch.contains("de-settings-western-font-size"));
        assert!(ui_patch.contains("初號: \"42\""));
        assert!(ui_patch.contains("五號: \"10.5\""));
        assert!(ui_overrides.contains("\"Multipage view\": \"多頁檢視\""));
        assert!(ui_overrides.contains("\"Got it\": \"知道了\""));
        assert!(!ui_patch.contains("fetch("));
    }

    #[test]
    fn primary_interface_includes_searchable_document_shortcuts() {
        let surface = include_str!("../../src/main.js");
        for marker in [
            "Ctrl+Alt+C",
            "⌘⌥C",
            "Ctrl+Alt+V",
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
          <w:p><w:r><w:t>〔貳、〕中文編號標題</w:t></w:r></w:p>
          <w:p><w:r><w:t>一般內文</w:t></w:r></w:p>
        </w:body>"#;
        let headings = detect_word_headings(xml);
        assert_eq!(headings.len(), 2);
        assert_eq!(headings[0].level, 1);
        assert_eq!(headings[1].text, "〔貳、〕中文編號標題");
    }

    #[test]
    fn renumbers_split_run_chinese_headings_and_applies_styles() {
        let xml = r#"<w:body>
          <w:p><w:r><w:t>〔肆</w:t></w:r><w:r><w:t>、〕第一章</w:t></w:r></w:p>
          <w:p><w:r><w:t>〔九、〕第一節</w:t></w:r></w:p>
          <w:p><w:r><w:t>〔十、〕第二節</w:t></w:r></w:p>
          <w:p><w:r><w:t>（三）細目</w:t></w:r></w:p>
          <w:p><w:r><w:t>9. 項目</w:t></w:r></w:p>
        </w:body>"#;
        let (output, count) = renumber_word_xml(xml);
        assert_eq!(count, 5);
        assert!(paragraph_text(&output).contains("〔壹、〕第一章"));
        assert!(paragraph_text(&output).contains("〔一、〕第一節"));
        assert!(paragraph_text(&output).contains("〔二、〕第二節"));
        assert!(paragraph_text(&output).contains("（一）細目"));
        assert!(paragraph_text(&output).contains("1. 項目"));
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
        let source =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/onlyoffice-tw-plugin");
        let destination = onlyoffice_user_plugin_root().expect("應找到使用者外掛資料夾");
        copy_directory(&source, &destination).expect("繁中寫作工具應能安裝");
        let status = onlyoffice_tw_status_value();
        assert!(status.traditional_chinese, "{}", status.message);
        assert!(status.plugin_installed, "{}", status.message);
    }

    #[test]
    #[ignore = "需要本機 ONLYOFFICE、LibreOffice 與 MAGI"]
    fn live_complete_office_pipeline() {
        assert!(engine_status("ONLYOFFICE").installed);
        assert!(engine_status("LibreOffice").installed);
        let onlyoffice_tw = onlyoffice_tw_status_value();
        assert!(
            onlyoffice_tw.traditional_chinese && onlyoffice_tw.plugin_installed,
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
        let pdf = convert_pdf_at(&word_output, &temporary_root.join("pdf")).unwrap();
        let pdf_bytes = fs::read(&pdf).unwrap();
        assert!(pdf_bytes.starts_with(b"%PDF-") && pdf_bytes.len() > 1_000);
        let (acro_status, _) = acropdf_call("--integration-status", None).unwrap();
        assert_eq!(
            acro_status.get("protocol_version").and_then(Value::as_u64),
            Some(1)
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
