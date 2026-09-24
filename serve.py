#!/usr/bin/env python3
"""GameScorePad: operator + hall live scoreboard."""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
import time
import traceback
import urllib.parse
import webbrowser
from email import policy
from email.parser import BytesParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = int(os.environ.get("PORT", "3878"))
PROFILE_DISPLAY = Path(os.environ.get("TEMP") or os.environ.get("TMP") or ".") / "gamescorepad-hall"
BG_DIR = ROOT / "bg"
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}

_lock = threading.Lock()
_state = {
    "display_monitor": None,
    "display_proc": None,
    "monitors": [],
    "tournament": None,
    "hall_reload": 0,
}


def log(msg: str) -> None:
    try:
        sys.stderr.write(msg + "\n")
        sys.stderr.flush()
    except Exception:
        pass


def _command_to_exe(cmd: str) -> str | None:
    cmd = (cmd or "").strip()
    if not cmd:
        return None
    if cmd.startswith('"'):
        end = cmd.find('"', 1)
        if end > 1:
            return cmd[1:end]
    return cmd.split()[0]


def default_browser_exe() -> str | None:
    if sys.platform != "win32":
        return None
    try:
        import winreg

        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice",
        ) as key:
            progid, _ = winreg.QueryValueEx(key, "ProgId")
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, rf"{progid}\shell\open\command") as key:
            cmd, _ = winreg.QueryValueEx(key, None)
        exe = _command_to_exe(str(cmd))
        if exe and Path(exe).is_file():
            return exe
    except OSError:
        return None
    return None


def find_browser() -> str | None:
    exe = default_browser_exe()
    if exe:
        return exe
    env = os.environ
    local = Path(env.get("LOCALAPPDATA", ""))
    pf = Path(env.get("PROGRAMFILES", r"C:\Program Files"))
    pf86 = Path(env.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"))
    names = [
        pf / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        pf86 / "Microsoft" / "Edge" / "Application" / "msedge.exe",
        pf / "Google" / "Chrome" / "Application" / "chrome.exe",
        pf86 / "Google" / "Chrome" / "Application" / "chrome.exe",
        local / "Google" / "Chrome" / "Application" / "chrome.exe",
    ]
    for p in names:
        if p and p.is_file():
            return str(p)
    for name in ("msedge", "chrome", "chrome.exe", "msedge.exe"):
        found = shutil.which(name)
        if found:
            return found
    return None


def is_chromium(browser: str) -> bool:
    name = Path(browser).name.lower()
    blob = Path(browser).as_posix().lower()
    return name in {
        "chrome.exe",
        "msedge.exe",
        "browser.exe",
        "brave.exe",
        "opera.exe",
        "vivaldi.exe",
    } or "chrome" in blob or "msedge" in blob or "yandex" in blob or "brave" in blob or "opera" in blob or "vivaldi" in blob


HALL_TITLE = "GameScorePad Hall"


def list_monitors() -> list[dict]:
    if sys.platform != "win32":
        return [{"left": 0, "top": 0, "width": 1920, "height": 1080, "primary": True}]
    try:
        import ctypes
        from ctypes import wintypes

        user32 = ctypes.windll.user32
        monitors: list[dict] = []

        class RECT(ctypes.Structure):
            _fields_ = [
                ("left", wintypes.LONG),
                ("top", wintypes.LONG),
                ("right", wintypes.LONG),
                ("bottom", wintypes.LONG),
            ]

        class MONITORINFO(ctypes.Structure):
            _fields_ = [
                ("cbSize", wintypes.DWORD),
                ("rcMonitor", RECT),
                ("rcWork", RECT),
                ("dwFlags", wintypes.DWORD),
            ]

        MONITORENUMPROC = ctypes.WINFUNCTYPE(
            wintypes.BOOL,
            wintypes.HMONITOR,
            wintypes.HDC,
            ctypes.POINTER(RECT),
            wintypes.LPARAM,
        )

        def _cb(hmon, _hdc, _lprc, _lp):
            mi = MONITORINFO()
            mi.cbSize = ctypes.sizeof(MONITORINFO)
            user32.GetMonitorInfoW(hmon, ctypes.byref(mi))
            rr = mi.rcMonitor
            monitors.append(
                {
                    "left": int(rr.left),
                    "top": int(rr.top),
                    "width": int(rr.right - rr.left),
                    "height": int(rr.bottom - rr.top),
                    "primary": bool(mi.dwFlags & 1),
                }
            )
            return True

        user32.EnumDisplayMonitors(0, 0, MONITORENUMPROC(_cb), 0)
        if monitors:
            monitors.sort(key=lambda m: (not m["primary"], m["left"], m["top"]))
            return monitors
    except Exception as e:
        log(f"monitor enum failed: {e}")
    return [{"left": 0, "top": 0, "width": 1920, "height": 1080, "primary": True}]


def pick_display_index(monitors: list[dict], preferred: int | None = None) -> int:
    """Hall = the monitor the operator is not on. Side is not fixed."""
    if not monitors:
        return 0
    if preferred is not None and 0 <= preferred < len(monitors):
        return preferred
    if sys.platform == "win32":
        try:
            ops = iter_operator_windows()
            if ops:
                c = window_center(ops[-1])
                if c:
                    op_i = monitor_index_for_point(c[0], c[1], monitors)
                    for i, _m in enumerate(monitors):
                        if i != op_i:
                            log(f"hall monitor {i} (operator on {op_i})")
                            return i
        except Exception as e:
            log(f"pick hall vs operator: {e}")
    for i, m in enumerate(monitors):
        if not m.get("primary"):
            return i
    return 0


def clear_profile_locks(profile: Path) -> None:
    profile.mkdir(parents=True, exist_ok=True)
    for name in (
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "lockfile",
        "RunningChromeVersion",
    ):
        p = profile / name
        try:
            if p.exists() or p.is_symlink():
                p.unlink()
        except Exception:
            pass


def kill_proc(proc) -> None:
    if not proc:
        return
    try:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=2)
            except Exception:
                proc.kill()
    except Exception:
        pass


