#!/bin/bash
# ###########################################################################
# deploy_frontend.sh - upload the frontend (index.html, css/, js/) to cPanel
#
# RUNS ON: kriciserver, from anywhere inside this repo.
#   bash tools/deploy_frontend.sh --dry-run     # show what would be uploaded
#   bash tools/deploy_frontend.sh               # upload + verify
#
# ROUTE: this server has no cPanel key. The key lives on MetaCentrum
#   ($STRG/.ssh/id_cpanel_czu, the same one publish_cpanel.sh uses), so the
#   files go  kriciserver -> skirit ($STRG/FORECAST/web-frontend/) -> cPanel
#   public_html/ over SSH (help-desk IP 89.233.145.252, user weatherforecastf).
#
# SAFETY RULES
#   * Only files tracked by git under index.html, css/ and js/ are uploaded,
#     with the content of the committed HEAD (never the working tree).
#   * Only files that changed since the last deploy (git tag 'frontend-live')
#     are uploaded; index.html goes last.
#   * data/, manifest.json, logo/, boundaries/, .htaccess, cgi-bin/ and
#     .well-known/ are never touched. NOTHING is ever deleted on the server.
#   * Before uploading, every frontend file on the live site must still equal
#     the 'frontend-live' commit. If the live site was changed some other way,
#     the script stops and uploads nothing.
#   * After uploading, every uploaded file is downloaded again and compared
#     byte for byte with HEAD; only then the tag moves to HEAD.
# ###########################################################################
set -euo pipefail

LIVE="https://weather-forecast.fzp.czu.cz"
SKIRIT="krici52@skirit.metacentrum.cz"
STRG="/storage/projects-du-praha/czu-fzp-hcv/home/kricnar"
STAGE="$STRG/FORECAST/web-frontend"
CPANEL="weatherforecastf@89.233.145.252"
DEST="public_html"
TAG="frontend-live"
PATHS=(index.html css js)

DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

cd "$(git rev-parse --show-toplevel)"
say() { echo "[deploy] $*"; }
die() { echo "[deploy] ERROR: $*" >&2; exit 1; }

git rev-parse -q --verify "refs/tags/$TAG" >/dev/null \
  || die "git tag '$TAG' is missing. Set it to the commit that is live now: git tag $TAG <commit>"
if ! git diff --quiet HEAD -- "${PATHS[@]}"; then
  die "uncommitted changes in ${PATHS[*]} - commit first (the deploy uploads HEAD)."
fi

live_fetch() {   # $1 = file -> stdout; exit 1 when the server does not answer 200
  curl -sf --max-time 60 "$LIVE/$1?deploy_check=$(date +%s%N)"
}

# --- 1. the live site must still be the last deployed commit ---
say "Checking that the live site still equals tag '$TAG' ($(git rev-parse --short "$TAG"))..."
while IFS= read -r f; do
  if ! live_fetch "$f" | cmp -s - <(git show "$TAG:$f"); then
    die "live $f differs from tag '$TAG' - the site was changed some other way. Nothing uploaded."
  fi
done < <(git ls-tree -r --name-only "$TAG" -- "${PATHS[@]}")
say "Live site matches '$TAG'."

# --- 2. what changed since then (added or modified; deletions are only reported) ---
mapfile -t CHANGED < <(git diff --name-only --diff-filter=AM "$TAG" HEAD -- "${PATHS[@]}" | grep -v '^index.html$' || true)
git diff --quiet "$TAG" HEAD -- index.html || CHANGED+=("index.html")     # index.html last
mapfile -t GONE < <(git diff --name-only --diff-filter=D "$TAG" HEAD -- "${PATHS[@]}")
[ "${#GONE[@]}" -gt 0 ] && say "NOTE: removed from git but left on the server (nothing is deleted): ${GONE[*]}"

if [ "${#CHANGED[@]}" -eq 0 ]; then
  say "Nothing to upload: HEAD has the same frontend as '$TAG'."
  exit 0
fi
say "Files to upload (${#CHANGED[@]}), in this order:"
printf '           %s\n' "${CHANGED[@]}"
if [ "$DRY" -eq 1 ]; then
  say "Dry run - nothing uploaded."
  exit 0
fi

# --- 3. stage on skirit, upload from there with the cPanel key ---
say "Staging on skirit: $STAGE"
git archive HEAD -- "${CHANGED[@]}" | ssh -o BatchMode=yes "$SKIRIT" "mkdir -p '$STAGE' && tar -x -C '$STAGE'"

REMOTE_SCRIPT=$(cat <<REMOTE
set -e
KEY="$STRG/.ssh/id_cpanel_czu"
[ -f "\$KEY" ] || { echo "cPanel key not found: \$KEY" >&2; exit 1; }
OPTS="-i \$KEY -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20"
cd "$STAGE"
for f in ${CHANGED[*]}; do
  scp -q \$OPTS "\$f" "$CPANEL:$DEST/\$f"
  ssh \$OPTS "$CPANEL" "chmod 644 '$DEST/\$f'"
  echo "uploaded \$f"
done
REMOTE
)
ssh -o BatchMode=yes "$SKIRIT" "bash -s" <<<"$REMOTE_SCRIPT"

# --- 4. verify the live site byte for byte ---
say "Verifying the live site..."
BAD=0
for f in "${CHANGED[@]}"; do
  if live_fetch "$f" | cmp -s - <(git show "HEAD:$f"); then
    say "  OK   $f"
  else
    say "  DIFF $f"
    BAD=1
  fi
done
[ "$BAD" -eq 0 ] || die "live site does not match HEAD after the upload - tag '$TAG' NOT moved."

git tag -f "$TAG" HEAD >/dev/null
say "Done. Tag '$TAG' now at $(git rev-parse --short HEAD). Publish the tag with: git push -f origin $TAG"
