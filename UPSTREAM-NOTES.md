# UPSTREAM-NOTES

This fork (spotonroofing/command-center, from siteboon/claudecodeui) is Willem's daily
chat view for Claude Code on the KEG machine, docked inside Orca. Changes are
kept at the theme/config layer so upstream merges stay cheap.

## Fork changes

- **Orca dark theme** (`src/index.css`, `tailwind.config.js`): the `.dark`
  token block is remapped to the Orca desktop app's dark palette (near-black
  `#0a0a0a` canvas, `#171717` cards, neutral monochrome primary, hairline
  `rgb(255 255 255 / 0.07)` borders, radius `0.625rem`). Sans font is Geist
  (bundled via `@fontsource-variable/geist`), mono matches Orca's stack.
  Values only were matched; no code was copied from any Orca repo.
- **Dark by default** (`src/contexts/ThemeContext.jsx`): with no saved theme,
  the app starts dark instead of following the OS, since it docks inside
  Orca's dark UI. The toggle still works and persists.

## Local deployment (not committed; lives in `.env` + Task Scheduler)

- `.env` (gitignored): `SERVER_PORT=4747`, `HOST=127.0.0.1` (localhost only,
  never exposed), `VITE_IS_PLATFORM=true`, `ANTHROPIC_API_KEY=` (empty).
- **No login screen**: upstream's platform mode (`VITE_IS_PLATFORM=true`) is
  used for a single local user — the server binds only to localhost, so token
  auth adds nothing here. It must be set both at `vite build` time and at
  server runtime (the `.env` covers both). One-time setup after a fresh
  `auth.db`: `POST /api/auth/register` then `POST /api/user/complete-onboarding`.
  The registered password is unused in platform mode; to reset, delete
  `~/.command-center/auth.db` and repeat.
- **Subscription billing**: the server forwards its own env to every spawned
  `claude` (SDK `options.env = {...process.env}`), and the env carries
  `ANTHROPIC_API_KEY=` empty (set in `.env` and again in the launcher), so the
  CLI always falls back to the logged-in Claude subscription.
- **Start at logon**: `scripts/windows/start-command-center.vbs` runs
  `node dist-server/server/index.js` hidden, logging to `~/.command-center/server.log`.
  Registered as scheduled task "Command Center Server" (logon trigger). Note:
  `schtasks /Create /SC ONLOGON` is denied without elevation on Windows 11;
  use the unelevated PowerShell path instead:

  ```powershell
  $a = New-ScheduledTaskAction -Execute "wscript.exe" -Argument '"C:\Users\KEG\Projects\command-center\scripts\windows\start-command-center.vbs"'
  $t = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
  $s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero)
  Register-ScheduledTask -TaskName "Command Center Server" -Action $a -Trigger $t -Settings $s -Force
  ```

## Docking the pane in Orca

One line adds the chat pane as a browser tab to any Orca project (find the
worktree id with `orca worktree list --json`):

```
orca tab create --url "http://127.0.0.1:4747/" --worktree "id:<repoId>::<worktreePath>" --json
```

That's it — the tab persists with the worktree. Currently added to the
orca-app project. The fork's add-project flow could adopt this later: when a
project is added in Command Center, offer to run the same `orca tab create` against
the matching Orca worktree so every project gets its docked chat pane
automatically.
