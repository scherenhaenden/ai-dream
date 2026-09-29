#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

const PORT: u16 = 17865;
const HOST: &str = "127.0.0.1";

struct ApiProcess(Mutex<Child>);

fn start_api(app: &tauri::AppHandle) -> Result<Child, String> {
    let python = std::env::var_os("AI_DREAM_PYTHON").unwrap_or_else(|| "python3".into());
    let bundled_python = app
        .path()
        .resource_dir()
        .ok()
        .map(|path| path.join("python"))
        .filter(|path| path.join("aidream").is_dir());
    let source_root = std::env::current_dir().ok().filter(|path| path.join("aidream/__main__.py").is_file());
    let import_root = bundled_python.or(source_root);
    let mut command = Command::new(python);
    if let Some(root) = import_root {
        let mut paths = vec![root];
        if let Some(existing) = std::env::var_os("PYTHONPATH") {
            paths.extend(std::env::split_paths(&existing));
        }
        command.env("PYTHONPATH", std::env::join_paths(paths).map_err(|error| error.to_string())?);
    }
    command
        .args(["-m", "aidream", "web", "--port"])
        .arg(PORT.to_string())
        .arg("--no-open")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start the AI Dream Python service: {error}"))
}

fn wait_for_api(child: &mut Child) -> Result<(), String> {
    let address: SocketAddr = format!("{HOST}:{PORT}").parse().expect("valid loopback address");
    let deadline = Instant::now() + Duration::from_secs(20);
    while Instant::now() < deadline {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("Could not check the AI Dream service: {error}"))?
        {
            return Err(format!("The AI Dream service exited during startup ({status})."));
        }
        if let Ok(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(250)) {
            let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
            let request = format!("GET /api/health HTTP/1.1\r\nHost: {HOST}:{PORT}\r\nConnection: close\r\n\r\n");
            if stream.write_all(request.as_bytes()).is_ok() {
                let mut response = [0_u8; 12];
                if let Ok(count) = stream.read(&mut response) {
                    if response[..count].starts_with(b"HTTP/1.1 200") {
                        return Ok(());
                    }
                }
            }
        }
        thread::sleep(Duration::from_millis(200));
    }
    Err(format!("AI Dream did not become ready at http://{HOST}:{PORT} within 20 seconds."))
}

fn stop_api(app: &tauri::AppHandle) {
    if let Some(process) = app.try_state::<ApiProcess>() {
        if let Ok(mut child) = process.0.lock() {
            #[cfg(unix)]
            unsafe {
                libc::kill(child.id() as libc::pid_t, libc::SIGTERM);
            }
            #[cfg(not(unix))]
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let mut child = start_api(app.handle()).map_err(std::io::Error::other)?;
            if let Err(error) = wait_for_api(&mut child) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(std::io::Error::other(error).into());
            }
            let url = format!("http://{HOST}:{PORT}/");
            let window = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::External(url.parse().expect("valid local URL")),
            )
            .title("AI Dream")
            .inner_size(1440.0, 900.0)
            .min_inner_size(960.0, 640.0)
            .build();
            if let Err(error) = window {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error.into());
            }
            app.manage(ApiProcess(Mutex::new(child)));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build AI Dream desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                stop_api(app);
            }
        });
}
