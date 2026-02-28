# Dev Hub - Personal Development Command Center

## Context

- Personal web app to manage development environment from browser/phone
- Replaces need to SSH/terminal into WSL for common tasks
- Inspired by OpenCode's browser app but built as a custom Next.js solution
- Environment: Arch Linux WSL2, but **built generically** — not hardcoded to any specific repos
- Designed to be shareable with team members: starts as a blank slate, you add repos/worktrees as "workspaces" through the UI
- Each user gets their own instance running on their machine

## Decisions Made

| Decision         | Choice                                                    | Rationale                                    |
| ---------------- | --------------------------------------------------------- | -------------------------------------------- |
| Framework        | Next.js 16 (App Router) + shadcn/ui                       | Strong ecosystem, SSR, good mobile support   |
| Exposure         | Cloudflare Tunnel                                         | No open ports, free TLS, Zero Trust policies |
| Auth             | Password (bcryptjs) — passkeys/TOTP optional in Settings  | Simpler UX; Cloudflare Zero Trust is the real security layer |
| OpenCode UI      | Custom chat interface via `@opencode-ai/sdk`              | Native feel, mobile-friendly                 |
| OpenCode server  | Auto-managed by our app                                   | Single process to run                        |
| Commands         | Command runner panel (structured)                         | Better mobile UX than raw terminal           |
| File editor      | CodeMirror 6 + vim mode toggle (`@replit/codemirror-vim`) | Mobile-friendly, lightweight, vim support    |
| Future editor    | Neovim in browser (xterm.js + neovim headless)            | Full editing power when needed               |
| Database         | SQLite via Drizzle ORM                                    | Simple, file-based, no extra services        |
| Location         | `~/dev/dev-hub/`                                          | Separate repo                                |
| Package versions | Always use latest stable                                  | Explicit policy                              |
| Project layout   | No `src/` dir — `app/`, `components/`, `lib/` at root     | Matches user preference                      |

## Core Concept: Workspaces

The central abstraction is a **workspace** — a directory on disk that the user registers with the hub. A workspace can be:

- A **standalone repo** (e.g., `~/dev/newcastleindie/`, `~/dev/firetui/`)
- A **git worktree** of a parent repo (e.g., `~/dev/pr-worktrees/image-viewer/`)
- Any arbitrary directory you want to work in

Workspaces are **not auto-discovered**. The user adds them via the UI (or creates new ones). Each workspace tracks:

- Path on disk
- Display name (defaults to directory name)
- Type: `repo` | `worktree`
- Parent repo path (for worktrees)
- Package manager detected (`pnpm` | `npm` | `bun` | `cargo` | `go` | `none`)
- Available scripts (from `package.json`, `Makefile`, `Cargo.toml`, etc.)
- Git branch, status, last commit
- Pinned quick commands (user-configurable per workspace)

### Creating Workspaces

- **Add existing**: Point to a directory on disk, hub detects type and metadata
- **Create worktree**: Provide parent repo + branch name. Hub runs the equivalent of the `wt-add` flow (create worktree, symlink shared files, install deps). Configurable per-repo setup scripts.
- **Clone repo**: Clone a remote repo into a configurable base directory
- **Create repo**: `git init` a new directory

## Architecture

```
[Phone/Browser]
       |
  [Cloudflare Tunnel]
       |
  [Custom Node Server (port 3000)]
       |
  ┌────┴────────────────────────────┐
  │  Next.js App Router             │
  │  ├── Pages (SSR/CSR)            │
  │  ├── API Routes                 │
  │  │   ├── /api/auth/*            │  NextAuth.js (password + optional passkey/TOTP)
  │  │   ├── /api/files/*           │  File CRUD (read/write/tree/browse)
  │  │   ├── /api/workspaces/*      │  Workspace CRUD + git ops
  │  │   ├── /api/system/*          │  System stats
  │  │   ├── /api/commands/*        │  Command execution
  │  │   └── /api/opencode/*        │  Proxy to opencode server (directory-routed)
  │  └── WebSocket upgrade          │  Command runner streams
  │                                 │
  │  [OpenCode Server Manager]      │  Single shared server, directory-routed
  │  [SQLite DB]                    │  Auth, settings, workspaces, history
  └─────────────────────────────────┘
       |
  [opencode server :4096]  ← single instance, all workspaces via ?directory= param
       |
  [filesystem / git / system]
```

### OpenCode Integration

A **single shared OpenCode server** serves all workspaces. The SDK's `directory` query parameter routes each API call to the correct workspace directory — no need for per-workspace server instances.

