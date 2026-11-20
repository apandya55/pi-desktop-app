# Pi Desktop

A lightweight macOS desktop interface for the [Pi coding agent](https://github.com/earendil-works/pi). It connects directly to your local Pi runtime so you can follow streaming responses, inspect tool calls and diffs, switch workspaces, and review Git changes in a single window.

## Prerequisites

- macOS
- Node.js 22.21.1 or later
- Git (used for branch tracking, workspace file discovery, and the changes drawer)
- An existing Pi configuration or API keys (the app reads `~/.pi/agent/` for credentials, models, prompt templates, and skills)

## Getting started

Install dependencies and start the development app:

```sh
npm ci
npm run dev
```

On first launch, Electron downloads its runtime automatically.

To build and run the production build locally:

```sh
npm run typecheck
npm run build
npm start
```

### Working with projects

Pi opens in the directory where you launched it. Use the folder picker in the top bar to switch workspaces or reopen recent folders. When you open an earlier session from the sidebar, Pi automatically switches to that session's workspace.

If you are setting up Pi for the first time, log in through the Pi CLI or add your model endpoints in **Settings → Models** (⌘,).

## Shortcuts and navigation

| Shortcut / Command | Action |
| --- | --- |
| ⌘N | New session in the current workspace |
| ⌘O | Open a different workspace folder |
| ⌘B | Toggle the session history sidebar |
| ⌘` | Toggle the Git changes drawer |
| ⌘, | Open Settings |
| Enter | Send message, or steer an active response at the next turn |
| ⌥Enter / ⌘Enter | Queue a follow-up to run after the active turn finishes |
| Shift+Enter | Insert a newline in the composer |
| Shift+Tab | Cycle the reasoning/thinking level |
| ⌘K | Clear visible transcript while keeping conversation context |
| ⌘⇧K | Compact current conversation context |
| Escape | Stop the active response |
| `@filename` | Mention a workspace file with fuzzy search |
| `/command` | Browse commands, prompt templates, skills, and extension actions |
| `/mode code` or `/mode read-only` | Toggle tool permissions for the session |
| `!command` | Run a shell command in the workspace |
| `!!command` | Run a shell command without echoing its output to model context |

Custom reasoning models can declare `reasoning` and `thinkingLevelMap` in [`models.json`](https://github.com/earendil-works/pi/blob/v1.5.2/packages/coding-agent/docs/models.md).

## Tool modes

Each session runs under one of two execution modes:

- **Code** (default): Enables read, bash, edit, and write tools, plus any installed extension tools.
- **Read-only**: Restricted to read, grep, find, and list operations. Direct shell execution and external extension actions are blocked. Skills and prompt templates remain available.

You can switch modes anytime with `/mode code`, `/mode read-only`, or the mode picker in the composer toolbar.

## Configuration

Settings edit Pi's native configuration files directly:

| Tab | Target File | Purpose |
| --- | --- | --- |
| Global | `~/.pi/agent/settings.json` | Default model, provider, and thinking levels across all sessions |
| Workspace | `.pi/settings.json` (inside workspace) | Workspace-specific overrides |
| Models | `~/.pi/agent/models.json` | Custom providers, base URLs, and model definitions |

After editing settings, use **Reload session** or `⌘⇧R` to reload skills, extensions, and updated configurations.

## Architecture

- **Main process** (`electron/`): Manages the Pi SDK runtime, session persistence, workspace discovery, and Git operations. Each session maintains its own Pi agent instance.
- **Preload bridge** (`electron/preload.ts`): Exposes a typed `window.pi` interface with context isolation, sandboxing enabled, and Node integration disabled.
- **Renderer** (`src/renderer/`): Built with React 19, Tailwind CSS v4, Radix UI primitives, `cmdk`, React Markdown, and Prism for syntax highlighting.
- **Shared contract** (`src/shared/`): Type definitions, IPC channels, and transcript event aggregators shared between Electron and React.

Sessions are stored in Pi's standard JSONL format and remain fully compatible with the Pi CLI.

## License

[MIT](LICENSE).
