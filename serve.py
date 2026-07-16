#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
简单的 HTTP 服务,用于预览 HTML 文件
用法: python3 serve.py [端口] [文件名]
默认: 端口 8000,文件 card.html
"""

import http.server
import socketserver
import webbrowser
import sys
import os
from functools import partial

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
TARGET = sys.argv[2] if len(sys.argv) > 2 else "card.html"
HOST = "0.0.0.0"

os.chdir(os.path.dirname(os.path.abspath(__file__)))

# 用 ThreadingHTTPServer:每个请求独立线程,避免浏览器 keep-alive 长连接
# 占住单线程导致后续请求卡死(超时)的问题
Handler = partial(http.server.SimpleHTTPRequestHandler)
ReusableTCPServer = http.server.ThreadingHTTPServer

def main():
    with ReusableTCPServer((HOST, PORT), Handler) as httpd:
        local_url = f"http://localhost:{PORT}/{TARGET}"
        lan_url = f"http://{_lan_ip()}:{PORT}/{TARGET}" if _lan_ip() else None

        print("=" * 50)
        print(f"  {TARGET} 预览服务已启动")
        print("=" * 50)
        print(f"  本地访问: {local_url}")
        if lan_url:
            print(f"  局域网访问: {lan_url}")
        print(f"  根目录: {os.getcwd()}")
        print("  按 Ctrl+C 停止服务")
        print("=" * 50)

        webbrowser.open(local_url)

        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n服务已停止。")
        except BrokenPipeError:
            pass

def _lan_ip():
    import socket
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None

if __name__ == "__main__":
    main()