1. **Server Manager** (`lib/opencode/server-pool.ts`) spawns a single `opencode serve` process on port 4096. Health checks every 30s, auto-restarts on failure. Exports `getOrStartServer()`, `stopServer()`, `getServerStatus()`, `isServerRunning()`.
2. **SDK Client** (`lib/opencode/client.ts`) wraps `createOpencodeClient({ baseUrl })` pointed at the single server. Lazily creates/caches the client instance.
3. **Proxy Layer** at `/api/opencode/[...path]` resolves `workspaceId` query param → directory path via DB lookup, injects `directory` query param on the forwarded request.
4. **SSE Streaming** relays events from the OpenCode server's `/event` endpoint through our proxy to the client. The browser connects via `EventSource`.
5. **Session Persistence** — OpenCode stores sessions in its own SQLite DB per workspace directory. Our UI surfaces the session list so users can resume previous conversations.

### Command Runner

Not a full terminal emulator — a structured command execution panel:

1. User types command in input with **smart autocomplete** sourced from:
   - Command history (SQLite, ranked by frequency)
   - Shell aliases parsed from `~/.zshrc` (or configured shell rc file)
   - `package.json` scripts from the active workspace (shown as `npm run <script>`)
   - `Makefile` targets, `Cargo` commands, etc. (detected per workspace)
   - User-configured quick commands (global + per-workspace)
2. Backend spawns process via `node-pty` for TTY-aware output
3. Output streams to client via WebSocket
4. Rendered with ANSI color support (`ansi-to-html`)
5. Cancel support (SIGINT/SIGTERM)
6. Pre-configured quick actions per workspace: "Run tests", "Git status", "Lint", etc.
7. Command history persisted in SQLite (per workspace)

### File Editor

- **File Tree**: Lazy-loaded directory tree with search, scoped to active workspace
- **CodeMirror 6** with:
  - Vim mode toggle (`@replit/codemirror-vim`) — **floating toggle button on every editor instance**, also configurable as default in settings
  - Syntax highlighting for TS/JS/CSS/HTML/JSON/Python/Go/Rust/Markdown
  - Dark theme matching app theme
  - Basic autocomplete
- **Git awareness**: Modified/untracked/staged indicators on files in the tree
- **Mobile**: Full-width editor, swipe to toggle file tree

#### Future: Neovim in Browser

For more involved editing, a future phase will add an embedded neovim experience:

- Run `nvim --headless --listen` on the server
- Connect via WebSocket to an xterm.js terminal in the browser
- Uses the user's actual nvim config (`~/.config/nvim/`)
- Full plugin support, keybindings, LSP — everything works as on the local machine
- Toggle between CodeMirror (quick/mobile) and Neovim (power editing) per file

### Dev Server Preview (Wildcard Subdomain Proxy)

Allows previewing running dev servers (Storybook, docs, simple apps) from your phone via wildcard subdomains:

```
hub.tubbs.dev          → the hub (port 3000)
4200.hub.tubbs.dev     → proxied to localhost:4200
5173.hub.tubbs.dev     → proxied to localhost:5173
<port>.hub.tubbs.dev   → proxied to localhost:<port>
```

**How it works:**

1. **DNS**: Wildcard CNAME `*.hub.tubbs.dev` → Cloudflare Tunnel
2. **Tunnel config**: Ingress rule routes `*.hub.tubbs.dev` to the hub server
3. **Hub server**: Checks `Host` header — if `<port>.hub.tubbs.dev`, reverse-proxy to `localhost:<port>` via `http-proxy`. If `hub.tubbs.dev`, serve Next.js as normal.
4. **Auth enforced**: All requests go through the hub server, so unauthenticated requests to preview subdomains are redirected to login.
5. **WebSocket passthrough**: Proxy supports WebSocket upgrade so HMR/hot reload works.
6. **Auto-detection**: Command runner parses output for common patterns (`listening on port`, `ready on http://localhost:`, `Local: http://localhost:`, etc.) and surfaces a **"Preview"** button linking to `<port>.hub.tubbs.dev`.

#### CORS Caveat

**Works great for:**
- Storybook, documentation sites, static sites
- Apps that don't make cross-origin API calls
- Apps whose dev server proxies all API calls (same-origin, no CORS)

**Does NOT work for apps with CORS-sensitive API calls** (e.g., Firebase apps using the JS SDK directly). The browser's origin becomes `https://4200.hub.tubbs.dev`, which external APIs (Firebase, Google, third-party services) won't recognise. You can't add personal domains to shared team CORS configs.

