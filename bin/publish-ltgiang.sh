#!/usr/bin/env bash
# bin/publish-ltgiang.sh — Publish @ltgiang/omniroute to npm under the `ltgiang` dist-tag.
#
# This is the personal-fork publish path. The upstream `omniroute` package on
# npm is owned by diegosouzapw; this script publishes to the scoped fork
# `@ltgiang/omniroute` so the two packages do NOT collide.
#
# Usage:
#   bin/publish-ltgiang.sh                # full flow: bump + build + publish
#   bin/publish-ltgiang.sh --dry-run      # do everything except the actual `npm publish`
#   bin/publish-ltgiang.sh --skip-tests   # skip npm run check (faster local iteration)
#   bin/publish-ltgiang.sh --version 3.8.43-ltgiang.2   # explicit version
#   bin/publish-ltgiang.sh --tag ltgiang  # npm dist-tag (default: ltgiang)
#   bin/publish-ltgiang.sh --help
#
# Required (one of):
#   - npm login already run  → `npm whoami` returns "ltgiang" (this is the case on
#     the operator's machine; the script verifies and aborts with a clear message
#     otherwise)
#   - OR NPM_TOKEN env var set (automation token) → script uses `npm config set
#     //registry.npmjs.org/:_authToken "$NPM_TOKEN"` automatically
#
# Optional (auto-picked if absent):
#   - VERSION        : explicit version to publish; otherwise script reads current
#                       `package.json` version and confirms with a prompt
#   - DIST_TAG       : npm dist-tag (default `ltgiang`)
#   - SKIP_TESTS=1   : skip `npm run check:any-budget:t11` + `npm run typecheck:core`

set -euo pipefail

# ── Colors ───────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  C_RED='\033[0;31m'
  C_GREEN='\033[0;32m'
  C_YELLOW='\033[0;33m'
  C_BLUE='\033[0;34m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_RED='' C_GREEN='' C_YELLOW='' C_BLUE='' C_BOLD='' C_RESET=''
fi

log()  { printf "${C_BLUE}[publish]${C_RESET} %s\n" "$*" >&2; }
ok()   { printf "${C_GREEN}[ok]${C_RESET}      %s\n" "$*" >&2; }
warn() { printf "${C_YELLOW}[warn]${C_RESET}    %s\n" "$*" >&2; }
die()  { printf "${C_RED}[fatal]${C_RESET}   %s\n" "$*" >&2; exit 1; }

# ── Defaults ─────────────────────────────────────────────────────────────
DRY_RUN=0
SKIP_TESTS=0
EXPLICIT_VERSION=""
DIST_TAG="ltgiang"

# ── Args ─────────────────────────────────────────────────────────────────
usage() {
  sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run)      DRY_RUN=1 ;;
    --skip-tests)   SKIP_TESTS=1 ;;
    --version)      EXPLICIT_VERSION="${2:-}"; shift ;;
    --tag)          DIST_TAG="${2:-ltgiang}"; shift ;;
    --help|-h)      usage ;;
    *) die "unknown argument: $1 (try --help)" ;;
  esac
  shift
done

# ── Sanity checks ────────────────────────────────────────────────────────
[ -f package.json ] || die "package.json not found — run from the repo root"

# Detect worktree / non-root CWD: package.json must have the scoped name
PKG_NAME="$(node -p "require('./package.json').name" 2>/dev/null)" \
  || die "could not read package.json name"
case "$PKG_NAME" in
  @ltgiang/omniroute) ;;
  *) die "expected package name '@ltgiang/omniroute', got '$PKG_NAME' — refusing to publish. Did you run from the right checkout?" ;;
esac

log "package  : $PKG_NAME"
log "dist-tag : $DIST_TAG"
log "dry-run  : $DRY_RUN"
log "skip-tests: $SKIP_TESTS"
echo

# ── Step 0: npm auth ─────────────────────────────────────────────────────
log "Step 0/5: verifying npm auth"
if [ -n "${NPM_TOKEN:-}" ]; then
  log "NPM_TOKEN detected — setting registry auth from env (non-persistent)"
  NPM_REGISTRY_URL="//registry.npmjs.org/"
  if [ "$DRY_RUN" = "1" ]; then
    ok "dry-run: would have run: npm config set ${NPM_REGISTRY_URL}:_authToken \$NPM_TOKEN"
  else
    npm config set "${NPM_REGISTRY_URL}:_authToken" "$NPM_TOKEN" >/dev/null
  fi
fi

# Verify auth works
NPM_USER="$(npm whoami 2>/dev/null || true)"
if [ -z "$NPM_USER" ]; then
  cat >&2 <<EOF

$(printf "${C_RED}Not logged in to npm.${C_RESET}" 2>/dev/null || echo "Not logged in to npm.")

