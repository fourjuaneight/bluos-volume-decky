#!/usr/bin/env bash
#
# Install this plugin into decky-loader on the machine it is run on.
#
# Run it on the Steam Deck, from the cloned repo:
#
#     ./install.sh
#
# It replaces the plugin directory outright rather than copying over the top,
# so a file that was removed from the repo cannot linger on the Deck.
#
# Requires sudo: decky runs as root and ignores plugin directories it does not
# own. Settings live in decky's own settings directory, not in here, so they
# survive a reinstall.

set -euo pipefail

PLUGIN_NAME="decky-bluos-volume"
PLUGINS_ROOT="${HOME}/homebrew/plugins"
TARGET="${PLUGINS_ROOT}/${PLUGIN_NAME}"

SRC="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

# Everything decky needs at runtime. src/, node_modules/ and the build config
# are build-time only and are deliberately absent.
FILES=(
  plugin.json
  main.py
  package.json
  dist/index.js
  dist/index.js.map
  defaults/settings.json
)

die() {
  echo "error: $*" >&2
  exit 1
}

# --- checks -----------------------------------------------------------------

[[ -d "${PLUGINS_ROOT}" ]] ||
  die "${PLUGINS_ROOT} does not exist. Is decky-loader installed?"

missing=()
for file in "${FILES[@]}"; do
  [[ -f "${SRC}/${file}" ]] || missing+=("${file}")
done

if ((${#missing[@]})); then
  echo "error: missing from ${SRC}:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  # dist/ is gitignored, so a fresh clone never has it.
  if [[ " ${missing[*]} " == *" dist/index.js "* ]]; then
    echo >&2
    echo "dist/index.js is gitignored and only exists where you ran the build." >&2
    echo "Build it (pnpm install && pnpm run build) and copy dist/ here." >&2
  fi
  exit 1
fi

# Guard the rm -rf below: refuse anything outside the plugins directory.
case "${TARGET}" in
"${PLUGINS_ROOT}/"?*) ;;
*) die "refusing to touch ${TARGET}" ;;
esac

# --- install ----------------------------------------------------------------

echo "installing ${PLUGIN_NAME}"
echo "  from ${SRC}"
echo "  to   ${TARGET}"

sudo rm -rf -- "${TARGET}"
sudo mkdir -p "${TARGET}"

for file in "${FILES[@]}"; do
  sudo mkdir -p "${TARGET}/$(dirname -- "${file}")"
  sudo cp -- "${SRC}/${file}" "${TARGET}/${file}"
done

# decky copies defaults/ into the plugin root on a store install; main.py reads
# that copy as its fallback. Mirror it so a manual install behaves the same.
sudo cp -- "${SRC}/defaults/settings.json" "${TARGET}/settings.json"

sudo chown -R root:root "${TARGET}"
sudo chmod -R 755 "${TARGET}"

echo "restarting plugin_loader"
sudo systemctl restart plugin_loader

echo
echo "done. open the Quick Access Menu and check the Decky tab."
echo "if it does not appear:  sudo journalctl -u plugin_loader -n 50 --no-pager"
