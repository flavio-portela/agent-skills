#!/usr/bin/env bash
set -euo pipefail

# Tests for scripts/link-skills.sh.
#
# The script's public interface is its command line: given base directories
# and (via fzf) a selection of skills, it installs exactly those skills into
# <base>/.claude/skills and <base>/.agents/skills. The tests drive that
# interface with a stub fzf placed on PATH, which records the candidate list
# it was shown and emits a scripted selection. The last tests use a real fzf
# under a pseudo-terminal when one is available (set FZF_BIN to point at a
# binary to force them on).

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$REPO/scripts/link-skills.sh"

TMP="$(mktemp -d)"
UI_SESSIONS=()
kill_ui_sessions() {
  for s in ${UI_SESSIONS[@]+"${UI_SESSIONS[@]}"}; do
    tmux kill-session -t "$s" 2>/dev/null || true
  done
}
trap 'rm -rf "$TMP"; kill_ui_sessions' EXIT

PASS=0
FAIL=0
SKIPPED=0

ok()   { PASS=$((PASS + 1)); echo "ok ${PASS} - $1"; }
bad()  { FAIL=$((FAIL + 1)); echo "not ok ${FAIL} - $1"; echo "       $2"; }
skip() { SKIPPED=$((SKIPPED + 1)); echo "skip - $1"; }

