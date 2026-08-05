# BluOS Volume

A [Decky Loader](https://github.com/SteamDeckHomebrew/decky-loader) plugin that
controls volume and mute on BluOS players (Bluesound, NAD, PSB) from the Steam
Deck's Quick Access Menu, without leaving a game.

## Status

Scaffold, built to the project's implementation guide. Frontend builds and
typechecks clean, backend compiles; nothing has been run against real hardware
yet.

## How it works

BluOS players expose an unauthenticated HTTP API on port `11000` that returns
UTF-8 XML. The Python backend makes the requests, the React frontend renders
the panel.

| Endpoint                    | Used for                                                 |
| --------------------------- | -------------------------------------------------------- |
| `GET /Volume`               | Read level, mute state and dB                            |
| `GET /Volume?level=<0-100>` | Set absolute volume                                      |
| `GET /Volume?mute=<0\|1>`   | Mute and unmute                                          |
| `GET /SyncStatus`           | Validate an IP and read the player's name when adding it |

A `<volume>` response carries the level as its text content and mute/dB as
attributes:

```xml
<volume db="-49.9" mute="0" offsetDb="0" etag="...">15</volume>
```

A level of `-1` means the player runs at a fixed output level; those players
render read-only rather than showing a slider that does nothing.

### Discovery

Manual IP entry only, per the guide's v1 scope. That avoids the `_root` flag
entirely and works on every network. mDNS (`_musc._tcp`) and LSDP discovery are
noted as future work.

## Panel flow

```
Plugin opens
  ├── 0 players            → setup screen (enter an IP)
  ├── 1 player             → volume control, auto-selected, no back arrow
  └── 2+ players
        ├── saved pick     → volume control, back arrow to the picker
        └── no saved pick  → player picker
```

The last selected player is persisted, so reopening the panel goes straight to
the player you were using.

## Layout

```
main.py                          decky entry point; every public method is callable
defaults/settings.json           seed settings, copied into the plugin dir on install
src/
  index.tsx                      flow logic and plugin definition
  api.ts                         typed bindings for the Python methods
  types.ts                       shapes mirroring the backend's return values
  utils.ts                       debounce and host validation
  components/
    PlayerControl.tsx            volume slider and mute toggle
    PlayerPicker.tsx             player list, 2+ players with no saved pick
    PlayerSettings.tsx           add and remove players; doubles as the setup screen
```

Backend methods return either their payload or `{"error": "..."}` — nothing
raises across the Python/TypeScript bridge, and the frontend surfaces failures
as a toast.

The backend uses the standard library only (`urllib`, `xml.etree`), so there
are no pip dependencies to vendor. Requests are dispatched with
`asyncio.to_thread` because `urllib` is blocking and would otherwise stall
decky's event loop.

## Interaction details

| Element          | Behavior                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| Volume slider    | Step of 5. Local state updates immediately; the request is sent once movement stops.                        |
| Mute toggle      | Sent immediately. The slider dims while muted but stays adjustable, so you can set a level before unmuting. |
| Player list item | Selects, saves as last-selected, opens volume control.                                                      |
| Back arrow       | Returns to the picker. Only shown with 2+ players configured.                                               |
| Settings         | Bottom of the panel. Add and remove players.                                                                |

`SliderField` exposes no release event, only a continuous `onChange`, so
"send on release" is implemented as a 250 ms trailing debounce. That also keeps
the plugin inside BluOS's documented rate limit (1 request/second).

## Settings

Stored as JSON in decky's per-plugin settings directory:

```json
{
  "players": [{ "ip": "192.168.1.50", "port": 11000, "name": "Living Room" }],
  "last_selected": { "ip": "192.168.1.50", "port": 11000 }
}
```

Writes are atomic, so an interrupted save cannot leave a file that fails to
parse on next load.

## Building

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm run build      # bundles src/ to dist/index.js
pnpm run typecheck  # tsc --noEmit
```

### Linting and formatting

ESLint flat config with type-aware `typescript-eslint` rules plus
`eslint-plugin-react-hooks`; Prettier owns formatting, and
`eslint-config-prettier` switches off every ESLint rule that would fight it.

```sh
pnpm run lint          # eslint .
pnpm run lint:fix      # eslint . --fix
pnpm run format        # prettier --write .
pnpm run format:check  # prettier --check .
pnpm run check         # format:check + lint + typecheck
```

Two deliberate rule adjustments:

- `@typescript-eslint/no-misused-promises` runs with
  `checksVoidReturn.attributes: false`. Async handlers on JSX props are
  idiomatic, and every `api.*` call resolves to `{error}` instead of rejecting.
- `react-hooks/set-state-in-effect` is a warning, not an error. It fires on the
  mount-time fetch in `Content` and `PlayerControl`; both set state only after
  awaiting, so the cascading-render concern it guards against does not apply.

Everything else runs at the plugin defaults. `pnpm run lint` should report two
warnings and no errors.

### On unmount guards

Async handlers here set state without checking whether the component is still
mounted. That is intentional: React 18 removed the setState-after-unmount
warning, and such a call is a no-op rather than a leak. The `isMounted` ref
pattern would add ceremony without preventing anything.

## Installing manually

This plugin is not in the Decky store. It has to be copied onto the Deck by
hand. Decky Loader must already be installed.

### What actually gets copied

Only the runtime files belong on the Deck. `src/`, `node_modules/`, the build
config and the lockfile are build-time only:

```
plugin.json          manifest decky reads to register the plugin
main.py              backend
package.json         name and version
dist/index.js        bundled frontend, produced by `pnpm run build`
defaults/            seed settings, copied into the plugin dir on first load
```

### One-time Deck setup

1. Desktop Mode → **Settings → Users** (or a terminal) → set a password for the
   `deck` user with `passwd`. SteamOS ships without one and `sudo` will not work
   until it is set.
2. **System Settings → Developer → Enable SSH**, or start it manually with
   `sudo systemctl start sshd`.
3. Find the Deck's IP under **Settings → Internet**.

### Copy and install

Build first, then copy from your workstation:

```sh
pnpm install
pnpm run build

rsync -av --relative \
  plugin.json main.py package.json dist/index.js defaults/ \
  deck@<DECK_IP>:~/homebrew/plugins/decky-bluos-volume/
```

Then, on the Deck, hand the directory to root and restart the loader. Decky runs
as root and ignores plugin directories it does not own:

```sh
sudo chown -R root:root ~/homebrew/plugins/decky-bluos-volume
sudo chmod -R 755 ~/homebrew/plugins/decky-bluos-volume
sudo systemctl restart plugin_loader
```

Back in Gaming Mode, open the Quick Access Menu (**⋯** button) and pick the
Decky icon. **BluOS Volume** should be in the list.

### Updating

Same sequence every time. The `chown` has to be repeated, because rsync writes
the new files as `deck`:

```sh
pnpm run build
rsync -av --relative \
  plugin.json main.py package.json dist/index.js defaults/ \
  deck@<DECK_IP>:~/homebrew/plugins/decky-bluos-volume/
ssh deck@<DECK_IP> '
  sudo chown -R root:root ~/homebrew/plugins/decky-bluos-volume &&
  sudo systemctl restart plugin_loader
'
```

Frontend-only changes can be picked up by reloading the plugin from Decky's
settings instead of restarting the service. Backend changes to `main.py` always
need the restart.

### Removing

```sh
sudo rm -rf ~/homebrew/plugins/decky-bluos-volume
sudo systemctl restart plugin_loader
```

Settings live outside the plugin directory, in decky's per-plugin settings dir,
and survive this. Delete them too if you want a clean slate.

### If it does not show up

| Symptom                              | Check                                                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Plugin missing from the list         | `plugin.json` present at the directory root, and the directory owned by `root:root`           |
| Plugin listed but the panel is blank | `dist/index.js` was copied — it is gitignored, so it only exists after `pnpm run build`       |
| Panel loads, every request fails     | Deck and player on the same network; `curl http://<player_ip>:11000/SyncStatus` from the Deck |
| Nothing else explains it             | `sudo journalctl -u plugin_loader -f`, then reopen the panel                                  |
