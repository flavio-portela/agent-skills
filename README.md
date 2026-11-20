# agent-skills

A personal collection of agent skills for Claude Code, Codex, and other Agent Skills-compatible harnesses. Each skill is one folder holding a `SKILL.md` (name plus description frontmatter) and any supporting files. Harnesses load them on demand, so the repo stays small and the skills stay reachable.

## Buckets

Skills live under `skills/`, in two buckets:

- [`engineering/`](./skills/engineering/README.md): daily code work.
- [`productivity/`](./skills/productivity/README.md): general workflow tools, not code-specific.

Each bucket's README lists every skill with a one-line description, grouped into **User-invoked** and **Model-invoked**.

## Invocation

Every skill is one of two kinds:

- **User-invoked**: marked `disable-model-invocation: true` in the frontmatter and `policy.allow_implicit_invocation: false` in `agents/openai.yaml`. Reachable only when you type it, e.g. `/tdd`.
- **Model-invoked**: reachable by the model or by you. The description carries rich trigger phrasing so the model can reach for it at the right moment.

[`which-skill`](./skills/engineering/which-skill/SKILL.md) is the router over every user-reachable skill. When a skill is added, renamed, or moved, its map is updated so it never points at a skill that no longer fits.

## Install

Run the one-liner:

```
curl -fsSL https://raw.githubusercontent.com/flavio-portela/agent-skills/main/install.sh | sh
```

The bootstrap installs the `agent-skills` command (a launcher at `~/.local/bin/agent-skills`) backed by a managed checkout of this repo at `~/.agent-skills/repo`, then launches the interactive installer in your current directory. The installer asks which skills to install (every skill preselected, grouped by bucket), how (symlink by default, or copy), and into which harness skill directories (`.agents/skills`, `.claude/skills`, or both by default), and confirms the exact target paths before writing anything.

Every decision is a flag, and a fully flagged run is non-interactive:

```
agent-skills install --all --symlink --harness both --dir ~/my-project
```

| Flag | Meaning |
| --- | --- |
| `--all` | Install every skill |
| `--skill a,b` | Install exactly the named skills |
| `--symlink` / `--copy` | Link skills into the managed checkout (default) / copy self-contained folders |
| `--harness agents\|claude\|both` | Which harness skill directories receive the skills (default: both) |
| `--dir <path>` | Base directory to install into (default: current directory) |
| `--force` | Replace existing entries at the target paths |

Symlinked installs stay live-linked to the managed checkout: re-running the one-liner refreshes the checkout and the tool, which is the update path for symlinked installs. Copy mode is self-contained and does not update on its own. Existing entries (hand-written or previously installed) are skipped and reported, never overwritten; `--force` replaces them deliberately.

Skills reference each other by name (the router maps every user-invoked skill), so the full skill set is the supported configuration. Installing a subset works, but any skill a flow references must be present for that flow to work.

To install from a fork, point the bootstrap at it:

```sh
export AGENT_SKILLS_REPO=https://github.com/you/agent-skills.git
curl -fsSL https://raw.githubusercontent.com/you/agent-skills/main/install.sh | sh
```

`AGENT_SKILLS_DIR` moves the managed directory away from `~/.agent-skills`.

## Layout

```
skills/
  engineering/    # Daily code work, one folder per skill
  productivity/   # General workflow tools, one folder per skill
docs/
  agents/         # Agent skill configuration (issue tracker, triage labels, domain docs)
  adr/            # Architecture decision records
install.sh        # Bootstrap one-liner (see Install)
bin/agent-skills.js # CLI entry file (TTY layer: flags plus prompts)
lib/install.js    # Core install behaviour, tested directly
test/             # node --test suites, one file per seam
package.json      # CLI manifest (name: agent-skills)
CLAUDE.md         # Repo conventions (AGENTS.md is a symlink to it)
GLOSSARY.md       # Domain vocabulary
```