**Why this is unfixable at the proxy level:** CORS is enforced by the browser based on the actual origin in the URL bar. No amount of header rewriting on our proxy changes what the browser sends as the `Origin` header to third-party APIs. The Firebase JS SDK makes direct calls to Google APIs from the browser — these bypass our proxy entirely.

**Workaround for CORS-sensitive apps:** Use **Tailscale** alongside the hub. Install Tailscale on your phone and dev machine, access the dev server directly via Tailscale IP (e.g., `http://100.64.x.x:4200`). This is a direct connection — the browser sees the real dev server, no proxy involved. Still not `localhost` but avoids the subdomain origin problem. Tailscale is free for personal use.

**Bottom line:** The preview feature is genuinely useful for a large class of apps. For Firebase-heavy projects like principle, it's great for Storybook and docs but won't fully work for authenticated flows. That's an acceptable tradeoff — document it clearly in the README.

### System Monitoring

Real-time system health displayed on the Dashboard and optionally in the header bar:

1. **Data source**: `systeminformation` Node.js library — cross-platform (Linux, macOS, WSL)
2. **Metrics collected**:
   - **CPU**: Overall load %, per-core usage, temperature (if available)
   - **Memory**: Total, used, free, swap usage
   - **Disk**: Per-mount usage (size, used, free, % full)
   - **Network**: Active interfaces, upload/download rates
   - **Processes**: Top processes by CPU/memory (like a mini `htop`)
   - **Uptime**: System uptime
3. **API**: `GET /api/system` returns a snapshot of all metrics. Polling interval configurable (default: 5s on dashboard, 30s for header indicator).
4. **Frontend**:
   - Dashboard page: Cards with mini sparkline charts (`recharts`) for CPU, memory, disk. Color-coded thresholds (green → yellow → red).
   - Optional header widget: Compact CPU/memory indicator always visible.
5. **Implementation**:
   - `lib/system/stats.ts` — wraps `systeminformation` calls, returns typed `SystemStats` object
   - `hooks/use-system-stats.ts` — React Query hook with configurable polling interval
   - `components/dashboard/system-stats.tsx` — Dashboard cards with charts
6. **Performance**: `systeminformation` calls are cached server-side for 2s to avoid excessive syscalls when multiple clients poll simultaneously.

### tmux Sessions