def kill_browsers_using_profile(profile: Path) -> None:
    if sys.platform != "win32":
        return
    needle = str(profile).replace("'", "''")
    ps = (
        f"$n = '{needle}'.ToLower(); "
        "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe' OR Name='browser.exe'\" | "
        "ForEach-Object { if ($_.CommandLine -and $_.CommandLine.ToLower().Contains($n)) { "
        "try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} } }"
    )
    try:
        flags = subprocess.CREATE_NO_WINDOW if hasattr(subprocess, "CREATE_NO_WINDOW") else 0
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
            capture_output=True,
            timeout=12,
            creationflags=flags,
        )
    except Exception as e:
        log(f"kill profile procs: {e}")


def _user32():
    import ctypes
    from ctypes import wintypes

    u = ctypes.windll.user32
    return ctypes, wintypes, u


def window_center(hwnd) -> tuple[int, int] | None:
    try:
        ctypes, wintypes, user32 = _user32()
        rect = wintypes.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
            return None
        return (int(rect.left + rect.right) // 2, int(rect.top + rect.bottom) // 2)
    except Exception:
        return None


def monitor_index_for_point(x: int, y: int, mons: list[dict]) -> int:
    for i, m in enumerate(mons):
        if m["left"] <= x < m["left"] + m["width"] and m["top"] <= y < m["top"] + m["height"]:
            return i
    return 0


def iter_operator_windows():
    ctypes, wintypes, user32 = _user32()
    found = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, _lp):
        if user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            title = (buf.value or "").lower()
            if "gamescorepad" in title and "пульт" in title:
                found.append(hwnd)
        return True

    proc = WNDENUMPROC(cb)
    user32.EnumWindows(proc, 0)
    return found


def iter_titled_windows():
    ctypes, wintypes, user32 = _user32()
    found = []
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def cb(hwnd, _lp):
        if user32.IsWindowVisible(hwnd):
            buf = ctypes.create_unicode_buffer(512)
            user32.GetWindowTextW(hwnd, buf, 512)
            title = (buf.value or "").lower()
            if HALL_TITLE.lower() in title or "gamescorepad hall" in title:
                found.append(hwnd)
        return True

    proc = WNDENUMPROC(cb)
    user32.EnumWindows(proc, 0)
    return found


