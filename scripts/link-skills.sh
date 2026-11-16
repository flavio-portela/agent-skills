#!/usr/bin/env bash
set -euo pipefail

# Links (or copies, with --copy) every skill in the repository into the
# skill directories used by each agent harness:
#   - .claude/skills: Claude Code
#   - .agents/skills: Codex and other Agent Skills-compatible harnesses
#
# By default each installed entry is a symlink into this repo, so a `git
# pull` is all that's needed to keep installed skills up to date.
#
# Usage: link-skills.sh [--copy] [DIR ...]
#
# For each DIR (default: $HOME), the skills are installed into
# DIR/.claude/skills and DIR/.agents/skills, creating those directories as
# needed.

REPO="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  echo "Usage: $(basename "$0") [--copy] [DIR ...]"
  echo
  echo "Links (or copies with --copy) every skill in this repository into the"
  echo ".claude/skills and .agents/skills directories under each DIR, creating them"
  echo "as needed."
  echo
  echo "  DIR ...   Base directories (default: $HOME). Skills are placed in"
  echo "            DIR/.claude/skills and DIR/.agents/skills."
  echo "  --copy    Copy the skill folders instead of symlinking. Copies are a snapshot"
  echo "            of the repository, so re-run the script after a git pull to refresh them."
}

COPY=0
BASES=()
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      usage
      exit 0
      ;;
    --copy)
      COPY=1
      ;;
    -*)
      echo "error: unknown option: $arg" >&2
      usage >&2
      exit 1
      ;;
    *)
      BASES+=("$arg")
      ;;
  esac
done
if [ "${#BASES[@]}" -eq 0 ]; then
  BASES=("$HOME")
fi

# Collect the repo's skills once, install into every destination.
names=()
srcs=()
while IFS= read -r -d '' skill_md; do
  src="$(dirname "$skill_md")"
  names+=("$(basename "$src")")
  srcs+=("$src")
done < <(find "$REPO/skills" -name SKILL.md -not -path '*/node_modules/*' -print0)

for BASE in "${BASES[@]}"; do
  for SUB in ".claude/skills" ".agents/skills"; do
    DEST="$BASE/$SUB"

    # If $DEST is a symlink that resolves into this repo, we'd end up writing the
    # per-skill entries back into the repo's own skills/ tree. Detect and bail
    # out instead of polluting the working copy.
    if [ -L "$DEST" ]; then
      resolved="$(readlink -f "$DEST")"
      case "$resolved" in
        "$REPO"|"$REPO"/*)
          echo "error: $DEST is a symlink into this repo ($resolved)." >&2
          echo "Remove it (rm \"$DEST\") and re-run; the script will recreate it as a real dir." >&2
          exit 1
          ;;
      esac
    fi

    mkdir -p "$DEST"

    for i in "${!names[@]}"; do
      name="${names[$i]}"
      src="${srcs[$i]}"
      target="$DEST/$name"

      if [ "$COPY" -eq 1 ]; then
        # Replace whatever is there (a stale copy, or a symlink from a
        # link-mode run) with a fresh copy of the current state.
        rm -rf -- "$target"
        cp -R -- "$src" "$target"
        echo "copied $name -> $src ($DEST)"
      else
        if [ -e "$target" ] && [ ! -L "$target" ]; then
          rm -rf -- "$target"
        fi
        ln -sfn -- "$src" "$target"
        echo "linked $name -> $src ($DEST)"
      fi
    done
  done
done
