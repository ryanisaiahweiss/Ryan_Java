#!/usr/bin/env python3
"""Modulyt launcher.

Usage:
    py modulyt.py                     # serve all dashboards, open the home page
    py modulyt.py requirements        # serve all, open the requirements dashboard
    py modulyt.py --port 9000 --no-browser
"""
import argparse
import sys
import threading
import webbrowser
from pathlib import Path

from core.server import create_server


def main() -> int:
    parser = argparse.ArgumentParser(description="Modulyt dashboard server")
    parser.add_argument("dashboard", nargs="?", help="dashboard to open in the browser")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    server, app = create_server(root, args.host, args.port)

    if args.dashboard and args.dashboard not in app.dashboards:
        print(f"Unknown dashboard '{args.dashboard}'. Available: {', '.join(app.dashboards)}")
        return 1

    path = f"/d/{args.dashboard}/" if args.dashboard else "/"
    url = f"http://{args.host}:{args.port}{path}"
    print(f"Modulyt serving {len(app.dashboards)} dashboard(s) at {url}")
    print("Edit the JSON files in Data/ and open pages update live. Ctrl+C to stop.")
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
