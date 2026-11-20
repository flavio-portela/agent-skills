# The installer owns a managed checkout of this repo

The one-liner installer does not fetch skills from GitHub on demand. It clones this repo to a stable local location (`~/.agent-skills/repo`, the **managed checkout**) and installs skills from that clone. We picked a locally owned clone over on-demand fetching because symlinked installs need a durable local target to point at, and a local clone makes the update path a plain `git pull` that works offline and without re-downloading anything.

**Considered options**

- Fetch skills from GitHub at install time. Rejected: symlinks would have to point at ephemeral download locations, and every install would re-download the full repo content.

**Consequences**

- Symlinked installed skills resolve only while the managed checkout exists; deleting `~/.agent-skills` breaks them.
- Re-running the one-liner is the update path for symlinked installs (it pulls the checkout and refreshes the tool).
- The bootstrap is overridable via `AGENT_SKILLS_REPO` and `AGENT_SKILLS_DIR` (installing from a fork), which is also how the bootstrap is tested against a local fixture.
