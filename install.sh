#!/bin/sh
# agent-skills bootstrap.
#
# Installs the agent-skills CLI from a managed checkout of this repo and
# launches its interactive installer in the current directory.
#
# One-liner:
#   curl -fsSL https://raw.githubusercontent.com/flavio-portela/agent-skills/main/install.sh | sh
#
# Re-running the one-liner refreshes the tool and the managed checkout,
# which is the update path for symlinked installs.
#
# Environment overrides:
#   AGENT_SKILLS_REPO   Git URL of the repo to install from.
#                       Default: https://github.com/flavio-portela/agent-skills
#   AGENT_SKILLS_DIR    Managed directory holding the checkout and tool state.
#                       Default: $HOME/.agent-skills

set -eu

REPO_URL="${AGENT_SKILLS_REPO:-https://github.com/flavio-portela/agent-skills}"
MANAGED_DIR="${AGENT_SKILLS_DIR:-$HOME/.agent-skills}"
REPO_DIR="$MANAGED_DIR/repo"
SHIM_DIR="$HOME/.local/bin"
SHIM_PATH="$SHIM_DIR/agent-skills"

info() { printf 'agent-skills: %s\n' "$*"; }
fail() {
  printf 'agent-skills: %s\n' "$*" >&2
  exit 1
}

# --- Preflight: Node 18+ and npm ----------------------------------------------

command -v node >/dev/null 2>&1 || fail "node not found. Install Node.js 18 or newer from https://nodejs.org (or your platform's package manager), then re-run the one-liner."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 18 or newer is required (found $(node --version)). Upgrade from https://nodejs.org, then re-run the one-liner."

command -v npm >/dev/null 2>&1 || fail "npm not found. npm ships with Node.js from https://nodejs.org; install Node.js, then re-run the one-liner."

# --- Managed checkout -----------------------------------------------------------

if [ -d "$REPO_DIR/.git" ]; then
  info "Refreshing the managed checkout at $REPO_DIR"
  git -C "$REPO_DIR" pull || fail "git pull failed in $REPO_DIR. If it is not a checkout of the expected repo, delete $REPO_DIR, then re-run the one-liner."
else
  info "Cloning $REPO_URL into $REPO_DIR"
  mkdir -p "$MANAGED_DIR"
  git clone "$REPO_URL" "$REPO_DIR" || fail "git clone of $REPO_URL failed."
fi

# --- Dependencies: production only, from the committed lockfile ------------------

info "Installing production dependencies"
(cd "$REPO_DIR" && npm ci --omit=dev --no-audit --no-fund) || fail "npm ci failed in $REPO_DIR."

# --- Shim --------------------------------------------------------------------------

mkdir -p "$SHIM_DIR"
cat > "$SHIM_PATH" <<EOF
#!/bin/sh
exec node "$REPO_DIR/bin/agent-skills.js" "\$@"
EOF
chmod +x "$SHIM_PATH"
info "Installed the agent-skills command at $SHIM_PATH"

case ":$PATH:" in
  *":$SHIM_DIR:"*) ;;
  *)
    info "Note: $SHIM_DIR is not on your PATH. Add it to your shell profile, for example:"
    info '  export PATH="$HOME/.local/bin:$PATH"'
    ;;
esac

# --- Launch the installer in the caller's directory ---------------------------------
#
# When the bootstrap is piped in (curl ... | sh), standard input is the pipe,
# not the terminal, so reattach /dev/tty for the interactive flow.

if [ -t 0 ]; then
  exec node "$REPO_DIR/bin/agent-skills.js" install
fi
if sh -c 'exec </dev/tty' 2>/dev/null; then
  exec node "$REPO_DIR/bin/agent-skills.js" install </dev/tty
fi
info "No interactive terminal available, so the installer was not launched."
info "Run 'agent-skills install' in a terminal to install skills."
