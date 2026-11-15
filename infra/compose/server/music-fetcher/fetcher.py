"""
Kimono Music's fetcher: yt-dlp beside the Portal, for when the Portal's own
YouTube.js can't get a song's audio. yt-dlp falls back between YouTube's
clients by itself and is fixed upstream within days when YouTube changes, so
updating this image is how playback is mended.

  GET /healthz           -> 200 "ok"
  GET /audio/<video id>  -> the song's audio (AAC in MP4), sent as it downloads

Every /audio request carries X-Kimono-Key. The Portal keeps what it's sent, so
a song is fetched from here once. PO tokens come from the bgutil provider
(BGUTIL_URL); yt-dlp asks it when a client needs one.
"""

import hmac
import os
import re
import shutil
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import yt_dlp

KEY = os.environ.get("KIMONO_FETCHER_KEY", "")
BGUTIL = os.environ.get("BGUTIL_URL", "http://bgutil-provider:4416")
WORK = os.environ.get("KIMONO_FETCHER_WORK", tempfile.gettempdir())
LISTEN = os.environ.get("KIMONO_FETCHER_LISTEN", "0.0.0.0:8080")
VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")

OPTIONS = {
    "quiet": True,
    "no_warnings": True,
    "noprogress": True,
    # AAC in MP4 plays everywhere: every browser, Android and iPhone.
    "format": "140/bestaudio[ext=m4a]/bestaudio[acodec^=mp4a]",
    "nopart": True,
    "noplaylist": True,
    "cachedir": os.path.join(WORK, "yt-dlp-cache"),
    "extractor_args": {"youtubepot-bgutilhttp": {"base_url": [BGUTIL]}},
}


class Download:
    """One yt-dlp run into a file, which readers follow as it grows."""

    def __init__(self, video_id: str):
        self.dir = tempfile.mkdtemp(prefix=f"{video_id}-", dir=WORK)
        # Where yt-dlp is writing now: it names the file itself (a .temp first), and says so in its progress.
        self.path = None
        self.size = None
        self.done = False
        self.error = None
        self.changed = threading.Condition()
        threading.Thread(target=self.run, args=(video_id,), daemon=True).start()

    def hook(self, d):
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        writing = d.get("tmpfilename") or d.get("filename")
        with self.changed:
            if writing and self.path is None:
                self.path = writing
            if total and self.size is None:
                self.size = int(total)
            self.changed.notify_all()

    def run(self, video_id: str):
        try:
            opts = {**OPTIONS, "outtmpl": os.path.join(self.dir, "audio.%(ext)s"), "progress_hooks": [self.hook], "overwrites": True}
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.download([f"https://music.youtube.com/watch?v={video_id}"])
            if self.size is None and self.path and os.path.exists(self.path):
                self.size = os.path.getsize(self.path)
        except Exception as e:  # noqa: BLE001 — told to the Portal as is
            self.error = str(e)[:300]
        finally:
            with self.changed:
                self.done = True
                self.changed.notify_all()

    def tidy(self):
        """The Portal keeps the song; nothing stays here once yt-dlp is done."""
        with self.changed:
            while not self.done:
                self.changed.wait(5)
        shutil.rmtree(self.dir, ignore_errors=True)

    def wait_for_size(self, timeout=90):
        end = time.monotonic() + timeout
        with self.changed:
            while self.size is None and not self.done and time.monotonic() < end:
                self.changed.wait(1)
        return self.size


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        print(f"music-fetcher: {fmt % args}", flush=True)

    def send_text(self, status, text):
        body = text.encode()
        self.send_response(status)
        self.send_header("content-type", "text/plain; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/healthz":
            return self.send_text(200, "ok")
        m = re.match(r"^/audio/([^/?]+)$", self.path)
        if not m or not VIDEO_ID.match(m.group(1)):
            return self.send_text(404, "No such song.")
        if not KEY or not hmac.compare_digest(self.headers.get("x-kimono-key", ""), KEY):
            return self.send_text(401, "Wrong key.")

        download = Download(m.group(1))
        size = download.wait_for_size()
        if size is None:
            threading.Thread(target=download.tidy, daemon=True).start()
            return self.send_text(502, download.error or "YouTube didn't answer in time.")

        self.send_response(200)
        self.send_header("content-type", "audio/mp4")
        self.send_header("content-length", str(size))
        self.end_headers()
        sent = 0
        try:
            while not (download.path and os.path.exists(download.path)) and not download.done:
                time.sleep(0.05)
            # Held open: yt-dlp renaming the file when it's done doesn't close what's being read.
            with open(download.path, "rb") as f:
                while sent < size:
                    chunk = f.read(min(256 * 1024, size - sent))
                    if chunk:
                        self.wfile.write(chunk)
                        sent += len(chunk)
                        continue
                    if download.done:
                        break
                    with download.changed:
                        download.changed.wait(0.2)
        except (BrokenPipeError, ConnectionResetError, FileNotFoundError, TypeError):
            pass
        finally:
            threading.Thread(target=download.tidy, daemon=True).start()
        if sent < size:
            # Short: the Portal sees the length didn't match and throws its copy away.
            self.close_connection = True


if __name__ == "__main__":
    if not KEY:
        raise SystemExit("KIMONO_FETCHER_KEY is required")
    os.makedirs(WORK, exist_ok=True)
    host, port = LISTEN.rsplit(":", 1)
    print(f"music-fetcher on {LISTEN}, tokens from {BGUTIL}, yt-dlp {yt_dlp.version.__version__}", flush=True)
    ThreadingHTTPServer((host, int(port)), Handler).serve_forever()