Pick one:
  1. Interactive login (you'll be prompted in the terminal):
       npm login
     then re-run this script.

  2. CI/headless token (Automation token from https://www.npmjs.com/settings/~/tokens):
       export NPM_TOKEN="npm_xxxxxxxxxxxxxxxxxxxx"
     then re-run this script. The script will pick it up automatically.

EOF
  exit 1
fi
ok "logged in as: $NPM_USER"
[ "$NPM_USER" = "ltgiang" ] || warn "logged in as '$NPM_USER' (expected 'ltgiang') — publishing anyway"

# ── Step 1: optional quality gate ────────────────────────────────────────
if [ "$SKIP_TESTS" = "1" ]; then
  warn "Step 1/5: skipping quality gate (--skip-tests)"
elif [ "$DRY_RUN" = "1" ]; then
  warn "Step 1/5: skipping quality gate (--dry-run)"
else
  log "Step 1/5: running fast quality gate (typecheck + t11 any-budget)"
  npm run typecheck:core  || die "typecheck:core failed — fix before publishing"
  npm run check:any-budget:t11 || die "check:any-budget:t11 failed"
  ok "quality gate passed"
fi

# ── Step 2: resolve / confirm version ────────────────────────────────────
CURRENT_VERSION="$(node -p "require('./package.json').version")"
TARGET_VERSION="${EXPLICIT_VERSION:-}"

# If --version is omitted, auto-bump the upstream version with a -ltgiang.<N> suffix.
# This keeps `main` (and the docs-sync gate) at the upstream version, while every
# publish goes out with a unique, scope-aware pre-release tag.
if [ -z "$TARGET_VERSION" ]; then
  case "$CURRENT_VERSION" in
    *-ltgiang.*)
      # Already bumped — keep it.
      TARGET_VERSION="$CURRENT_VERSION"
      log "Step 2/5: version = $TARGET_VERSION (already has -ltgiang suffix)"
      ;;
    *)
      # Auto-bump to <current>-ltgiang.1
      TARGET_VERSION="${CURRENT_VERSION}-ltgiang.1"
      if [ "$DRY_RUN" = "1" ]; then
        log "Step 2/5: would auto-bump version: $CURRENT_VERSION -> $TARGET_VERSION"
      else
        printf "${C_BOLD}Step 2/5:${C_RESET} auto-bump version ${CURRENT_VERSION} -> ${TARGET_VERSION} in package.json? [y/N] " >&2
        read -r reply
        case "$reply" in
          [yY]|[yY][eE][sS])
            node -e "
              const fs = require('fs');
              const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
              p.version = process.argv[1];
              fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
            " "$TARGET_VERSION"
            ok "package.json version -> $TARGET_VERSION"
            ;;
          *) die "aborted by operator (re-run with --version to use a different bump)" ;;
        esac
      fi
      ;;
  esac
else
  log "Step 2/5: explicit --version=$TARGET_VERSION (current package.json = $CURRENT_VERSION)"
fi

# Sanity: scope-aware pre-release suffix to avoid clashing with upstream
case "$TARGET_VERSION" in
  *-ltgiang.*) ok "version carries -ltgiang.* suffix (safe vs upstream)" ;;
  *) warn "version '$TARGET_VERSION' has no -ltgiang.* suffix — npm will REJECT if upstream has the same version. Re-run with --version $TARGET_VERSION-ltgiang.N." ;;
esac

# Ask for confirmation
if [ "$DRY_RUN" = "1" ]; then
  ok "dry-run: would prompt for confirmation (skipped)"
else
  printf "${C_BOLD}Publish ${PKG_NAME}@${TARGET_VERSION} to npm with dist-tag='${DIST_TAG}'?${C_RESET} [y/N] " >&2
  read -r reply
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) die "aborted by operator" ;;
  esac
fi

# ── Step 3: build ────────────────────────────────────────────────────────
log "Step 3/5: building (build:release = clean .build/ + dist/ + write build SHA)"
if [ "$DRY_RUN" = "1" ]; then
  ok "dry-run: would have run: npm run build:release"
else
  npm run build:release || die "build:release failed"
  ok "build artifact ready in ./dist/"
fi

# ── Step 4: validate pack artifact ───────────────────────────────────────
log "Step 4/5: validating pack artifact (closure + no test files leaked)"
if [ "$DRY_RUN" = "1" ]; then
  ok "dry-run: would have run: npm run check:pack-artifact"
else
  npm run check:pack-artifact || die "check:pack-artifact failed — fix the dist/ tree before publishing"
  ok "pack artifact is valid"
fi

# ── Step 5: publish ──────────────────────────────────────────────────────
log "Step 5/5: publishing"
PUBLISH_CMD=(npm publish --tag "$DIST_TAG")
log "command: ${PUBLISH_CMD[*]}"
if [ "$DRY_RUN" = "1" ]; then
  ok "dry-run: skipped. Above is what would have run."
else
  "${PUBLISH_CMD[@]}" || die "npm publish failed"
  ok "published ${PKG_NAME}@${TARGET_VERSION} with dist-tag=${DIST_TAG}"
  echo
  ok "next: npm install -g ${PKG_NAME}    (on a fresh machine to test)"
fi
