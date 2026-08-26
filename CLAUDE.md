# CloudCLI

- Server bind is env-configured: `HOST` sets the bind address (default `127.0.0.1`, localhost only; `HOST=0.0.0.0` serves all interfaces, e.g. for Tailscale) and `SERVER_PORT` sets the port (default `3001`).
- Two-artifact layout: `npm run build` emits dev-only artifacts (`dist-dev/`, `dist-server-dev/`) that the dev instance serves; live serves `dist/` + `dist-server/`, which only promote.sh's copy step ever writes — never point a build at live's dirs.

## Showing an image in the chat

A session shows an image inline in its transcript by writing a markdown image whose path is a file inside the project workspace:

```
![icon draft](assets/icon.svg)
```

- The path is relative to the project root (an absolute path inside the project also works). Use this deliberately when you produced or edited an image worth previewing — icon renders, screenshots, mockups.
- Only files inside the project workspace render; URLs and paths outside it fall back to a plain non-image line. Covered formats: SVG, PNG, JPEG, GIF, WebP.
- The image renders as a bordered card in the chat and opens in a zoomable preview on click.
