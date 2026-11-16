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

`scripts/link-skills.sh` installs the skills you pick into the `.claude/skills` and `.agents/skills` directories under each base directory it is given. It is interactive-only and requires [fzf](https://github.com/junegunn/fzf): an fzf multi-select lists every skill in the repo with its description, all pre-selected, so pressing Enter installs everything and unchecking narrows it down.

```sh
scripts/link-skills.sh                # installs into ~/.claude/skills and ~/.agents/skills
scripts/link-skills.sh ~/myproject    # installs into ~/myproject/.claude/skills and ~/myproject/.agents/skills
```

- With no argument the base directory is `$HOME`, so the default install is `~/.claude/skills` and `~/.agents/skills`.
- The selection is additive: skills already installed that you do not pick are left alone, and the script never removes anything.
- By default each entry is a symlink into this repo, so a `git pull` keeps installed skills current.
- Pass `--copy` to copy the skill folders instead. Copies are a snapshot, so re-run the script after a `git pull`.
- `scripts/list-skills.sh` lists the available skills.
- Re-run the script after adding, removing, or renaming a skill.

## Layout

```
skills/
  engineering/    # Daily code work, one folder per skill
  productivity/   # General workflow tools, one folder per skill
scripts/
  link-skills.sh  # Interactively link or copy skills into harness skill directories
  list-skills.sh  # List the available skills
tests/
  test-link-skills.sh  # Tests for the install script
CLAUDE.md         # Repo conventions (AGENTS.md is a symlink to it)
GLOSSARY.md       # Domain vocabulary
```