def close_hall_windows() -> None:
    if sys.platform != "win32":
        return
    try:
        ctypes, _wintypes, user32 = _user32()
        for hwnd in iter_titled_windows():
            user32.PostMessageW(hwnd, 0x0010, 0, 0)
    except Exception as e:
        log(f"close_hall_windows: {e}")


def snap_window(hwnd, mon: dict) -> None:
    ctypes, wintypes, user32 = _user32()
    gwl_style = -16
    if ctypes.sizeof(ctypes.c_void_p) == 8:
        get_long = user32.GetWindowLongPtrW
        set_long = user32.SetWindowLongPtrW
        get_long.restype = ctypes.c_ssize_t
        get_long.argtypes = [wintypes.HWND, ctypes.c_int]
        set_long.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_ssize_t]
    else:
        get_long = user32.GetWindowLongW
        set_long = user32.SetWindowLongW
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.ShowWindow(hwnd, 9)  # SW_RESTORE
    style = get_long(hwnd, gwl_style)
    style &= ~0x00CF0000
    style |= 0x80000000
    style |= 0x10000000
    set_long(hwnd, gwl_style, style)
    user32.SetWindowPos(
        hwnd,
        0,
        int(mon["left"]),
        int(mon["top"]),
        int(mon["width"]),
        int(mon["height"]),
        0x0040 | 0x0020,
    )
    user32.ShowWindow(hwnd, 5)  # SW_SHOW
    user32.SetForegroundWindow(hwnd)


def hall_alive() -> bool:
    if sys.platform != "win32":
        proc = _state.get("display_proc")
        return bool(proc and proc.poll() is None)
    try:
        return bool(iter_titled_windows())
    except Exception:
        return False


def hold_snap(mon: dict, seconds: float = 2.8) -> bool:
    if sys.platform != "win32":
        return False
    deadline = time.time() + seconds
    ok = False
    while time.time() < deadline:
        try:
            hwnds = iter_titled_windows()
            if hwnds:
                snap_window(hwnds[-1], mon)
                ok = True
        except Exception as e:
            log(f"hold_snap: {e}")
        time.sleep(0.2)
    return ok


def place_hall_window(mon: dict, timeout_s: float = 8.0) -> bool:
    if sys.platform != "win32":
        return False
    deadline = time.time() + timeout_s
    last_err = None
    while time.time() < deadline:
        try:
            hwnds = iter_titled_windows()
            if hwnds:
                snap_window(hwnds[-1], mon)
                log(f"placed hall hwnd={hwnds[-1]} on {mon}")
                return True
        except Exception as e:
            last_err = e
        time.sleep(0.2)
    log(f"place_hall_window failed: {last_err}")
    return False


def move_hall(mon: dict) -> bool:
    hwnds = iter_titled_windows() if sys.platform == "win32" else []
    if not hwnds:
        return False
    snap_window(hwnds[-1], mon)
    threading.Thread(target=hold_snap, args=(mon, 2.8), daemon=True).start()
    return True


