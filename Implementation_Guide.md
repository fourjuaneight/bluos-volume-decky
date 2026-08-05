# BluOS Volume Control — Decky Loader Plugin

## Goal

Create a Decky Loader plugin for Steam Deck that controls volume (level + mute) on BluOS players over the local network. Accessible from the Quick Access Menu during gameplay.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│ Steam Deck (Gaming Mode)                         │
│                                                  │
│  ┌────────────────┐     ┌─────────────────────┐  │
│  │  Frontend (TSX) │────▶│  Backend (Python)   │  │
│  │  Volume Slider  │◀────│  HTTP calls to      │  │
│  │  Mute Toggle    │     │  BluOS players      │  │
│  │  Player Select  │     │                     │  │
│  └────────────────┘     └──────────┬──────────┘  │
│                                     │             │
└─────────────────────────────────────&#9532;─────────────┘
                                      │ HTTP GET (port 11000)
                                      ▼
                        ┌─────────────────────────┐
                        │  BluOS Player(s)        │
                        │  (same LAN, no auth)    │
                        └─────────────────────────┘
```

- **Frontend**: React/TypeScript component rendered in Steam Deck's Quick Access Menu
- **Backend**: Python class with async methods, called from frontend via `callable()`
- **Communication to BluOS**: Plain HTTP GET requests returning XML, port 11000, no authentication

---

## BluOS API Reference (Volume Only)

Base URL: `http://<player_ip>:11000`

### Get Current Volume

```
GET /Volume
```

Response (XML):

```xml
<volume db="-49.9" mute="0" offsetDb="0" etag="...">15</volume>
```

- Text content = volume level (0-100)
- `mute` attribute: "0" = unmuted, "1" = muted
- `db` attribute: volume in dB
- `-1` volume means fixed volume (cannot be changed)

### Set Volume Level

```
GET /Volume?level={0-100}
```

### Volume Up/Down (relative dB)

```
GET /Volume?db={delta}
```

Example: `db=2` increases by 2dB, `db=-2` decreases by 2dB.

### Mute

```
GET /Volume?mute=1
```

### Unmute

```
GET /Volume?mute=0
```

### Group Volume

Add `&tell_slaves=1` to propagate volume change to all players in a group.

### Player Status (for discovery validation)

```
GET /SyncStatus
```

Returns player name, model, brand, group info, volume, MAC address.

### Player Discovery

- **mDNS**: Service type `_musc._tcp` (primary players), `_musp._tcp` (secondary/CI580 nodes)
- **LSDP**: UDP broadcast on port 11430 (Lenbrook proprietary, fallback)
- **Manual**: User provides IP address

### Key Constraints

- All requests are HTTP GET
- Responses are UTF-8 XML
- Default port: 11000 (CI580 uses 11000/11010/11020/11030)
- No authentication required
- Must be on same local network
- Rate limit: max 1 request per second when long-polling; max 1 per 30 seconds without long-polling

---

## Decky Plugin Structure

Based on the official template: `SteamDeckHomebrew/decky-plugin-template`

```
decky-bluos-volume/
├── main.py                 # Python backend
├── package.json            # Node dependencies and build scripts
├── plugin.json             # Decky plugin manifest
├── rollup.config.js        # Build config (use @decky/rollup)
├── tsconfig.json           # TypeScript config
├── assets/
│   └── logo.png            # Plugin icon (optional)
├── defaults/
│   └── settings.json       # Default settings (player IPs)
└── src/
    └── index.tsx           # React frontend
```

---

## Plugin Manifest (`plugin.json`)

```json
{
  "name": "BluOS Volume",
  "author": "Your Name",
  "flags": ["_root"],
  "api_version": 1,
  "publish": {
    "tags": ["audio", "volume", "bluos", "bluesound"],
    "description": "Control BluOS player volume from Quick Access Menu.",
    "image": ""
  }
}
```

The `_root` flag is NOT needed for HTTP requests but may be needed for mDNS discovery. If only using manual IP config, remove it.

---

## Backend Implementation (`main.py`)

