"""Loopback-only backend. Electron uses a per-launch token via IPC."""
from __future__ import annotations
import argparse
import hmac
import json
import os
from pathlib import Path
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from terrain import generate
from height_format import MAX_SAVE_BYTES
from city.service import CityService

ROOT = Path(__file__).resolve().parent.parent / 'renderer'
TOKEN = os.environ.get('TERRAIN_API_TOKEN', '')
GENERATION_LOCK = threading.Lock()
CITY_SERVICE = CityService()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(fmt % args, file=sys.stderr, flush=True)

    def reply(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False, separators=(',', ':')).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = urlparse(self.path).path
        if route == '/api/health':
            return self.reply(200, {'status': 'ok', 'engine': 'Python / NumPy'})
        # Renderer assets are exposed only for local browser preview.
        allowed = {'/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/height-format.js': 'height-format.js', '/map-geometry.js': 'map-geometry.js', '/style.css': 'style.css',
                   '/map-icons.js': 'map-icons.js', '/map-renderer.js': 'map-renderer.js', '/city.js': 'city.js', '/city-geometry.js': 'city-geometry.js', '/road-renderer.js': 'road-renderer.js', '/scene-renderer.js': 'scene-renderer.js', '/city.css': 'city.css',
                   '/assets/tree-canopies.png': 'assets/tree-canopies.png',
                   '/assets/tree-species.png': 'assets/tree-species.png',
                   '/assets/vehicles.png': 'assets/vehicles.png',
                   '/assets/pedestrian-clothing.png': 'assets/pedestrian-clothing.png',
                   '/pedestrian-renderer.js': 'pedestrian-renderer.js',
                   '/scene-3d.js': 'scene-3d.js', '/vendor/three.min.js': 'vendor/three.min.js',
                   '/material-catalog.js': 'material-catalog.js',
                   '/surface-variation.js': 'surface-variation.js', '/simulation-driver.js': 'simulation-driver.js',
                   '/special-buildings.js': 'special-buildings.js',
                   '/civic-buildings.js': 'civic-buildings.js',
                   '/civic-details.js': 'civic-details.js',
                   '/block-architecture.js': 'block-architecture.js', '/ordinary-roofs.js': 'ordinary-roofs.js',
                   '/assets/roof-atlas.png': 'assets/roof-atlas.png', '/assets/ground-atlas.png': 'assets/ground-atlas.png',
                   '/assets/facade-atlas.png': 'assets/facade-atlas.png', '/assets/landscape-atlas.png': 'assets/landscape-atlas.png',
                   '/navigation.js': 'navigation.js', '/navigation.css': 'navigation.css'}
        if not self.server.preview or route not in allowed:
            return self.reply(404, {'error': '未找到资源'})
        asset = ROOT / allowed[route]
        mime = {'html': 'text/html', 'js': 'text/javascript', 'css': 'text/css', 'png': 'image/png'}[asset.suffix[1:]]
        body = asset.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime + ('; charset=utf-8' if mime.startswith('text/') else ''))
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        route = urlparse(self.path).path
        if route != '/api/generate' and not route.startswith('/api/city/'):
            return self.reply(404, {'error': '未找到接口'})
        if TOKEN and not hmac.compare_digest(self.headers.get('X-Terrain-Token', ''), TOKEN):
            return self.reply(403, {'error': '无效的访问令牌'})
        # Prevent other origins from driving an unauthed preview server.
        origin = self.headers.get('Origin')
        if origin and origin != f'http://127.0.0.1:{self.server.server_port}':
            return self.reply(403, {'error': '不允许的来源'})
        if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
            return self.reply(415, {'error': '需要 JSON 请求'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
            maximum = MAX_SAVE_BYTES if route == '/api/city/import' else (2_000_000 if route.startswith('/api/city/') else 8192)
            if length < 1 or length > maximum:
                return self.reply(413, {'error': '请求大小无效'})
            options = json.loads(self.rfile.read(length))
            if route == '/api/generate':
                with GENERATION_LOCK:
                    result = generate(options)
                    result['worldId'] = CITY_SERVICE.register(result)
            else:
                result = CITY_SERVICE.handle(route.rsplit('/', 1)[-1], options)
            self.reply(200, result)
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as exc:
            self.reply(400, {'error': str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self.reply(500, {'error': '引擎操作失败，原有存档已保留，请重试'})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=0)
    parser.add_argument('--preview', action='store_true')
    args = parser.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.preview = args.preview
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': server.server_port}), flush=True)
    # Electron also terminates us explicitly; this covers abrupt parent loss.
    if os.environ.get('TERRAIN_PARENT_PID'):
        parent = int(os.environ['TERRAIN_PARENT_PID'])
        def watch_parent():
            while True:
                threading.Event().wait(2)
                try:
                    os.kill(parent, 0)
                except ProcessLookupError:
                    os._exit(0)
        threading.Thread(target=watch_parent, daemon=True).start()
    server.serve_forever()


if __name__ == '__main__':
    main()