def launch_hall(browser: str, url: str, mon: dict) -> subprocess.Popen:
    x, y = int(mon["left"]), int(mon["top"])
    w, h = int(mon["width"]), int(mon["height"])
    if is_chromium(browser):
        clear_profile_locks(PROFILE_DISPLAY)
        args = [
            browser,
            f"--user-data-dir={str(PROFILE_DISPLAY)}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-session-crashed-bubble",
            "--disable-features=TranslateUI,InfiniteSessionRestore",
            f"--window-position={x},{y}",
            f"--window-size={w},{h}",
            f"--app={url}",
        ]
    else:
        args = [browser, url]
    log(f"hall app pos={x},{y} size={w}x{h} url={url} browser={browser}")
    return subprocess.Popen(
        args,
        cwd=str(ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def open_display(monitor_index: int | None = None, force_launch: bool = False) -> dict:
    try:
        mons = list_monitors()
        _state["monitors"] = mons
        idx = pick_display_index(mons, monitor_index)
        _state["display_monitor"] = idx
        mon = mons[idx]
        url = f"http://{HOST}:{PORT}/display.html"
        browser = find_browser()
        if hall_alive() and not force_launch:
            placed = move_hall(mon)
            return {
                "ok": True,
                "moved": True,
                "monitor": idx,
                "bounds": mon,
                "monitors": mons,
                "browser": browser,
                "url": url,
                "alive": True,
                "placed": placed,
            }
        if not browser:
            webbrowser.open(url)
            return {
                "ok": True,
                "warning": "Браузер не найден — открыл системный, перетащите окно вручную",
                "monitor": idx,
                "monitors": mons,
                "url": url,
            }
        with _lock:
            kill_proc(_state.get("display_proc"))
        close_hall_windows()
        kill_browsers_using_profile(PROFILE_DISPLAY)
        time.sleep(0.35)
        proc = launch_hall(browser, url, mon)
        placed = place_hall_window(mon)
        if placed:
            threading.Thread(target=hold_snap, args=(mon, 2.8), daemon=True).start()
        alive = hall_alive() or proc.poll() is None
        with _lock:
            _state["display_proc"] = proc
        return {
            "ok": True,
            "moved": False,
            "monitor": idx,
            "bounds": mon,
            "monitors": mons,
            "browser": browser,
            "url": url,
            "alive": alive,
            "placed": placed,
        }
    except Exception as e:
        log(traceback.format_exc())
        return {"ok": False, "error": str(e), "monitors": _state.get("monitors") or []}


def cycle_display() -> dict:
    mons = list_monitors()
    _state["monitors"] = mons
    if not mons:
        return {"ok": False, "error": "no monitors"}
    cur = 0
    if hall_alive() and sys.platform == "win32":
        hwnds = iter_titled_windows()
        if hwnds:
            c = window_center(hwnds[-1])
            if c:
                cur = monitor_index_for_point(c[0], c[1], mons)
    else:
        cur = int(_state.get("display_monitor") or 0)
    nxt = (cur + 1) % len(mons)
    if hall_alive():
        return open_display(monitor_index=nxt, force_launch=False)
    return open_display(monitor_index=nxt, force_launch=True)


def status() -> dict:
    return {
        "ok": True,
        "display_alive": hall_alive(),
        "display_monitor": _state.get("display_monitor"),
        "monitors": _state.get("monitors") or list_monitors(),
        "browser": find_browser(),
    }


def list_backgrounds() -> list[str]:
    BG_DIR.mkdir(parents=True, exist_ok=True)
    names = []
    for p in sorted(BG_DIR.iterdir(), key=lambda x: x.name.lower()):
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS:
            names.append(p.name)
    return names


def save_bg_upload(headers, body: bytes) -> dict:
    ctype = headers.get("Content-Type", "")
    if "multipart/form-data" not in ctype.lower():
        return {"ok": False, "error": "нужен файл"}
    if len(body) > 40_000_000:
        return {"ok": False, "error": "файл слишком большой"}
    msg = BytesParser(policy=policy.default).parsebytes(
        f"Content-Type: {ctype}\r\nMIME-Version: 1.0\r\n\r\n".encode("utf-8") + body
    )
    part = None
    if msg.is_multipart():
        for item in msg.iter_parts():
            if item.get_filename():
                part = item
                break
    if part is None:
        return {"ok": False, "error": "файл не найден"}
    filename = Path(part.get_filename() or "file").name
    ext = Path(filename).suffix.lower()
    if ext not in IMAGE_EXTS:
        return {"ok": False, "error": "нужен jpg, png, webp или gif"}
    payload = part.get_payload(decode=True) or b""
    if not payload:
        return {"ok": False, "error": "пустой файл"}
    BG_DIR.mkdir(parents=True, exist_ok=True)
    dest = BG_DIR / filename
    dest.write_bytes(payload)
    return {"ok": True, "name": filename, "files": list_backgrounds()}


def _xml_esc(s: str) -> str:
    return (
        str(s)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _col_letter(idx: int) -> str:
    n = idx + 1
    out = ""
    while n:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out


def build_xlsx(payload: dict) -> bytes:
    import io
    import zipfile

    title = str(payload.get("title") or "Результаты")
    tours = int(payload.get("tours") or 7)
    rows = payload.get("rows") or []
    headers = ["М", "Команда"] + [str(i + 1) for i in range(tours)] + ["Сумма"]
    sheet_rows = [headers]
    for item in rows:
        scores = item.get("scores") or []
        line = [item.get("place", ""), item.get("name", "")]
        for i in range(tours):
            val = scores[i] if i < len(scores) else None
            if val is None or val == "":
                line.append("")
            else:
                try:
                    num = float(val)
                    line.append(int(num) if num.is_integer() else num)
                except (TypeError, ValueError):
                    line.append("")
        try:
            total = float(item.get("score") or 0)
            line.append(int(total) if total.is_integer() else total)
        except (TypeError, ValueError):
            line.append(0)
        sheet_rows.append(line)

    def cell_xml(r: int, c: int, value) -> str:
        ref = f"{_col_letter(c)}{r}"
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{ref}"><v>{value}</v></c>'
        text = _xml_esc(value)
        return f'<c r="{ref}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>'

    row_xml = []
    for r, row in enumerate(sheet_rows, start=1):
        cells = "".join(cell_xml(r, c, v) for c, v in enumerate(row))
        row_xml.append(f'<row r="{r}">{cells}</row>')
    sheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(row_xml)}</sheetData></worksheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="Результаты" sheetId="1" r:id="rId1"/></sheets></workbook>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/></Relationships>'
    )
    wb_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/></Relationships>'
    )
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", rels)
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
    _ = title
    return buf.getvalue()