```python
import urllib.request
import xml.etree.ElementTree as ET
import json
import os
import decky

SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")


class Plugin:
    players = []  # List of {"ip": "...", "port": 11000, "name": "..."}
    last_selected = None  # {"ip": "...", "port": 11000} or None

    async def _main(self):
        """Called on plugin load."""
        decky.logger.info("BluOS Volume plugin loaded")
        self._load_settings()

    async def _unload(self):
        """Called on plugin unload."""
        decky.logger.info("BluOS Volume plugin unloaded")

    async def _uninstall(self):
        """Called on plugin uninstall."""
        pass

    # --- Settings ---

    def _load_settings(self):
        if os.path.exists(SETTINGS_FILE):
            with open(SETTINGS_FILE, "r") as f:
                data = json.load(f)
                self.players = data.get("players", [])
                self.last_selected = data.get("last_selected", None)
        else:
            self.players = []
            self.last_selected = None

    def _save_settings(self):
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        with open(SETTINGS_FILE, "w") as f:
            json.dump({"players": self.players, "last_selected": self.last_selected}, f)

    async def get_players(self) -> list:
        """Return list of configured players."""
        return self.players

    async def get_last_selected(self) -> dict:
        """Return last selected player or None."""
        return self.last_selected

    async def set_last_selected(self, ip: str, port: int = 11000) -> bool:
        """Save last selected player."""
        self.last_selected = {"ip": ip, "port": port}
        self._save_settings()
        return True

    async def add_player(self, ip: str, port: int = 11000, name: str = "") -> dict:
        """Add a player by IP. Validates by querying /SyncStatus."""
        try:
            url = f"http://{ip}:{port}/SyncStatus"
            resp = urllib.request.urlopen(url, timeout=5).read()
            root = ET.fromstring(resp)
            player_name = root.get("name", name or ip)
            player = {"ip": ip, "port": port, "name": player_name}
            # Avoid duplicates
            self.players = [p for p in self.players if p["ip"] != ip or p["port"] != port]
            self.players.append(player)
            self._save_settings()
            return player
        except Exception as e:
            decky.logger.error(f"Failed to add player {ip}:{port}: {e}")
            return {"error": str(e)}

    async def remove_player(self, ip: str, port: int = 11000) -> bool:
        """Remove a player from the list."""
        self.players = [p for p in self.players if not (p["ip"] == ip and p["port"] == port)]
        self._save_settings()
        return True

    # --- Volume Control ---

    async def get_volume(self, ip: str, port: int = 11000) -> dict:
        """Get current volume and mute state."""
        try:
            url = f"http://{ip}:{port}/Volume"
            resp = urllib.request.urlopen(url, timeout=5).read()
            root = ET.fromstring(resp)
            return {
                "volume": int(root.text),
                "mute": root.get("mute", "0") == "1",
                "db": root.get("db", ""),
            }
        except Exception as e:
            decky.logger.error(f"get_volume failed for {ip}:{port}: {e}")
            return {"error": str(e)}

    async def set_volume(self, ip: str, level: int, port: int = 11000, tell_slaves: bool = False) -> dict:
        """Set volume level (0-100)."""
        try:
            url = f"http://{ip}:{port}/Volume?level={level}"
            if tell_slaves:
                url += "&tell_slaves=1"
            resp = urllib.request.urlopen(url, timeout=5).read()
            root = ET.fromstring(resp)
            return {
                "volume": int(root.text),
                "mute": root.get("mute", "0") == "1",
            }
        except Exception as e:
            decky.logger.error(f"set_volume failed for {ip}:{port}: {e}")
            return {"error": str(e)}

    async def set_mute(self, ip: str, mute: bool, port: int = 11000) -> dict:
        """Set mute state."""
        try:
            mute_val = 1 if mute else 0
            url = f"http://{ip}:{port}/Volume?mute={mute_val}"
            resp = urllib.request.urlopen(url, timeout=5).read()
            root = ET.fromstring(resp)
            return {
                "volume": int(root.text),
                "mute": root.get("mute", "0") == "1",
            }
        except Exception as e:
            decky.logger.error(f"set_mute failed for {ip}:{port}: {e}")
            return {"error": str(e)}
```

---

## Frontend Implementation (`src/index.tsx`)

