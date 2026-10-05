#![cfg_attr(
    all(not(debug_assertions), target_os = "windows"),
    windows_subsystem = "windows"
)]

fn main() {
    let mut args = std::env::args().skip(1);
    if args.next().as_deref() == Some("--verify-install") {
        let result = args
            .next()
            .ok_or("缺少驗證目錄".to_string())
            .and_then(|path| {
                document_workbench_tw_lib::verify_install(std::path::Path::new(&path))
            });
        match result {
            Ok(value) => println!("{value}"),
            Err(error) => {
                eprintln!("驗證失敗：{error}");
                std::process::exit(1);
            }
        }
        return;
    }
    document_workbench_tw_lib::run()
}