class Handler(SimpleHTTPRequestHandler):
    def _bytes(self, code: int, data: bytes, content_type: str, filename: str) -> None:
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(data)
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt: str, *args) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _json(self, code: int, obj: dict) -> None:
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/status":
            return self._json(200, status())
        if path == "/api/open-display":
            return self._json(200, open_display())
        if path == "/api/cycle-display":
            return self._json(200, cycle_display())
        if path == "/api/reload-display":
            with _lock:
                _state["hall_reload"] = int(_state.get("hall_reload") or 0) + 1
                n = _state["hall_reload"]
            return self._json(200, {"ok": True, "hallReload": n})
        if path == "/api/state":
            with _lock:
                body = _state.get("tournament")
                n = int(_state.get("hall_reload") or 0)
            return self._json(200, {"ok": True, "state": body, "hallReload": n})
        if path == "/api/bg":
            return self._json(200, {"ok": True, "files": list_backgrounds(), "folder": str(BG_DIR)})
        return super().do_GET()

    def do_POST(self) -> None:  # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/bg":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b""
            return self._json(200, save_bg_upload(self.headers, raw))
        if parsed.path == "/api/export.xlsx":
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except json.JSONDecodeError:
                return self._json(400, {"ok": False, "error": "bad json"})
            try:
                data = build_xlsx(payload)
            except Exception as e:
                log(traceback.format_exc())
                return self._json(500, {"ok": False, "error": str(e)})
            return self._bytes(
                200,
                data,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "results.xlsx",
            )
        if parsed.path != "/api/state":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(raw.decode("utf-8") or "{}")
        except json.JSONDecodeError:
            return self._json(400, {"ok": False, "error": "bad json"})
        with _lock:
            _state["tournament"] = payload
        return self._json(200, {"ok": True})


def main() -> int:
    os.chdir(ROOT)
    BG_DIR.mkdir(parents=True, exist_ok=True)
    _state["monitors"] = list_monitors()
    log(f"Monitors: {json.dumps(_state['monitors'], ensure_ascii=False)}")
    log(f"Browser: {find_browser() or 'NOT FOUND'}")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    url = f"http://{HOST}:{PORT}/"
    print("GameScorePad")
    print("Operator:", url)
    print("Hall: default browser on the other monitor, F11 fullscreen")
    print("Ctrl+C to stop")
    try:
        webbrowser.open(url)
    except Exception:
        pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")
        kill_proc(_state.get("display_proc"))
        kill_browsers_using_profile(PROFILE_DISPLAY)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