assert_eq() { # desc actual expected
  if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected [$3], got [$2]"; fi
}
assert_contains() { # desc haystack needle
  case "$2" in *"$3"*) ok "$1" ;; *) bad "$1" "missing [$3] in: $2" ;; esac
}
assert_not_contains() { # desc haystack needle
  case "$2" in *"$3"*) bad "$1" "unexpectedly contains [$3]" ;; *) ok "$1" ;; esac
}
assert_path_eq() { # desc actual expected
  if [ -e "$2" ]; then assert_eq "$1" "$(readlink -f "$2")" "$(readlink -f "$3")"; else bad "$1" "path does not exist: $2"; fi
}
count_entries() { # dir -> number of entries
  local d="$1" n=0 e
  [ -d "$d" ] || { echo 0; return; }
  for e in "$d"/*; do [ -e "$e" ] && n=$((n + 1)); done
  echo "$n"
}

# Write a stub fzf into $TMP/bin. The body runs with $STUB_DIR set; the
# candidate list is already dumped to $STUB_DIR/stdin.txt. The body prints
# the selected candidate lines and exits 0 (or 1 for an empty selection,
# 130 for an abort).
make_stub() {
  mkdir -p "$TMP/bin"
  {
    echo '#!/usr/bin/env bash'
    echo 'set -u'
    echo "STUB_DIR='$TMP/stub'"
    echo 'mkdir -p "$STUB_DIR"'
    echo 'cat > "$STUB_DIR/stdin.txt"'
    printf '%s\n' "$1"
  } > "$TMP/bin/fzf"
  chmod +x "$TMP/bin/fzf"
}

# Stub body that selects the lines whose second tab-separated field is one
# of the given names.
stub_select() {
  make_stub "awk -F'\t' -v sel='$*' 'BEGIN { n = split(sel, w, \" \"); for (i = 1; i <= n; i++) mark[w[i]] = 1 }
{ split(\$0, f, \"\t\"); if (f[2] in mark) print }' \"\$STUB_DIR/stdin.txt\""
}

# Run the script without a TTY, with the stub (if any) on PATH. Used for the
# guard tests. Captures stdout in $OUT, stderr in $ERR, and the exit code in
# $RC.
run() {
  OUT="$TMP/out.txt"
  ERR="$TMP/err.txt"
  RC=0
  (PATH="$TMP/bin:$PATH" bash "$SCRIPT" "$@") >"$OUT" 2>"$ERR" </dev/null || RC=$?
}

# Run the script under a pseudo-terminal (util-linux script(1)), so the
# terminal guard passes. The stub's stdin is still the plain pipe the script
# feeds it. Output goes through the pty, so lines in $OUT are CRLF-terminated.
run_pty() {
  OUT="$TMP/out.txt"
  ERR="$TMP/err.txt"
  RC=0
  local cmd="env PATH='$TMP/bin:$PATH' TERM=xterm-256color bash '$SCRIPT'"
  local a
  for a in "$@"; do cmd+=" '$a'"; done
  (script -qec "$cmd" /dev/null) >"$OUT" 2>"$ERR" </dev/null || RC=$?
}

assert_out_contains() { assert_contains "$1" "$(cat "$OUT")" "$2"; }
assert_err_contains() { assert_contains "$1" "$(cat "$ERR")" "$2"; }

# ---------------------------------------------------------------------------
# Guards

# --help works without a TTY and documents the interactive flow.
RC=0
HELP_OUT="$(bash "$SCRIPT" --help 2>&1 </dev/null)" || RC=$?
assert_eq "--help exits 0" "$RC" "0"
assert_contains "--help shows usage" "$HELP_OUT" "Usage:"
assert_contains "--help documents the fzf requirement" "$HELP_OUT" "fzf"

# Unknown options are rejected before any terminal requirement.
run --bogus
assert_eq "unknown option exits 1" "$RC" "1"
assert_err_contains "unknown option error" "unknown option"

# Missing fzf is a clean error. The system PATH may contain fzf, so build a
# PATH with everything in /usr/bin except it.
mkdir -p "$TMP/nofzf-bin"
for e in /usr/bin/* /bin/*; do
  [ -e "$e" ] || continue
  n="$(basename "$e")"
  [ "$n" = "fzf" ] && continue
  ln -s "$e" "$TMP/nofzf-bin/$n" 2>/dev/null || true
done
RC=0
NOFZF_OUT="$(PATH="$TMP/nofzf-bin" bash "$SCRIPT" "$TMP/guard-base" 2>&1 </dev/null)" || RC=$?
assert_eq "missing fzf exits 1" "$RC" "1"
assert_contains "missing fzf error mentions fzf" "$NOFZF_OUT" "fzf"
assert_eq "missing fzf installs nothing" "$([ -e "$TMP/guard-base" ] && echo yes || echo no)" "no"

# Non-TTY stdin is a clean error once fzf is available.
make_stub "exit 0"
run "$TMP/tty-base"
assert_eq "non-TTY stdin exits 1" "$RC" "1"
assert_err_contains "non-TTY error mentions terminal" "terminal"
assert_eq "non-TTY stdin installs nothing" "$([ -e "$TMP/tty-base" ] && echo yes || echo no)" "no"

# ---------------------------------------------------------------------------
# Selection to install

# A selection is installed exactly: only the selected skills, as symlinks
# into the repo, in both subdirectories of the base.
stub_select code-review tdd
run_pty "$TMP/sel-base"
assert_eq "selection run exits 0" "$RC" "0"
assert_eq "claude dir has exactly the selected skills" "$(ls "$TMP/sel-base/.claude/skills" | sort)" "code-review
tdd"
assert_eq "agents dir has exactly the selected skills" "$(ls "$TMP/sel-base/.agents/skills" | sort)" "code-review
tdd"
assert_path_eq "claude code-review symlink points at the repo" "$TMP/sel-base/.claude/skills/code-review" "$REPO/skills/engineering/code-review"
assert_path_eq "agents tdd symlink points at the repo" "$TMP/sel-base/.agents/skills/tdd" "$REPO/skills/engineering/tdd"
assert_out_contains "install is reported" "linked code-review"

# --copy copies into every subdirectory of every base, as real directories.
stub_select grilling
run_pty --copy "$TMP/copy-a" "$TMP/copy-b"
assert_eq "copy run exits 0" "$RC" "0"
for base in copy-a copy-b; do
  for sub in ".claude/skills" ".agents/skills"; do
    d="$TMP/$base/$sub/grilling"
    assert_eq "$base/$sub/grilling is a real directory" "$([ -d "$d" ] && [ ! -L "$d" ] && echo yes || echo no)" "yes"
    assert_eq "$base/$sub/grilling has SKILL.md" "$([ -f "$d/SKILL.md" ] && echo yes || echo no)" "yes"
    assert_eq "$base/$sub has exactly the selected skill" "$(ls "$TMP/$base/$sub")" "grilling"
  done
done

# ---------------------------------------------------------------------------
# Picker list contract

stub_select ""
run_pty "$TMP/cand-base"
candfile="$TMP/stub/stdin.txt"

# (Pre-selection of the full list is an fzf flag the stub cannot verify; the
# real-fzf UI tests at the bottom cover it end to end.)

# Candidates are grouped by bucket (engineering first) and alphabetical
# within each bucket, and cover every skill in the repo exactly once.
expected_pairs=()
for b in engineering productivity; do
  while IFS= read -r f; do
    expected_pairs+=("$(basename "$(dirname "$f")") $b")
  done < <(find "$REPO/skills/$b" -name SKILL.md -print0 | sort -z | tr '\0' '\n')
done
actual_pairs=()
while IFS= read -r line; do
  name="$(awk -F'\t' '{print $2}' <<<"$line")"
  src="$(awk -F'\t' '{print $4}' <<<"$line")"
  bucket="${src#"$REPO"/skills/}"
  bucket="${bucket%%/*}"
  actual_pairs+=("$name $bucket")
done < "$candfile"
assert_eq "candidate order is engineering then productivity, alphabetical" "$(printf '%s\n' "${actual_pairs[@]}")" "$(printf '%s\n' "${expected_pairs[@]}")"

# Each line carries the skill's name, description and source folder, so the
# picker can show a preview.
# Hard-coded rather than derived with the same sed the script uses, so a
# broken frontmatter extraction fails this assertion instead of passing
# vacuously. Note the unescaped quotes: the script unescapes YAML's \".
desc_expected="Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo's documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to \"review since X\"."
line_cr="$(awk -F'\t' '$2 == "code-review"' "$candfile")"
assert_eq "code-review line has its frontmatter description" "$(awk -F'\t' '{print $3}' <<<"$line_cr")" "$desc_expected"
assert_eq "code-review line carries its source folder" "$(awk -F'\t' '{print $4}' <<<"$line_cr")" "$REPO/skills/engineering/code-review"

# ---------------------------------------------------------------------------
# Additive semantics and abort paths

# A run only installs what was selected: already-installed skills that were
# not selected are left exactly as they are.
add_base="$TMP/add-base"
mkdir -p "$add_base/.claude/skills/teach"
echo marker > "$add_base/.claude/skills/teach/NOTE.md"
ln -s "$REPO/skills/engineering/pr" "$add_base/.claude/skills/pr"
stub_select code-review
run_pty "$add_base"
assert_eq "additive run exits 0" "$RC" "0"
assert_eq "additive run installed the selected skill" "$([ -L "$add_base/.claude/skills/code-review" ] && echo yes || echo no)" "yes"
assert_eq "unselected real dir is untouched" "$(cat "$add_base/.claude/skills/teach/NOTE.md")" "marker"
assert_path_eq "unselected symlink is untouched" "$add_base/.claude/skills/pr" "$REPO/skills/engineering/pr"

# Aborting the picker installs nothing.
stub_select_abort() { make_stub "exit 130"; }
stub_select_abort
run_pty "$TMP/abort-base"
assert_eq "abort propagates fzf exit code" "$RC" "130"
assert_out_contains "abort is reported" "Aborted"
assert_eq "abort installs nothing" "$([ -e "$TMP/abort-base" ] && echo yes || echo no)" "no"

# Confirming an empty selection is a friendly no-op (defensive: fzf only
# reports an empty selection with exit code 1 in some versions/modes, but
# the exit code must stay handled).
stub_select_empty() { make_stub "exit 1"; }
stub_select_empty
run_pty "$TMP/empty-base"
assert_eq "empty selection exits 0" "$RC" "0"
assert_out_contains "empty selection is reported" "Nothing selected"
assert_eq "empty selection installs nothing" "$([ -e "$TMP/empty-base" ] && echo yes || echo no)" "no"

# ---------------------------------------------------------------------------
# Real fzf user interface (skipped without a real fzf binary or tmux)
#
# Drives the real script with a real fzf inside a tmux session: tmux provides
# a fully emulated terminal, so keystrokes are delivered reliably. The
# script's stdout/stderr go to files for the assertions. FZF_BIN can point at
# a specific fzf binary; by default the one on PATH is used. These are the
# slow tests (each waits for fzf to start up).

FZF_BIN="${FZF_BIN:-}"
if [ -z "$FZF_BIN" ]; then
  FZF_BIN="$(command -v fzf || true)"
fi

# Start the script with the real fzf in a tmux session, and wait for the
# picker prompt to appear in the pane.
run_ui() { # name base
  local name="lks$$_$1" base="$2" i
  UI_SESSIONS+=("$name")
  tmux new-session -d -s "$name" -x 120 -y 40 \
    "env PATH='$TMP/realbin:$PATH' TERM=xterm-256color bash '$SCRIPT' '$base' > '$TMP/$1.out' 2> '$TMP/$1.err'; echo \"RC=\$?\" > '$TMP/$1.rc'"
  for i in $(seq 1 50); do
    tmux capture-pane -p -t "$name" 2>/dev/null | grep -q "Select skills to install" && return 0
    sleep 0.2
  done
  return 1
}

# Wait up to 5s for the session's command to finish. Returns 0 when it did.
reap_ui() { # name
  local name="lks$$_$1" i
  for i in $(seq 1 25); do
    tmux has-session -t "$name" 2>/dev/null || return 0
    sleep 0.2
  done
  return 1
}

ui_rc() { sed -n 's/^RC=//p' "$TMP/$1.rc" 2>/dev/null; }

if [ -n "$FZF_BIN" ] && command -v tmux >/dev/null 2>&1; then
  mkdir -p "$TMP/realbin"
  ln -sf "$FZF_BIN" "$TMP/realbin/fzf"
  expected_count="$(find "$REPO/skills" -name SKILL.md -not -path '*/node_modules/*' | wc -l | tr -d ' ')"

  # Plain Enter confirms the pre-selected list: every skill gets installed.
  if run_ui enter "$TMP/ui-base"; then
    tmux send-keys -t "lks$$_enter" Enter
    if reap_ui enter; then
      assert_eq "ui: Enter confirms the pre-selected list" "$(ui_rc enter)" "0"
      assert_eq "ui: every skill installed into the claude dir" "$(count_entries "$TMP/ui-base/.claude/skills")" "$expected_count"
      assert_eq "ui: every skill installed into the agents dir" "$(count_entries "$TMP/ui-base/.agents/skills")" "$expected_count"
      assert_contains "ui: install is reported" "$(cat "$TMP/enter.out")" "linked code-review"
    else
      bad "ui: Enter confirms the pre-selected list" "session did not end: $(tmux capture-pane -p -t "lks$$_enter" 2>/dev/null | tail -3 | tr '\n' '|')"
    fi
  else
    bad "ui: Enter confirms the pre-selected list" "picker prompt never appeared"
  fi

  # Esc aborts: nothing is installed.
  if run_ui esc "$TMP/ui-esc-base"; then
    tmux send-keys -t "lks$$_esc" Escape
    if reap_ui esc; then
      assert_eq "ui: Esc aborts" "$(ui_rc esc)" "130"
      assert_contains "ui: abort is reported" "$(cat "$TMP/esc.err")" "Aborted"
      assert_eq "ui: abort installs nothing" "$([ -e "$TMP/ui-esc-base" ] && echo yes || echo no)" "no"
    else
      bad "ui: Esc aborts" "session did not end: $(tmux capture-pane -p -t "lks$$_esc" 2>/dev/null | tail -3 | tr '\n' '|')"
    fi
  else
    bad "ui: Esc aborts" "picker prompt never appeared"
  fi

  # Deselect everything (ctrl-d) then Enter: fzf's standard fallback
  # confirms the highlighted item, and the script installs exactly that.
  first_skill="$(find "$REPO/skills/engineering" -name SKILL.md -not -path '*/node_modules/*' | sort | head -n 1 | xargs -n1 dirname | xargs -n1 basename)"
  if run_ui empty "$TMP/ui-empty-base"; then
    tmux send-keys -t "lks$$_empty" C-d Enter
    if reap_ui empty; then
      assert_eq "ui: empty Enter confirms the highlighted item" "$(ui_rc empty)" "0"
      assert_eq "ui: only the highlighted item is installed" "$(ls "$TMP/ui-empty-base/.claude/skills")" "$first_skill"
    else
      bad "ui: empty Enter confirms the highlighted item" "session did not end: $(tmux capture-pane -p -t "lks$$_empty" 2>/dev/null | tail -3 | tr '\n' '|')"
    fi
  else
    bad "ui: empty Enter confirms the highlighted item" "picker prompt never appeared"
  fi
else
  skip "real fzf UI tests (need fzf and tmux; set FZF_BIN to force a binary)"
fi

echo
echo "passed: $PASS, failed: $FAIL, skipped: $SKIPPED"
[ "$FAIL" -eq 0 ]