```tsx
import {
  PanelSection,
  PanelSectionRow,
  SliderField,
  ToggleField,
  ButtonItem,
  TextField,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, toaster } from "@decky/api";
import { useState, useEffect } from "react";
import { FaVolumeUp } from "react-icons/fa";

// Backend callables
const getPlayers = callable<[], { ip: string; port: number; name: string }[]>(
  "get_players",
);
const addPlayer = callable<[ip: string, port: number, name: string], any>("add_player");
const removePlayer = callable<[ip: string, port: number], boolean>("remove_player");
const getVolume = callable<[ip: string, port: number], any>("get_volume");
const setVolume = callable<
  [ip: string, level: number, port: number, tell_slaves: boolean],
  any
>("set_volume");
const setMute = callable<[ip: string, mute: boolean, port: number], any>("set_mute");

function PlayerControl({
  player,
}: {
  player: { ip: string; port: number; name: string };
}) {
  const [volume, setVolumeState] = useState(0);
  const [muted, setMutedState] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const result = await getVolume(player.ip, player.port);
    if (!result.error) {
      setVolumeState(result.volume);
      setMutedState(result.mute);
    }
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, []);

  const handleVolumeChange = async (value: number) => {
    setVolumeState(value);
    await setVolume(player.ip, value, player.port, false);
  };

  const handleMuteToggle = async (value: boolean) => {
    setMutedState(value);
    await setMute(player.ip, value, player.port);
  };

  if (loading) return null;

  return (
    <PanelSection title={player.name}>
      <PanelSectionRow>
        <SliderField
          label="Volume"
          value={volume}
          min={0}
          max={100}
          step={1}
          onChange={handleVolumeChange}
          showValue
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ToggleField label="Mute" checked={muted} onChange={handleMuteToggle} />
      </PanelSectionRow>
    </PanelSection>
  );
}

function Settings() {
  const [newIp, setNewIp] = useState("");
  const [players, setPlayers] = useState<{ ip: string; port: number; name: string }[]>(
    [],
  );

  const refreshPlayers = async () => {
    const result = await getPlayers();
    setPlayers(result || []);
  };

  useEffect(() => {
    refreshPlayers();
  }, []);

  const handleAdd = async () => {
    if (!newIp.trim()) return;
    const result = await addPlayer(newIp.trim(), 11000, "");
    if (result.error) {
      toaster.toast({ title: "Error", body: result.error });
    } else {
      toaster.toast({ title: "Player Added", body: result.name });
      setNewIp("");
      refreshPlayers();
    }
  };

  const handleRemove = async (ip: string, port: number) => {
    await removePlayer(ip, port);
    refreshPlayers();
  };

  return (
    <PanelSection title="Manage Players">
      <PanelSectionRow>
        <TextField
          label="Player IP"
          value={newIp}
          onChange={(e) => setNewIp(e.target.value)}
        />
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem layout="below" onClick={handleAdd}>
          Add Player
        </ButtonItem>
      </PanelSectionRow>
      {players.map((p) => (
        <PanelSectionRow key={`${p.ip}:${p.port}`}>
          <ButtonItem layout="below" onClick={() => handleRemove(p.ip, p.port)}>
            Remove {p.name}
          </ButtonItem>
        </PanelSectionRow>
      ))}
    </PanelSection>
  );
}

function Content() {
  const [players, setPlayers] = useState<{ ip: string; port: number; name: string }[]>(
    [],
  );
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    (async () => {
      const result = await getPlayers();
      setPlayers(result || []);
      if (!result || result.length === 0) setShowSettings(true);
    })();
  }, []);

  if (showSettings) {
    return (
      <>
        <Settings />
        <PanelSection>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={() => {
                setShowSettings(false);
                getPlayers().then(setPlayers);
              }}
            >
              Done
            </ButtonItem>
          </PanelSectionRow>
        </PanelSection>
      </>
    );
  }

  return (
    <>
      {players.map((p) => (
        <PlayerControl key={`${p.ip}:${p.port}`} player={p} />
      ))}
      <PanelSection>
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={() => setShowSettings(true)}>
            Settings
          </ButtonItem>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
}

export default definePlugin(() => {
  return {
    name: "BluOS Volume",
    titleView: <div className={staticClasses.Title}>BluOS Volume</div>,
    content: <Content />,
    icon: <FaVolumeUp />,
    onDismount() {},
  };
});
```

---

## Build Configuration

### `rollup.config.js`

```js
import deckyPlugin from "@decky/rollup";

export default deckyPlugin({});
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "outDir": "dist",
    "module": "ESNext",
    "target": "ES2020",
    "jsx": "react-jsx",
    "declaration": false,
    "moduleResolution": "node",
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "esModuleInterop": true,
    "noImplicitReturns": true,
    "noImplicitThis": true,
    "noImplicitAny": true,
    "strict": true,
    "allowSyntheticDefaultImports": true
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

### `package.json`

```json
{
  "name": "decky-bluos-volume",
  "version": "0.1.0",
  "description": "Control BluOS player volume from Steam Deck Quick Access Menu",
  "type": "module",
  "scripts": {
    "build": "rollup -c",
    "watch": "rollup -c -w"
  },
  "license": "BSD-3-Clause",
  "devDependencies": {
    "@decky/rollup": "^1.0.2",
    "@decky/ui": "^4.11.0",
    "@rollup/rollup-linux-x64-musl": "^4.53.3",
    "@types/react": "19.1.1",
    "@types/react-dom": "19.1.1",
    "rollup": "^4.53.3",
    "typescript": "^5.6.2"
  },
  "dependencies": {
    "@decky/api": "^1.1.3",
    "react-icons": "^5.3.0",
    "tslib": "^2.7.0"
  },
  "pnpm": {
    "peerDependencyRules": {
      "ignoreMissing": ["react", "react-dom"]
    }
  }
}
```

---

## Development Workflow

### Prerequisites

- Node.js 22+
- pnpm (`npm install -g pnpm`)
- Steam Deck with Decky Loader installed (or dev environment)

### Local Build

```bash
cd decky-bluos-volume
pnpm install
pnpm build
```

### Deploy to Steam Deck (dev mode)

1. Enable SSH on Steam Deck (Settings > Developer)
2. Copy built plugin:

```bash
rsync -av --exclude node_modules . deck@<DECK_IP>:~/homebrew/plugins/decky-bluos-volume/
```

3. Restart Decky Loader or reload plugin from Decky settings

### Testing Without Steam Deck

- Backend: Test Python methods directly with any BluOS player on your LAN
- Frontend: Build must be deployed to Decky; no standalone React dev server

---

## Default Settings (`defaults/settings.json`)

```json
{
  "players": [],
  "last_selected": null
}
```

- `players`: Array of `{"ip": "...", "port": 11000, "name": "..."}`
- `last_selected`: `{"ip": "...", "port": 11000}` or `null`

Users add players manually via the Settings panel (enter IP address). Last-selected player is persisted automatically on selection.

---

## Future Enhancements (Out of Scope for V1)

1. **mDNS auto-discovery** — Scan for `_musc._tcp` services, auto-populate player list
2. **Volume step buttons** — +/- buttons for dB-based increments

---

## UI Design

### Flow Logic

```
Plugin Opens
  │
  ├── 0 players configured → Setup Screen (add IP)
  │
  ├── 1 player → Volume Control (auto-selected, no back arrow)
  │
  └── 2+ players
        │
        ├── Has last-selected player saved? → Volume Control (with back arrow)
        │
        └── No last selection → Player Picker
