# Local HTTP server with auto-shutdown after 2 hours of inactivity
import http.server
import socketserver
import threading
import time
import os

PORT = 8000
TIMEOUT = 2 * 60 * 60  # 2 hours in seconds
HEARTBEAT_FILE = 'server_heartbeat.txt'

class TimeoutHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        # Update heartbeat file on any GET
        with open(HEARTBEAT_FILE, 'w') as f:
            f.write(str(time.time()))
        return super().do_GET()

def monitor_timeout():
    while True:
        time.sleep(60)
        try:
            with open(HEARTBEAT_FILE, 'r') as f:
                last = float(f.read())
            if time.time() - last > TIMEOUT:
                print('No activity for 2 hours. Shutting down server.')
                os._exit(0)
        except Exception:
            pass

if __name__ == '__main__':
    # Initialize heartbeat
    with open(HEARTBEAT_FILE, 'w') as f:
        f.write(str(time.time()))
    # Start timeout monitor thread
    threading.Thread(target=monitor_timeout, daemon=True).start()
    with socketserver.TCPServer(('', PORT), TimeoutHandler) as httpd:
        print(f'Serving at http://localhost:{PORT}/')
        httpd.serve_forever()
