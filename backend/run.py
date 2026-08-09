"""
Server runner.
Usage: python run.py
"""

import os

import uvicorn

if __name__ == "__main__":
    reload = os.getenv("UVICORN_RELOAD", "false").lower() == "true"
    # forwarded_allow_ips="*" would make uvicorn trust the X-Forwarded-For
    # header from *any* connecting peer, including a client's own spoofed
    # value. Restrict it to the private ranges Docker Compose assigns
    # container IPs from, so only the adjacent Caddy hop is trusted and any
    # earlier (client-supplied) entry in the header is correctly ignored.
    forwarded_allow_ips = os.getenv(
        "FORWARDED_ALLOW_IPS", "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
    )
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=reload,
        proxy_headers=True,
        forwarded_allow_ips=forwarded_allow_ips,
    )