The app conceptually **replaces tmux** for remote/mobile access. tmux sessions are shown as **read-only dashboard info** (which sessions exist, their windows, what's running). This is useful for:

- Seeing what's active on the machine without SSHing in
- Knowing if a dev server or process is already running
- Potentially killing orphaned sessions

We do NOT try to attach to or interact with tmux sessions through the browser — that's what the command runner and opencode chat are for.

## Pages

### 1. Dashboard (`/`)

- **System Stats**: CPU, memory, disk usage (via `systeminformation`), presented as cards with mini charts
- **Active Workspaces**: Cards showing each registered workspace with branch, status, last activity
- **tmux Sessions**: Read-only list of active tmux sessions with window names (informational)
- **Docker Containers**: Status of running containers if any
- **Quick Actions**: Configurable buttons for common tasks

### 2. OpenCode Chat (`/chat`)

- **Session List**: Sidebar with opencode sessions grouped by workspace. Includes previous sessions (persisted by opencode) so users can resume old conversations.
- **Chat Interface**: Messages with markdown rendering, code blocks, inline diffs
- **Tool Usage Display**: Expandable cards showing when opencode uses tools (file edits, searches, terminal commands)
- **Workspace Selector**: Dropdown to switch which workspace opencode targets — spawns a new server instance if needed, loads that workspace's session history
- **Model/Agent Selector**: Switch between configured models and custom agents
- **Mobile**: Full-screen chat, bottom input bar, swipe for session list

### 3. File Browser + Editor (`/files`)

- **File Tree**: Left sidebar with directory navigation, scoped to active workspace
- **CodeMirror Editor**: Main area with floating vim mode toggle
- **Tabs**: Multiple files open simultaneously
- **Breadcrumb**: Current file path with clickable segments
- **Workspace Switcher**: Change which workspace you're browsing
- **Mobile**: File tree as overlay/drawer, full-width editor

### 4. Workspaces (`/workspaces`)

Unified management for all work entities (repos and worktrees):

- **List View**: All registered workspaces as cards with:
  - Name, path, type badge (`repo` | `worktree`)
  - Current branch, ahead/behind remote
  - Uncommitted changes count
  - Last commit message + timestamp
  - Quick action buttons: "Chat", "Files", "Commands"
- **Create New**:
  - **Add Existing**: File picker / path input to register a directory
  - **Create Worktree**: Select parent repo → enter branch name → runs setup flow
  - **Clone Repo**: URL input → clones into configurable base dir
- **Remove**: Unregister (keep files) or delete (remove from disk, with confirmation)
- **Git Panel** (lazygit-inspired features per workspace):
  - **Status**: Staged, unstaged, untracked files with diff preview
  - **Staging**: Click to stage/unstage individual files or hunks
  - **Commit**: Commit message input with conventional commit helpers
  - **Branch**: Current branch, create/switch/delete branches
  - **Log**: Commit history with diff viewer
  - **Push/Pull/Fetch**: Remote operations with status indicators
  - **Stash**: List, apply, drop stashes

### 5. Command Runner (`/commands`)

- **Input**: Command input with smart autocomplete (history, aliases, scripts)
- **Output Panels**: ANSI-colored output display, multiple panels side-by-side
- **Workspace Selector**: Run commands in any registered workspace's directory
- **Quick Commands**: Configurable shortcuts (global + per-workspace), surfaced as buttons
- **Concurrent**: Multiple commands running simultaneously in split panels
- **Mobile**: Stacked layout, swipe between running commands

### 6. Settings (`/settings`)

- **Editor**: Default vim mode on/off, font size, theme
- **Workspaces**: Default workspace, base directories for new worktrees/clones
- **Commands**: Global quick command configuration, shell rc file path for alias parsing
- **Theme**: Light/Dark/System
- **Auth**: Manage passkeys, TOTP setup/reset
- **About**: Version, system info

## Tech Stack

### Frontend

| Package                         | Purpose                        |
| ------------------------------- | ------------------------------ |
| `next` (latest)                 | Framework                      |
| `react` (latest)                | UI                             |
| `tailwindcss` (latest)          | Styling                        |
| shadcn/ui (latest)              | Components                     |
| `@codemirror/view` + extensions | Code editor                    |
| `@replit/codemirror-vim`        | Vim mode                       |
| `@opencode-ai/sdk`              | OpenCode client                |
| `marked` + `shiki`              | Markdown + syntax highlighting |
| `ansi-to-html`                  | Command output rendering       |
| `zustand`                       | Client state                   |
| `@tanstack/react-query`         | Data fetching                  |
| `recharts`                      | Stats charts                   |

### Backend

| Package                               | Purpose            |
| ------------------------------------- | ------------------ |
| `next-auth` v5                        | Auth framework     |
| `@simplewebauthn/server` + `/browser` | Passkeys           |
| `otplib`                              | TOTP               |
| `drizzle-orm` + `better-sqlite3`      | Database           |
| `ws`                                  | WebSocket server   |
| `node-pty`                            | Command runner PTY |
| `systeminformation`                   | System stats       |
| `simple-git`                          | Git operations     |

### Infrastructure

| Tool                 | Purpose       |
| -------------------- | ------------- |
| `cloudflared`        | Tunnel daemon |
| systemd user service | Auto-start    |

## Security Model (Layered)

1. **Cloudflare Tunnel** — no ports exposed to internet
2. **Cloudflare Zero Trust** (optional) — device posture checks, email allow-list
3. **Passkey auth** — phishing-resistant, device-bound
4. **TOTP fallback** — for devices without passkey support
5. **Session management** — secure httpOnly cookies, CSRF protection
6. **API middleware** — every route checks for valid session
7. **Path sandboxing** — file operations restricted to registered workspace directories only
8. **Rate limiting** — on auth endpoints
9. **Audit log** — file writes, command executions, auth events

## Project Structure

```
dev-hub/
├── server.ts                           # Custom server (Next.js + WebSocket)
├── next.config.ts
├── package.json
├── drizzle.config.ts
├── components.json                     # shadcn config
│
├── drizzle/
│   ├── schema.ts                       # users, sessions, workspaces, settings, command_history
│   └── migrations/
│
├── app/
│   ├── layout.tsx                      # Root layout, providers, nav
│   ├── page.tsx                        # Dashboard
│   ├── login/
│   │   └── page.tsx
│   ├── chat/
│   │   ├── page.tsx                    # OpenCode chat
│   │   └── [sessionId]/
│   │       └── page.tsx
│   ├── files/
│   │   └── page.tsx                    # File browser + editor
│   ├── workspaces/
│   │   └── page.tsx                    # Workspace management + git panel
│   ├── commands/
│   │   └── page.tsx
│   ├── settings/
│   │   └── page.tsx
│   └── api/
│       ├── auth/[...nextauth]/
│       │   └── route.ts
│       ├── files/
│       │   ├── tree/route.ts           # GET directory tree
│       │   └── content/route.ts        # GET/PUT file contents
│       ├── workspaces/
│       │   ├── route.ts                # GET/POST workspaces
│       │   └── [id]/
│       │       ├── route.ts            # GET/PUT/DELETE workspace
│   │       └── git/route.ts        # Git operations for workspace
│       ├── reviews/
│       │   ├── route.ts                # GET list + POST create reviews
│       │   └── [id]/
│       │       ├── route.ts            # GET single + DELETE review
│       │       ├── files/route.ts      # POST toggle reviewed
│       │       ├── refresh/route.ts    # POST refresh + staleness
│       │       └── diff/route.ts       # GET file diff
│       ├── system/
│       │   └── route.ts               # GET system stats
│   ├── review/
│   │   └── page.tsx                    # Code review (port of code-review.nvim)
│   ├── commands/
│       │   ├── route.ts                # POST execute command
│       │   └── autocomplete/route.ts   # GET command suggestions
│       └── opencode/
│           └── [...path]/route.ts      # Proxy to opencode server
│
├── components/
│   ├── ui/                             # shadcn components (auto-generated)
│   ├── layout/
│   │   ├── sidebar.tsx                 # Main navigation sidebar
│   │   ├── mobile-nav.tsx              # Bottom tab bar for mobile
│   │   ├── header.tsx
│   │   └── workspace-switcher.tsx      # Global workspace context switcher
│   ├── dashboard/
│   │   ├── system-stats.tsx
│   │   ├── workspace-cards.tsx
│   │   ├── tmux-sessions.tsx
│   │   └── quick-actions.tsx
│   ├── chat/
│   │   ├── chat-interface.tsx
│   │   ├── message.tsx
│   │   ├── message-tool-use.tsx
│   │   ├── message-diff.tsx
│   │   ├── session-list.tsx
│   │   ├── prompt-input.tsx
│   │   ├── model-selector.tsx
│   │   └── agent-selector.tsx
│   ├── editor/
│   │   ├── code-editor.tsx             # CodeMirror wrapper
│   │   ├── file-tree.tsx
│   │   ├── file-tabs.tsx
│   │   └── vim-toggle.tsx              # Floating toggle, reused everywhere
│   ├── command-runner/
│   │   ├── command-input.tsx           # With smart autocomplete
│   │   ├── command-output.tsx          # ANSI-rendered output
│   │   ├── quick-commands.tsx
│   │   └── command-panel.tsx
│   ├── workspaces/
│   │   ├── workspace-card.tsx
│   │   ├── create-workspace-form.tsx
│   │   └── git-panel.tsx               # lazygit-inspired git operations
│   ├── git/
│       ├── diff-viewer.tsx             # Side-by-side or unified diff
│       ├── commit-log.tsx
│       ├── file-status.tsx             # Staged/unstaged/untracked
│       └── branch-selector.tsx
│   └── review/
│       ├── review-setup.tsx            # Start screen: pick mode + branch
│       ├── review-file-list.tsx        # File list sidebar with keyboard nav
│       ├── review-toolbar.tsx          # Progress bar, mode, refresh
│       └── review-interface.tsx        # Main layout: file list + diff viewer
│
├── lib/
│   ├── opencode/
│   │   ├── server-pool.ts             # Pool manager: spawn/monitor/kill per-workspace instances
│   │   ├── client.ts                   # SDK client wrapper
│   │   └── types.ts
│   ├── auth/
│   │   ├── config.ts                   # NextAuth config
│   │   ├── passkey.ts                  # WebAuthn utilities
│   │   └── totp.ts                     # TOTP utilities
│   ├── git/
│   │   ├── operations.ts              # Git operations (stage, commit, push, etc.)
│   │   ├── worktrees.ts                # Worktree create/delete
│   │   └── status.ts                   # Status, diff, log helpers
│   ├── files/
│   │   └── operations.ts              # File read/write/tree
│   ├── system/
│   │   └── stats.ts                    # System info collection
│   ├── commands/
│   │   ├── runner.ts                   # Command execution via node-pty
│   │   └── autocomplete.ts            # Parse aliases, scripts, history
│   ├── ws/
│   │   └── handler.ts                 # WebSocket connection handling
│   └── db.ts                           # Drizzle client
│
├── hooks/
│   ├── use-opencode.ts
│   ├── use-websocket.ts
│   ├── use-system-stats.ts
│   ├── use-file-tree.ts
│   └── use-workspace.ts
│
├── stores/
│   ├── workspace-store.ts              # Active workspace, list
│   ├── editor-store.ts                 # Open files, active tab, vim mode
│   ├── command-store.ts                # Running commands, history
│   └── settings-store.ts              # User preferences
│
├── types/
│   └── index.ts
│
└── public/
    └── favicon.ico
```

## Database Schema (Drizzle)

```
users
  - id (uuid, pk)
  - username (text, unique)
  - created_at (timestamp)

passkeys
  - id (text, pk) — credential ID
  - user_id (uuid, fk → users)
  - public_key (blob)
  - counter (integer)
  - device_type (text)
  - created_at (timestamp)

totp_secrets
  - user_id (uuid, pk, fk → users)
  - secret (text, encrypted)
  - verified (boolean)

sessions
  - id (text, pk)
  - user_id (uuid, fk → users)
  - expires_at (timestamp)

workspaces
  - id (uuid, pk)
  - user_id (uuid, fk → users)
  - name (text)
  - path (text) — absolute path on disk
  - type (text) — 'repo' | 'worktree'
  - parent_repo_path (text, nullable) — for worktrees
  - package_manager (text, nullable)
  - quick_commands (json, nullable) — per-workspace command shortcuts
  - created_at (timestamp)
  - last_accessed_at (timestamp)

command_history
  - id (integer, pk, autoincrement)
  - workspace_id (uuid, fk → workspaces)
  - command (text)
  - exit_code (integer, nullable)
  - executed_at (timestamp)

settings
  - user_id (uuid, pk, fk → users)
  - key (text)
  - value (json)
  - (composite pk: user_id + key)

audit_log
  - id (integer, pk, autoincrement)
  - user_id (uuid, fk → users)
  - action (text) — 'file_write', 'command_exec', 'auth_login', etc.
  - detail (json)
  - created_at (timestamp)
```

## Implementation Phases

### Phase 1: Foundation ✅

- [x] Initialize Next.js + TypeScript + Tailwind + shadcn (latest versions, no `src/` dir)
- [x] Custom `server.ts` with WebSocket upgrade support
- [x] SQLite + Drizzle schema + migrations
- [x] Auth: NextAuth v5 + password (bcryptjs) credentials login + setup wizard
- [x] Auth: Passkey/TOTP infrastructure kept for optional Settings integration later
- [x] Layout shell: sidebar nav (desktop), bottom tab bar (mobile), header with workspace switcher
- [x] Auth middleware on all API routes and pages
- [x] Workspace CRUD API + basic workspace registration UI

### Phase 2: File Browser + Editor ✅

- [x] File tree API: directory listing, scoped to workspace path
- [x] File content API: read/write with path sandboxing
- [x] File tree component with lazy loading and search
- [x] CodeMirror 6 editor with syntax highlighting, dark theme
- [x] Vim mode toggle (floating button on editor, default from settings)
- [x] File tabs for multiple open files
- [x] Git status indicators on file tree (modified/untracked/staged)

### Phase 3: OpenCode Chat 🔶

- [x] OpenCode server manager: single shared server (not per-workspace pool), spawns `opencode serve` on port 4096, health checks, auto-restart
- [x] API proxy at `/api/opencode/[...path]` with auth + workspace-to-directory routing
- [x] Chat UI: message list with markdown/code rendering (react-markdown + remark-gfm)
- [x] SSE streaming for real-time response display (EventSource → proxy → OpenCode /event)
- [x] Session list sidebar with session resume
- [x] Tool usage display (expandable cards with status, input/output, duration)
- [x] Model selector (fetches providers from OpenCode config)
- [x] Agent selector (fetches agents from /agent endpoint, primary/all modes)
- [x] Prompt input with send/stop, auto-resize, keyboard shortcuts
- [x] Permission request handling (allow/deny banners)
- [x] Chat page wired up (placeholder replaced with ChatInterface)
- [x] Independent scroll areas (session list, messages, file tree all scroll independently)
- [ ] End-to-end testing of full flow (server startup → session → message → SSE → rendering)
- [ ] Inline diff viewer for file changes
- [ ] "New Chat" without a pre-existing workspace

### Phase 4: Workspaces + Git 🔶

- [x] Git operations library (`lib/git/operations.ts`) — status, stage, unstage, discard, commit, log, diff, branches, push, pull, fetch, stash
- [x] Git API routes (`app/api/workspaces/[id]/git/route.ts`) — GET + POST
- [x] Git types in `types/index.ts`
- [x] React Query hooks for all git operations (`hooks/use-git.ts`)
- [x] Workspace card component with git status info (`components/workspace/workspace-card.tsx`)
- [x] Git file-status component (`components/git/file-status.tsx`)
- [x] Diff viewer component (`components/git/diff-viewer.tsx`)
- [x] Commit panel component (`components/git/commit-panel.tsx`)
- [x] Branch selector component (`components/git/branch-selector.tsx`)
- [x] Commit log component (`components/git/commit-log.tsx`)
- [x] Git panel component (`components/git/git-panel.tsx`) — lazygit-inspired tabs (Status, Branches, Log, Stash)
- [x] Workspaces page updated to use WorkspaceCard + GitPanel side panel
- [ ] End-to-end testing of git flow (status → stage → commit → push)
- [ ] Create worktree flow (configurable setup scripts per parent repo)
- [ ] Clone repo flow
- [ ] Push/pull/fetch status indicators on workspace cards (remote ops work in git panel)

### Phase 4.5: Code Review ✅

Port of the user's `code-review.nvim` Neovim plugin to a browser-based code review workflow.

- [x] DB schema + migration — `reviews` and `review_files` tables in `drizzle/schema.ts`, migration `0001_cold_runaways.sql`
- [x] Types — `ReviewMode`, `ReviewFileStatus`, `ReviewFile`, `Review`, `ReviewWithFiles`, `ReviewCreateInput`, `ReviewChangedFile`, `AllBranch`
- [x] Git operations for review (`lib/git/review.ts`) — `getMergeBase`, `getChangedFiles`, `getUncommittedFiles`, `getRefDiff`, `getUncommittedDiff`, `computeDiffHash`, `computeUncommittedDiffHash`, `getAllBranches`, `getLastCommitRef`
- [x] API routes:
  - `app/api/reviews/route.ts` — GET (list reviews + get branches) + POST (create review)
  - `app/api/reviews/[id]/route.ts` — GET (single review with files) + DELETE
  - `app/api/reviews/[id]/files/route.ts` — POST (toggle reviewed status)
  - `app/api/reviews/[id]/refresh/route.ts` — POST (refresh, staleness detection, auto-unreview)
  - `app/api/reviews/[id]/diff/route.ts` — GET (file diff within a review)
- [x] React Query hooks (`hooks/use-review.ts`) — `useReviewList`, `useReview`, `useReviewBranches`, `useReviewDiff`, `useCreateReview`, `useDeleteReview`, `useToggleReviewFile`, `useRefreshReview`
- [x] Zustand store (`stores/review-store.ts`) — active review, selected file, persistence
- [x] Components:
  - `components/review/review-setup.tsx` — start screen with mode picker, branch selector, existing reviews list
  - `components/review/review-file-list.tsx` — sidebar file list with checkmarks, status icons, unreviewed-first sort, keyboard nav (j/k/r/n/[/])
  - `components/review/review-toolbar.tsx` — top bar with progress indicator, mode badge, refresh button, back button
  - `components/review/review-interface.tsx` — main layout combining file list + diff viewer, auto-select first unreviewed, auto-refresh on focus, Shift+R to refresh
- [x] Review page (`app/review/page.tsx`) — shows setup or active review interface
- [x] Navigation — "Review" added to desktop sidebar + mobile bottom nav (replaced "Commands" in mobile for space, Commands still in sidebar)
- [ ] End-to-end testing

### Phase 5: Command Runner

- [ ] Command execution API with `node-pty`
- [ ] WebSocket streaming for output
- [ ] Command input with smart autocomplete:
  - [ ] Parse `~/.zshrc` (or configured rc file) for aliases
  - [ ] Read `package.json` scripts from active workspace
  - [ ] Detect `Makefile`, `Cargo.toml`, etc. for available commands
  - [ ] Rank by history frequency
- [ ] ANSI-colored output rendering
- [ ] Quick command buttons (global + per-workspace)
- [ ] Multiple concurrent command panels
- [ ] Command history in SQLite

### Phase 6: Dashboard + System Monitoring

- [ ] Install `systeminformation` and `recharts`
- [ ] Create `lib/system/stats.ts` — typed wrapper around `systeminformation` (CPU, memory, disk, network, processes, uptime)
- [ ] Create `app/api/system/route.ts` — GET endpoint returning `SystemStats` snapshot, 2s server-side cache
- [ ] Create `types/system.ts` — `SystemStats`, `CpuStats`, `MemoryStats`, `DiskStats`, `NetworkStats`, `ProcessInfo` types
- [ ] Create `hooks/use-system-stats.ts` — React Query hook with configurable polling interval (5s dashboard, 30s header)
- [ ] Create `components/dashboard/system-stats.tsx` — CPU/memory/disk cards with sparkline charts (`recharts`)
- [ ] Create `components/dashboard/process-list.tsx` — Top processes by CPU/memory (mini htop)
- [ ] Create `components/dashboard/tmux-sessions.tsx` — Read-only list of active tmux sessions and their windows
- [ ] Create `components/dashboard/docker-status.tsx` — Running containers status (optional, graceful if Docker not installed)
- [ ] Create `components/dashboard/workspace-overview.tsx` — Summary cards for registered workspaces (branch, changes, last activity)
- [ ] Create `components/dashboard/quick-actions.tsx` — Configurable shortcut buttons
- [ ] Update `app/page.tsx` — Wire up dashboard with all components in responsive grid layout
- [ ] Optional: Compact system indicator in header bar (CPU/memory)

### Phase 7: Infrastructure + Polish

- [ ] Cloudflare Tunnel setup guide + `cloudflared` config
- [ ] systemd user service for auto-start on boot
- [ ] Mobile responsiveness pass across all pages
- [ ] Dark/light/system theme with persistence
- [ ] Settings page (editor prefs, workspace defaults, auth management)
- [ ] Error handling, loading states, optimistic updates
- [ ] Audit logging for all mutations

### Future: Phase 8 — Neovim in Browser

- [ ] xterm.js terminal component (reusable)
- [ ] Neovim headless server (`nvim --headless --listen`)
- [ ] WebSocket bridge between xterm.js and neovim
- [ ] Uses user's actual `~/.config/nvim/` config
- [ ] Toggle between CodeMirror (quick/mobile) and Neovim (power editing)
- [ ] Could also serve as fallback full terminal if needed

## Open Questions

All resolved — see answers inline below for historical context.

1. **OpenCode API stability** — SDK at 1.2.15. ✅ Stable enough, no pinning needed.
2. **Multi-project sessions** — ✅ One opencode server per workspace (pool manager with dynamic ports). Mirrors the tmux-session-per-project mental model.
3. **Domain** — ✅ `hub.tubbs.dev` (user owns `tubbs.dev`).
4. **node-pty in WSL** — ✅ Works fine when running directly within WSL.
5. **Worktree setup scripts** — ✅ Generic approach: workspace creation supports configurable setup steps (shell commands) stored per parent repo in settings. The `wt-add` flow is inspiration, not a hardcoded template.
6. **Multi-user** — ✅ Single user per instance. Project is open-source on GitHub so anyone can host their own. Requires a solid README covering prerequisites, setup, and hosting (Cloudflare Tunnel, systemd, etc.).

## Platform Compatibility

The entire stack is cross-platform. No WSL-specific or Linux-specific code.

| Component | Linux (inc. WSL) | macOS | Notes |
|-----------|:---:|:---:|-------|
| Node.js / Next.js | ✅ | ✅ | |
| SQLite (better-sqlite3) | ✅ | ✅ | |
| node-pty | ✅ | ✅ | Native addon, compiles on both |
| simple-git | ✅ | ✅ | Wraps git CLI |
| systeminformation | ✅ | ✅ | |
| cloudflared | ✅ | ✅ | Available via brew on macOS |
| tmux session listing | ✅ | ✅ | tmux available on both |
| Shell alias parsing | ✅ | ✅ | Works with zsh/bash on both |
| Auto-start | systemd | launchd | Different service managers, both documented |

### Prerequisites (for README)

- Node.js 22+ (LTS) or latest
- pnpm (or npm/bun — project will use pnpm)
- Git 2.x+
- OpenCode CLI installed (`~/.opencode/bin/opencode`)
- tmux (optional, for session listing on dashboard)
- Docker (optional, for container status on dashboard)
- cloudflared (for internet exposure via Cloudflare Tunnel)
- A Cloudflare account + domain (for tunnel setup)
