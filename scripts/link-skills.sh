#!/usr/bin/env bash
set -euo pipefail

# Interactively installs the selected skills from the repository into the
# skill directories used by each agent harness:
#   - .claude/skills: Claude Code
#   - .agents/skills: Codex and other Agent Skills-compatible harnesses
#
# A fzf multi-select lists every skill in the repo, grouped by bucket, with
# all of them pre-selected, so a plain Enter installs everything. The
# selection only filters what this run installs: skills already installed
# that are not selected are left alone, and the script never removes
# anything.
#
# By default each installed entry is a symlink into this repo, so a `git
# pull` is all that's needed to keep installed skills up to date.
#
# Requires: fzf and an interactive terminal.
#
# Usage: link-skills.sh [--copy] [DIR ...]
#
# For each DIR (default: $HOME), the selected skills are installed into
# DIR/.claude/skills and DIR/.agents/skills, creating those directories as
# needed.

REPO="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  echo "Usage: $(basename "$0") [--copy] [DIR ...]"
  echo
  echo "Interactively select the skills from this repository to install into the"
  echo ".claude/skills and .agents/skills directories under each DIR, creating them"
  echo "as needed. All skills are pre-selected, so pressing Enter installs everything."
  echo "Requires fzf and an interactive terminal."
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

if ! command -v fzf >/dev/null 2>&1; then
  echo "error: fzf is required but was not found on PATH." >&2
  echo "Install fzf (e.g. 'brew install fzf' or 'apt install fzf', or from" >&2
  echo "https://github.com/junegunn/fzf) and re-run." >&2
  exit 1
fi
if [ ! -t 0 ]; then
  echo "error: an interactive terminal is required, but stdin is not a TTY." >&2
  exit 1
fi

# Collect the repo's skills, grouped by bucket (engineering, then
# productivity), alphabetical within each bucket. Each candidate line is:
#
#   name (bucket) <TAB> name <TAB> description <TAB> src
#
TAB=$'\t'
order=()
for b in engineering productivity; do
  [ -d "$REPO/skills/$b" ] && order+=("$b")
done

lines=()
declare -A src_by_name=()
for b in "${order[@]}"; do
  while IFS= read -r -d '' skill_md; do
    src="$(dirname "$skill_md")"
    name="$(basename "$src")"
    desc="$(sed -n 's/^description:[[:space:]]*//p' "$skill_md" | head -n 1)"
    desc="${desc#\"}"
    desc="${desc%\"}"
    desc="${desc//\\\"/\"}"
    lines+=("$name ($b)${TAB}${name}${TAB}${desc}${TAB}${src}")
    src_by_name["$name"]="$src"
  done < <(find "$REPO/skills/$b" -name SKILL.md -not -path '*/node_modules/*' -print0 | sort -z)
done

# Ask the user which skills to install. --sync makes the full candidate list
# available when the start event fires, so start:select-all pre-selects
# everything and a plain Enter installs it all.
rc=0
selection="$(
  printf '%s\n' "${lines[@]}" |
    fzf --multi \
        --sync \
        --delimiter "$TAB" \
        --with-nth 1 \
        --preview 'printf "%s: %s\n" "$FZF_PREVIEW_2" "$FZF_PREVIEW_3"' \
        --preview-window right:40% \
        --bind 'start:select-all,ctrl-a:select-all,ctrl-d:deselect-all' \
        --prompt 'Select skills to install: '
)" || rc=$?

case "$rc" in
  0) ;;
  1)
    echo "Nothing selected. Nothing installed."
    exit 0
    ;;
  *)
    echo "Aborted. Nothing installed." >&2
    exit "$rc"
    ;;
esac

# Reduce the selection to the ordered list of skill names to install.
want_names=()
while IFS= read -r line; do
  [ -n "$line" ] || continue
  IFS="$TAB" read -r _ name _ _ <<<"$line"
  [ -n "${src_by_name[$name]:-}" ] || continue
  want_names+=("$name")
done <<<"$selection"

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

    for name in "${want_names[@]}"; do
      src="${src_by_name[$name]}"
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
