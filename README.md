# Dev Hub

Personal development command center — a self-hosted web app for managing workspaces, editing code, reviewing changes, and chatting with AI coding assistants.

## Features

- **Dashboard** — live system stats (CPU, memory, disk, network) with sparkline charts and process list
- **AI Chat** — full chat interface powered by [OpenCode](https://opencode.ai), with model/agent selection, streaming responses, tool use display, and session management
- **File Browser & Editor** — CodeMirror 6 editor with multi-language support, Vim mode, file tabs, and git status indicators
- **Workspaces** — register local directories, clone repos, create git worktrees
- **Code Review** — unified editable diff viewer for branch diffs, uncommitted changes, or last commit
- **Git** — branch, commit, push, pull, stash, and more — all from the UI
- **Command Palette** — `Ctrl+,` for quick navigation
- **Auth** — password login with a first-run setup flow. Only a single user account can be created, since the app is designed to be exposed over the web.

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

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | JWT signing secret. Generate with `openssl rand -base64 32` |
| `AUTH_URL` | The URL where Dev Hub will be accessible (e.g. `https://hub.example.com` or `http://localhost:3000`) |
| `DB_PATH` | Path to SQLite database file (defaults to `./dev-hub.db`) |

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

## Remote Access

Dev Hub works perfectly fine on localhost for local development. If you want to access it remotely (e.g. from a tablet or phone on the go), you'll need a tunnel or reverse proxy to expose it to the internet.

### Cloudflare Tunnel (recommended)

With a domain and a [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/), you get a stable URL that doesn't change:

```bash
cloudflared tunnel create dev-hub
cloudflared tunnel route dns dev-hub hub.yourdomain.com
cloudflared tunnel run --url http://localhost:3000 dev-hub
```

Set `AUTH_URL` in your `.env.local` to match the domain (e.g. `https://hub.yourdomain.com`).

### Other options

Any reverse proxy or tunnel will work — nginx, Caddy, Tailscale Funnel, ngrok, etc.

## Scripts

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `next dev --turbopack` | Development server with HMR |
| `build` | `next build` | Production build |
| `start` | `next start` | Production server |
| `lint` | `eslint` | Run linter |
| `db:generate` | `drizzle-kit generate` | Generate database migrations |
| `db:push` | `drizzle-kit push` | Push schema directly to database |
| `db:studio` | `drizzle-kit studio` | Open Drizzle Studio database GUI |

## Tech Stack

- **Framework:** Next.js (App Router) + React 19 + TypeScript
- **UI:** Tailwind CSS v4, shadcn/ui, Radix UI
- **Editor:** CodeMirror 6
- **State:** Zustand + TanStack React Query
- **Database:** SQLite (better-sqlite3 + Drizzle ORM)
- **AI:** OpenCode CLI
- **Auth:** NextAuth.js v5
- **Git:** simple-git

## TODO

- [ ] **Docker container** — Dockerfile + docker-compose for easier deployment. Considerations: `better-sqlite3` needs native compilation, SQLite DB needs a persistent volume, container needs git and a real shell, `systeminformation` would report container metrics rather than host metrics.
