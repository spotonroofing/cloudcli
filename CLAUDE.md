# CloudCLI

- Server bind is env-configured: `HOST` sets the bind address (default `127.0.0.1`, localhost only; `HOST=0.0.0.0` serves all interfaces, e.g. for Tailscale) and `SERVER_PORT` sets the port (default `3001`).
- Two-artifact layout: `npm run build` emits dev-only artifacts (`dist-dev/`, `dist-server-dev/`) that the dev instance serves; live serves `dist/` + `dist-server/`, which only promote.sh's copy step ever writes — never point a build at live's dirs.
