Skills live in bucket folders under `skills/`:

- `engineering/`: daily code work
- `productivity/`: daily non-code workflow tools

Each skill is one folder holding a `SKILL.md` (name plus description frontmatter) and any supporting files. Each bucket has a `README.md` listing every skill in it with a one-line description, the skill name linked to its `SKILL.md`, grouped into **User-invoked** and **Model-invoked**.

## Invocation

Every `SKILL.md` is either user-invoked (`disable-model-invocation: true` in the frontmatter plus `policy.allow_implicit_invocation: false` in `agents/openai.yaml`, reachable only by the human) or model-invoked (model- or user-reachable).

[`which-skill`](./skills/engineering/which-skill/SKILL.md) is the router that maps every user-reachable skill and how they relate. Whenever you add, rename, remove, or change how a user-reachable skill fits the flows, update its `SKILL.md` so the map stays accurate: a new skill it never mentions, or a stale one it still routes to, is a router that lies.

## Style

No em-dashes anywhere in this repo's prose (`SKILL.md` files, READMEs, code comments). Where a sentence reaches for one, rewrite it instead with a comma, colon, period, parentheses, or a conjunction, whichever the sentence actually wants; never do a blind character substitution.

Every skill that dispatches a subagent says to start it with a fresh context window. Some harnesses (Codex, for one) fork the parent conversation by default, and a fork inherits the parent's context, which is what the subagent was meant to escape.

## Install

Run `scripts/link-skills.sh` to (re)link every skill into the local harness skill directories (`~/.claude/skills`, `~/.agents/skills`). Each entry is a symlink into this repo, so a `git pull` keeps installed skills current; re-run the script after adding, removing, or renaming a skill. `scripts/list-skills.sh` lists what would be linked.