```

### Screen: No Players (Setup)

```
┌─────────────────────────────┐
│ BluOS Volume                │
├─────────────────────────────┤
│                             │
│  No players found.          │
│                             │
│  ┌───────────────────────┐  │
│  │ Player IP             │  │
│  │ 192.168.1.___         │  │
│  └───────────────────────┘  │
│                             │
│  [ Add Player ]             │
│                             │
└─────────────────────────────┘
```

### Screen: Volume Control (single player or after selection)

```
┌─────────────────────────────┐
│ BluOS Volume                │
├─────────────────────────────┤
│ ← Living Room               │  ← back arrow only if 2+ players
│                             │
│ Volume                      │
│ ○━━━━━━━━━━━●━━━━━━━━━━○   │
│            40               │
│                             │
│ Mute         [ OFF ]        │
│                             │
├─────────────────────────────┤
│ ⚙ Settings                  │
└─────────────────────────────┘
```

### Screen: Player Picker (2+ players, no last selection)

```
┌─────────────────────────────┐
│ BluOS Volume                │
├─────────────────────────────┤
│ Select Player               │
│                             │
│ ┌─────────────────────────┐ │
│ │ ▶ Living Room           │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ ▶ Bedroom               │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ ▶ Kitchen               │ │
│ └─────────────────────────┘ │
│                             │
├─────────────────────────────┤
│ ⚙ Settings                  │
└─────────────────────────────┘
```

### Interaction Rules

| Element          | Behavior                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| Volume slider    | Step of 5. Sends `set_volume` on release, not while dragging. Local state updates immediately. |
| Mute toggle      | Sends `set_mute` immediately. Slider grayed when muted but still adjustable.                   |
| Player list item | Tap selects, saves as last-selected, navigates to volume view.                                 |
| Back arrow       | Returns to picker. Only shown when 2+ players configured.                                      |
| Settings gear    | Bottom of panel. Opens add/remove player management.                                           |
| Last selection   | Persisted in settings. On open, skip picker and go straight to volume control.                 |

---

## Key Technical Decisions

| Decision         | Choice                               | Rationale                                           |
| ---------------- | ------------------------------------ | --------------------------------------------------- |
| Discovery        | Manual IP entry (v1)                 | Avoids `_root` flag, simpler, works on all networks |
| HTTP library     | `urllib.request` (stdlib)            | No pip dependencies needed, BluOS is simple GET     |
| Settings storage | JSON file via Decky paths            | Standard Decky pattern                              |
| Volume control   | Absolute level (0-100)               | Matches BluOS API directly, simplest UX             |
| Volume step      | 5                                    | Coarse control for quick adjustments mid-game       |
| Mute             | Boolean toggle                       | Clear state, maps to `mute=0                        | 1`  |
| Error handling   | Return `{error: string}`             | Frontend can show toast on failure                  |
| Last player      | Saved in settings as `last_selected` | Skip picker on re-open                              |
| Settings button  | Bottom of panel                      | Always accessible, non-intrusive                    |

---

## References

- [BluOS Custom Integration API v1.7](BluOS-Custom-Integration-API_v1.7.pdf)
- [Decky Plugin Template](https://github.com/SteamDeckHomebrew/decky-plugin-template)
- [Decky Loader Wiki](https://wiki.deckbrew.xyz)
- [Decky API Docs](https://github.com/SteamDeckHomebrew/decky-loader)
