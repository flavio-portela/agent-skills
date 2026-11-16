# Agent Skills

Vocabulary for this repo: the skills, the buckets they live in, how they are invoked, and the flows they form.

## Language

### Repo structure

**Skill**:
A self-contained, on-demand unit of agent behaviour. One folder, loaded by a harness only when invoked.
_Avoid_: command, plugin, tool

**Bucket**:
One of the two groupings under skills/: engineering (daily code work) and productivity (general workflow tools).
_Avoid_: category, section

**User-invoked**:
A skill reachable only when a human types its name. The model can never reach it.
_Avoid_: manual, human-only

**Model-invoked**:
A skill the model can reach on its own judgement, via the trigger phrasing in its description, or a human can reach.
_Avoid_: automatic, passive

**Router**:
The skill which-skill. The single map of every user-reachable skill and how those skills fit together across flows.
_Avoid_: index, catalog

### Installation

**Installed skill**:
A skill selected in the interactive picker, then linked or copied from this repo into a harness's skill directory.
_Avoid_: deployed, registered
