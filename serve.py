#!/usr/bin/env python3
"""Local static server for the projection mapper.

Python's stock http.server lacks HTTP Range support, which browsers need to
seek inside video files, and on Windows it can serve .js as text/plain, which
breaks ES modules. This fixes both. No third-party packages needed.

Usage:  python serve.py [port]      (default 8765, binds to 127.0.0.1 only)
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

TYPES = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.ogv': 'video/ogg', '.mkv': 'video/x-matroska',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
}


class Handler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def guess_type(self, path):
        return TYPES.get(os.path.splitext(path)[1].lower()) or super().guess_type(path)

    def end_headers(self):
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def send_head(self):
        self._range_len = None
        path = self.translate_path(self.path.split('?', 1)[0])
        rng = self.headers.get('Range')
        if rng and os.path.isfile(path):
            m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if m:
                size = os.path.getsize(path)
                first, last = m.group(1), m.group(2)
                if first == '':
                    start = max(0, size - int(last or 0))
                    end = size - 1
                else:
                    start = int(first)
                    end = min(int(last), size - 1) if last else size - 1
                if start >= size or start > end:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{size}')
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return None
                f = open(path, 'rb')
                f.seek(start)
                self.send_response(206)
                self.send_header('Content-Type', self.guess_type(path))
                self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
                self.send_header('Content-Length', str(end - start + 1))
                self.end_headers()
                self._range_len = end - start + 1
                return f
        return super().send_head()

    def copyfile(self, source, outputfile):
        if self._range_len is None:
            return super().copyfile(source, outputfile)
        remaining = self._range_len
        while remaining > 0:
            chunk = source.read(min(1 << 16, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def do_GET(self):
        try:
            super().do_GET()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass  # browsers abort video range requests all the time

    def log_message(self, fmt, *args):
        if args and str(args[0]).startswith(('GET /media/', 'GET /js/', 'GET /css/')):
            return
        super().log_message(fmt, *args)


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    root = os.path.dirname(os.path.abspath(__file__))
    os.makedirs(os.path.join(root, 'media'), exist_ok=True)
    server = ThreadingHTTPServer(('127.0.0.1', port), partial(Handler, directory=root))
    print(f'Projection mapper:  http://127.0.0.1:{port}/   (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
