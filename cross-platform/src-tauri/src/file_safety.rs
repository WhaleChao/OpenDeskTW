// SPDX-License-Identifier: AGPL-3.0-or-later
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
#[cfg(any(windows, test))]
use std::path::PathBuf;

pub fn unique_id() -> io::Result<String> {
    let mut bytes = [0_u8; 16];
    getrandom::fill(&mut bytes).map_err(|error| io::Error::other(error.to_string()))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

#[cfg(windows)]
pub fn replace_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = temporary.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    if source[..source.len() - 1].contains(&0) || target[..target.len() - 1].contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "檔案路徑包含無效字元",
        ));
    }
    // Same-volume replacement; never remove the original before committing.
    if unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), 1 | 8) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn replace_file(temporary: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(temporary, destination)
}

pub fn publish(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("無效輸出位置"))?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".opendesk-{}.tmp", unique_id()?));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        write(&mut file)?;
        file.sync_all()?;
        drop(file);
        if path.is_file() {
            fs::set_permissions(&temporary, path.metadata()?.permissions())?;
        }
        replace_file(&temporary, path)?;
        #[cfg(unix)]
        {
            // Some network filesystems do not support directory fsync.
            if let Ok(directory) = File::open(parent) {
                let _ = directory.sync_all();
            }
        }
        Ok(())
    })();
    if temporary.exists() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> io::Result<()> {
    publish(path, |file| file.write_all(bytes))
}

pub fn atomic_copy(source: &Path, destination: &Path) -> io::Result<()> {
    let mut input = File::open(source)?;
    publish(destination, |file| io::copy(&mut input, file).map(|_| ()))
}

pub fn private_directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    #[cfg(windows)]
    {
        use std::collections::HashMap;
        use std::sync::{Mutex, OnceLock};
        use std::time::SystemTime;
        static SECURED: OnceLock<Mutex<HashMap<PathBuf, SystemTime>>> = OnceLock::new();
        let created = path.metadata()?.created()?;
        let mut secured = SECURED
            .get_or_init(|| Mutex::new(HashMap::new()))
            .lock()
            .map_err(|_| io::Error::other("無法鎖定備份權限設定"))?;
        if secured.get(path) == Some(&created) {
            return Ok(());
        }
        let script = "$ErrorActionPreference='Stop'; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; $acl=New-Object System.Security.AccessControl.DirectorySecurity; $acl.SetSecurityDescriptorSddlForm(('D:P(A;OICI;FA;;;'+$sid+')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)')); Set-Acl -LiteralPath $env:OPENDESK_PRIVATE_DIRECTORY -AclObject $acl";
        let output = crate::quiet_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("OPENDESK_PRIVATE_DIRECTORY", path)
            .env_remove("PSModulePath")
            .output()?;
        if !output.status.success() {
            return Err(io::Error::other("無法設定 Windows 備份資料夾私有權限"));
        }
        secured.insert(path.to_path_buf(), created);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let path = std::env::temp_dir().join(format!("opendesk-safety-{}", unique_id().unwrap()));
        fs::create_dir_all(&path).unwrap();
        path
    }
    #[test]
    fn replaces_existing_registry_repeatedly() {
        let root = root();
        let file = root.join("sessions.json");
        atomic_write(&file, b"old").unwrap();
        atomic_write(&file, b"new").unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"new");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_copy_preserves_destination() {
        let root = root();
        let file = root.join("document.pdf");
        fs::write(&file, b"original").unwrap();
        assert!(atomic_copy(&root.join("missing"), &file).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn partial_writer_failure_preserves_original_and_cleans_up() {
        let root = root();
        let file = root.join("document.pdf");
        fs::write(&file, b"original").unwrap();
        let result = publish(&file, |stream| {
            stream.write_all(b"partial")?;
            Err(io::Error::other("disk failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&file).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test]
    fn windows_private_backup_acl_blocks_other_users() {
        let root = root();
        private_directory(&root).unwrap();
        let script = "$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath $env:OPENDESK_ACL_TEST; $sids=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }); $user=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; @{protected=$acl.AreAccessRulesProtected;sids=$sids;user=$user} | ConvertTo-Json -Compress";
        let output = crate::quiet_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("OPENDESK_ACL_TEST", &root)
            .env_remove("PSModulePath")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert_eq!(value["protected"], true);
        let user = value["user"].as_str().unwrap();
        let sids = value["sids"].as_array().unwrap();
        assert!(sids.iter().all(
            |sid| matches!(sid.as_str(), Some("S-1-5-18" | "S-1-5-32-544"))
                || sid.as_str() == Some(user)
        ));
        assert!(sids.iter().any(|sid| sid.as_str() == Some(user)));
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn preserves_document_mode_and_secures_backup_directory() {
        use std::os::unix::fs::PermissionsExt;
        let root = root();
        private_directory(&root).unwrap();
        assert_eq!(root.metadata().unwrap().permissions().mode() & 0o777, 0o700);
        let file = root.join("private.pdf");
        fs::write(&file, b"old").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o640)).unwrap();
        atomic_write(&file, b"new").unwrap();
        assert_eq!(file.metadata().unwrap().permissions().mode() & 0o777, 0o640);
        fs::remove_dir_all(root).unwrap();
    }
}
