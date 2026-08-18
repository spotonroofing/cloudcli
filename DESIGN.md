# DESIGN.md — CloudCLI UI design system

Read this before any UI work. Reuse the closest existing element listed below; a new variant extends the existing pattern, never a parallel style.

## Tokens

All color tokens are HSL triplets consumed as `hsl(var(--token))`, defined in `src/index.css` (`:root` = light, `.dark` = dark) and mapped to Tailwind utilities in `tailwind.config.js`.

### Typography

Self-hosted Schibsted Grotesk Variable (weights 400–900, normal + italic) via `@fontsource-variable/schibsted-grotesk`, imported at the top of `src/index.css`. No CDN font dependencies.

- `--font-ui` — UI chrome. Tailwind `font-sans` (the body default).
- `--font-message` — chat message content. Tailwind `font-serif` (legacy utility name kept so existing call sites resolve to the message cut; do not add real serifs).

Both currently point at the same family; keep them separate so the cuts can diverge.

### Radius

- `--radius: 0.75rem` — the one app-wide corner radius token (Claude.ai-like). Tailwind `rounded-lg` = token, `rounded-md` = token − 2px, `rounded-sm` = token − 4px.
- Never apply asymmetric per-corner radii (`rounded-br-*` etc.) in the chat view. Fully-round pills/avatars use `rounded-full`.

### Colors (semantic, light/dark via `.dark`)

`--background` / `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring` — each with a `-foreground` pair where applicable. Nav-specific glass tokens (`--nav-glass-*`, `--nav-tab-*`, `--nav-input-*`) also live in `src/index.css`.

- Accent: `--primary: 15 56% 52%` (Claude-style terracotta, #C96442; same value light and dark, `--primary-foreground` white). `--ring` and the nav glow/focus tokens carry the same hue. Every accent use (send button, links, active states, selection ticks, progress ring fill, focus rings) goes through `primary`/`ring` utilities — never hardcode blue or orange Tailwind palette classes.
- User message bubble: `bg-secondary text-secondary-foreground` (lighter gray bubble on the darker background in dark mode, white text). No blue bubble, no avatar circle.
- Secondary/metadata text: `text-muted-foreground`.

### Shadow & spacing

- Bubbles and inline chat elements: flat, no shadow beyond what the component already carries.
- Popovers/menus: `border border-border bg-popover shadow-lg` with `rounded-md`/`rounded-lg`.
- Mobile safe-area and nav spacing variables (`--mobile-nav-*`, `--safe-area-inset-*`) are defined in `src/index.css`; use them, don't hardcode offsets.

## Reusable-element inventory

Shared primitives (shadcn-style, use these first): `src/shared/view/ui/`
- `Button.tsx`, `Input.tsx`, `Badge.tsx`, `Card.tsx`, `Alert.tsx`, `Dialog.tsx`, `Tooltip.tsx`, `Collapsible.tsx`, `ScrollArea.tsx`, `Command.tsx`, `ActionMenu.tsx`, `PillBar.tsx`, `PromptInput.tsx`, `Reasoning.tsx` (thinking accordion), `Shimmer.tsx`, `Confirmation.tsx`, `Queue.tsx` — exported through `src/shared/view/ui/index.ts`.

Chat view: `src/components/chat/view/`
- `ChatInterface.tsx` — top-level chat screen.
- `subcomponents/MessageComponent.tsx` — one message (user bubble, assistant/tool/error layouts).
- `subcomponents/MessageCopyControl.tsx` — single copy button, always copies plain text.
- `subcomponents/MessageSpeakControl.tsx` — TTS button.
- `subcomponents/Markdown.tsx` — markdown renderer (`prose prose-sm font-serif dark:prose-invert` pattern).
- `subcomponents/ChatComposer.tsx` — input composer (unified single box: textarea on top, one control row below; plus/attach left, model selector + send right; no hint text, no permission selector — sessions are hardwired to skip-permissions). `ComposerModelMenu.tsx` — Claude.ai-style model switcher (pill: friendly name + effort + chevron; card + Effort and More models submenus; friendly labels only, wire values unchanged), `CommandMenu.tsx` — composer menus (portal + `bg-popover` pattern).
- `subcomponents/ChatMessagesPane.tsx` — scroll container; `TokenUsageSummary.tsx` — circular context-usage progress ring, click opens the usage menu.
- `tools/ToolRenderer.tsx` (+ `tools/components/`) — tool input/result rendering.

App chrome
- Sidebar: `src/components/sidebar/`; main layout: `src/components/main-content/`, `src/components/app/`.
- Settings: `src/components/settings/`; quick settings: `src/components/quick-settings-panel/`.

Global CSS (scrollbars, transitions, chat containment classes, placeholder colors): `src/index.css`.
