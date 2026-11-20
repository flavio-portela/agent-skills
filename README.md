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

The interactive installer is being rebuilt and is tracked in [issues #2 to #5](https://github.com/flavio-portela/agent-skills/issues/2). Until it lands, install a skill by symlinking or copying its folder from `skills/` into `.claude/skills` or `.agents/skills` under your base directory (default `$HOME`).

## Layout

```
skills/
  engineering/    # Daily code work, one folder per skill
  productivity/   # General workflow tools, one folder per skill
docs/
  agents/         # Agent skill configuration (issue tracker, triage labels, domain docs)
CLAUDE.md         # Repo conventions (AGENTS.md is a symlink to it)
GLOSSARY.md       # Domain vocabulary
```
