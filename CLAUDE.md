# Command Center

- Server bind is env-configured: `HOST` sets the bind address (default `127.0.0.1`, localhost only; `HOST=0.0.0.0` serves all interfaces, e.g. for Tailscale) and `SERVER_PORT` sets the port (default `3001`).
- Two-artifact layout: `npm run build` emits dev-only artifacts (`dist-dev/`, `dist-server-dev/`) that the dev instance serves; live serves `dist/` + `dist-server/`, which only promote.sh's copy step ever writes — never point a build at live's dirs.
- Headless Claude bypass mode steers file work into Bash, so runners use `acceptEdits` with an explicit unattended-tool allowlist instead.
- A live zsh chain keeps reading the runner inode it opened at spawn; `dispatch-chain-runner` hashes itself and re-execs from disk at unit boundaries so a landed runner fix reaches the next unit.
- For UI work, start at `DESIGN.md` and read only the areas your files touch. Reuse the closest existing element, and update the matching area file whenever implementation changes a documented pattern so design guidance and code stay consistent.

## Showing a file or image in the chat

A session presents a file by writing a markdown link to it, and the chat renders that link as the file card — name, size, kind — which opens in the viewer with a download control:

```
[the punch list](PUNCHLIST_ui18.md)
[the system overview](~/Projects/spoton-worker/review-20260829/SYSTEM_OVERVIEW.md)
```

- The link target may sit inside the project workspace (relative to the project root, or absolute inside it) or inside `~/Projects/spoton-worker`. Anything else — another root, a missing file, an `https://` URL, or a `path:line` code reference — stays an ordinary link. Use this instead of pasting a whole file into the chat.

A session shows an image inline in its transcript by writing a markdown image whose source is either a file inside the project workspace or an HTTPS URL:

```
![icon draft](assets/icon.svg)
![research reference](https://example.com/reference.png)
```

- The path is relative to the project root (an absolute path inside the project also works). Use this deliberately when you produced or edited an image worth previewing — icon renders, screenshots, mockups.
- Local files render only when their resolved path stays inside the project workspace. HTTPS URLs render directly without a download step. Other URL schemes, paths outside the workspace, missing files, and failed remote images fall back to a plain non-image line. Covered formats: SVG, PNG, JPEG, GIF, WebP.
- The image renders as a bordered card in the chat and opens in a zoomable preview on click.
