# Domain Docs

How the engineering skills should consume this repo's domain documentation.

## Before exploring, read these

This is a single-context repo:

- `GLOSSARY.md` at the repo root.
- ADRs under `docs/adr/` that touch the area you're about to work in.

If these files don't exist, proceed silently. Don't flag their absence or
suggest creating them upfront. The `/domain-modeling` skill creates them
lazily when terms or decisions actually get resolved.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor
proposal, a hypothesis, or a test name), use the term defined in
`GLOSSARY.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, reconsider whether
you're inventing language the project doesn't use. If it's a real gap,
note it for `/domain-modeling`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather
than silently overriding it:

> Contradicts ADR-0007 (event-sourced orders), but worth reopening because…
