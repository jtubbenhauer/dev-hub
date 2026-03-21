# Dev Hub

Personal development command center — a self-hosted web app for managing workspaces, editing code, reviewing changes, running commands, and chatting with AI coding assistants. Supports both local and remote workspaces.

## Features

- **Dashboard** — live system stats (CPU, memory, disk, network) with sparkline charts, process list, quick-action grid, workspace overview, and ClickUp task widget
- **AI Chat** — full chat interface powered by [OpenCode](https://opencode.ai), with model/agent selection, streaming responses, tool use display, session management, plan panel, and file context picker
- **File Browser & Editor** — CodeMirror 6 editor with multi-language syntax highlighting, Vim mode, file tabs, tree navigation, and git status indicators
- **Git** — branch, commit, push, pull, fetch, stash, diff viewer, branch management, and commit log — all from the UI
- **Code Review** — side-by-side diff viewer for branch diffs, uncommitted changes, or last commit. Track reviewed files with persistent checkmarks, auto-detect when files change underneath a review.
- **Workspaces** — register local directories, clone repos, create git worktrees, connect to remote containers, or provision workspaces via external CLI providers
- **Remote Workspaces** — operate on workspaces running in Docker containers on other machines. All file, git, and command operations work transparently over HTTP via a lightweight sidecar agent.
- **Workspace Providers** — pluggable CLI tools (e.g., `rig-cli`) for creating and destroying remote workspaces. Register providers in settings, create workspaces with a click.
- **Embedded Terminal** — run commands per-workspace with shell autocomplete, process management, output streaming, and command history
- **ClickUp Integration** — browse tasks by view, search, view task details and comments, link tasks to workspaces
- **GitHub Integration** — PR review via GitHub API proxy with personal access token
- **Command Palette** — `Ctrl+K` for fuzzy-search navigation across the app
- **Leader Key** — Vim-style `<leader>` key sequences with a which-key overlay showing available bindings. 40+ built-in actions, customizable via settings.
- **Settings** — General preferences, AI model config, keybinding customization, per-workspace settings, integration tokens (GitHub, ClickUp), workspace provider management
- **Auth** — password login with a first-run setup flow. Single-user design for self-hosted use.
- **Mobile Responsive** — touch-friendly navigation, keyboard detection, resizable panels

## Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/)
- [Git](https://git-scm.com/)
- [OpenCode CLI](https://opencode.ai) — install with `curl -fsSL https://opencode.ai/install | bash`

## Getting Started

### 1. Clone & install dependencies

```bash
git clone <repo-url> && cd dev-hub
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

Edit `.env.local` and set:

| Variable      | Description                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| `AUTH_SECRET` | JWT signing secret. Generate with `openssl rand -base64 32`                                          |
| `AUTH_URL`    | The URL where Dev Hub will be accessible (e.g. `https://hub.example.com` or `http://localhost:3000`) |
| `DB_PATH`     | Path to SQLite database file (defaults to `./dev-hub.db`)                                            |

### 3. Set up the database

```bash
pnpm db:push
```

### 4. Run

**Development:**

```bash
pnpm dev
```

**Production:**

```bash
pnpm build && pnpm start
```

The app starts on `http://localhost:3000` by default. Set `PORT` and `HOSTNAME` env vars to change this.

On first visit you'll be prompted to create a user account.

## Project Structure

Dev Hub is a pnpm monorepo with three packages:

```
dev-hub/
├── app/                    ← Next.js app (pages, API routes)
├── components/             ← React components
├── hooks/                  ← Custom React hooks
├── lib/                    ← Server-side libraries (git, files, commands, auth, OpenCode)
├── stores/                 ← Zustand client state stores
├── drizzle/                ← Database schema and migrations
├── types/                  ← TypeScript type definitions
├── packages/
│   ├── agent/              ← @devhub/agent — remote workspace sidecar (Hono HTTP server)
│   └── shared/             ← @devhub/shared — wire-format types shared between app and agent
└── public/                 ← Static assets
```

## Remote Workspaces

Dev Hub can operate on workspaces running in Docker containers on remote machines. This is powered by two components:

- **RemoteBackend** — an abstraction layer that transparently routes all file, git, and command operations over HTTP instead of the local filesystem
- **devhub-agent** — a lightweight Hono HTTP server (`packages/agent`) that runs inside the container alongside OpenCode, exposing file, git, and command endpoints

### Connecting a Remote Workspace

**Manual connection:** Click "Connect Remote" on the workspaces page and provide the agent URL (default port 7500) and OpenCode URL.

**Via provider:** Register a CLI tool (like `rig-cli`) in Settings → Providers. Then click "Create via Provider" to spin up a container and connect automatically.

### Running the Agent

The agent runs inside the container with two environment variables:

```bash
export WORKSPACE_PATH=/workspace/repo   # required
export AGENT_PORT=7500                   # optional, default 7500
npx tsx src/index.ts
```

See `packages/agent/README.md` or `.opencode/plans/provider-contract-spec.md` for the full contract spec.

## Remote Access

Dev Hub works on localhost for local development. To access it remotely (e.g., from a tablet or phone):

### Cloudflare Tunnel (recommended)

```bash
cloudflared tunnel create dev-hub
cloudflared tunnel route dns dev-hub hub.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 dev-hub
```

Set `AUTH_URL` in your `.env.local` to match the domain (e.g. `https://hub.yourdomain.com`).

### Other options

Any reverse proxy or tunnel will work — nginx, Caddy, Tailscale Funnel, ngrok, etc.

## Scripts

| Script        | Command                             | Description                           |
| ------------- | ----------------------------------- | ------------------------------------- |
| `dev`         | `next dev --turbopack`              | Development server with Turbopack HMR |
| `build`       | `next build`                        | Production build                      |
| `start`       | `next start`                        | Production server                     |
| `lint`        | `eslint`                            | Run linter                            |
| `test`        | `vitest run`                        | Run tests                             |
| `test:watch`  | `vitest`                            | Run tests in watch mode               |
| `typecheck`   | `tsc --noEmit && ...`               | Type check all packages               |
| `db:generate` | `drizzle-kit generate`              | Generate database migrations          |
| `db:push`     | `drizzle-kit push`                  | Push schema directly to database      |
| `db:studio`   | `drizzle-kit studio`                | Open Drizzle Studio database GUI      |
| `agent:dev`   | `pnpm --filter @devhub/agent dev`   | Run agent in dev mode (tsx watch)     |
| `agent:start` | `pnpm --filter @devhub/agent start` | Run agent in production mode          |

## Tech Stack

- **Framework:** Next.js 16 (App Router) + React 19 + TypeScript
- **UI:** Tailwind CSS v4, shadcn/ui, Radix UI
- **Editor:** CodeMirror 6 (multi-language, Vim mode, diff/merge views)
- **State:** Zustand + TanStack React Query
- **Database:** SQLite (better-sqlite3 + Drizzle ORM)
- **AI:** OpenCode CLI + SDK
- **Auth:** NextAuth.js v5
- **Git:** simple-git
- **Agent:** Hono + @hono/node-server
- **Monitoring:** systeminformation
- **Testing:** Vitest
