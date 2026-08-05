"""decky-loader backend for the BluOS Volume plugin.

BluOS players expose an unauthenticated HTTP API on port 11000 that returns
UTF-8 XML. Only the volume surface is used here:

    GET /Volume                     read level, mute and dB
    GET /Volume?level=<0-100>       set absolute level
    GET /Volume?mute=<0|1>          mute / unmute
    GET /SyncStatus                 identify a player, used to validate an IP

Every public coroutine on `Plugin` is callable from the frontend. Failures
come back as `{"error": "..."}` rather than raising, so nothing throws across
the Python/TypeScript bridge.
"""

import asyncio
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional

import decky

SETTINGS_FILE = os.path.join(decky.DECKY_PLUGIN_SETTINGS_DIR, "settings.json")
# decky copies everything in defaults/ into the plugin directory on install.
BUNDLED_DEFAULTS = os.path.join(decky.DECKY_PLUGIN_DIR, "settings.json")

DEFAULT_PORT = 11000
REQUEST_TIMEOUT = 5


def _fetch(url: str) -> ET.Element:
    """Blocking GET returning the parsed XML root. Runs on a worker thread."""
    with urllib.request.urlopen(url, timeout=REQUEST_TIMEOUT) as response:
        return ET.fromstring(response.read())


async def _get(url: str) -> ET.Element:
    """urllib is blocking; keep it off decky's event loop."""
    return await asyncio.to_thread(_fetch, url)


def _build_url(ip: str, port: int, path: str, params: Optional[Dict[str, Any]] = None) -> str:
    url = f"http://{ip}:{port}{path}"
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    return url


def _parse_volume(root: ET.Element) -> Dict[str, Any]:
    """Read a <volume db="-49.9" mute="0" ...>15</volume> response.

    A level of -1 means the player runs at a fixed output level and its
    volume cannot be changed.
    """
    try:
        level = int((root.text or "").strip())
    except ValueError:
        level = -1
    return {
        "volume": level,
        "mute": root.get("mute", "0") == "1",
        "db": root.get("db", ""),
        "fixed": level < 0,
    }


class Plugin:
    # ------------------------------------------------------------------
    # lifecycle
    # ------------------------------------------------------------------

    async def _main(self) -> None:
        # Instance state, not class state, so a reload starts clean.
        self.players: List[Dict[str, Any]] = []
        self.last_selected: Optional[Dict[str, Any]] = None
        self._load_settings()
        decky.logger.info(
            "BluOS Volume loaded with %d configured player(s)", len(self.players)
        )

    async def _unload(self) -> None:
        decky.logger.info("BluOS Volume unloaded")

    async def _uninstall(self) -> None:
        pass

    # ------------------------------------------------------------------
    # settings
    # ------------------------------------------------------------------

    def _load_settings(self) -> None:
        for path in (SETTINGS_FILE, BUNDLED_DEFAULTS):
            try:
                with open(path, "r", encoding="utf-8") as handle:
                    data = json.load(handle)
            except FileNotFoundError:
                continue
            except (json.JSONDecodeError, OSError) as exc:
                decky.logger.warning("Could not read %s: %s", path, exc)
                continue

            self.players = data.get("players", []) or []
            self.last_selected = data.get("last_selected") or None
            return

        self.players = []
        self.last_selected = None

    def _save_settings(self) -> None:
        """Write atomically so a crash mid-save cannot corrupt the file."""
        payload = {"players": self.players, "last_selected": self.last_selected}
        directory = os.path.dirname(SETTINGS_FILE) or "."
        os.makedirs(directory, exist_ok=True)

        handle = tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=directory, delete=False, suffix=".tmp"
        )
        try:
            with handle:
                json.dump(payload, handle, indent=2)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(handle.name, SETTINGS_FILE)
        except OSError as exc:
            decky.logger.error("Failed to write settings: %s", exc)
            try:
                os.unlink(handle.name)
            except OSError:
                pass

    # ------------------------------------------------------------------
    # players
    # ------------------------------------------------------------------

    async def get_players(self) -> List[Dict[str, Any]]:
        return self.players

    async def get_last_selected(self) -> Optional[Dict[str, Any]]:
        return self.last_selected

    async def set_last_selected(self, ip: str, port: int = DEFAULT_PORT) -> bool:
        self.last_selected = {"ip": ip, "port": port}
        self._save_settings()
        return True

    async def add_player(
        self, ip: str, port: int = DEFAULT_PORT, name: str = ""
    ) -> Dict[str, Any]:
        """Add a player by IP, validating it with /SyncStatus before saving."""
        ip = (ip or "").strip()
        if not ip:
            return {"error": "An IP address is required"}

        try:
            root = await _get(_build_url(ip, port, "/SyncStatus"))
        except urllib.error.HTTPError as exc:
            decky.logger.error("add_player %s:%s -> HTTP %s", ip, port, exc.code)
            return {"error": f"{ip} returned HTTP {exc.code}"}
        except (urllib.error.URLError, OSError) as exc:
            decky.logger.error("add_player %s:%s -> %s", ip, port, exc)
            return {"error": f"Could not reach {ip}:{port}"}
        except ET.ParseError:
            decky.logger.error("add_player %s:%s -> malformed XML", ip, port)
            return {"error": f"{ip} is not a BluOS player"}

        player = {
            "ip": ip,
            "port": port,
            "name": root.get("name") or name or ip,
        }
        # Replace any existing entry for this address rather than duplicating.
        self.players = [
            p for p in self.players if not (p.get("ip") == ip and p.get("port") == port)
        ]
        self.players.append(player)
        self._save_settings()
        return player

    async def remove_player(self, ip: str, port: int = DEFAULT_PORT) -> bool:
        self.players = [
            p for p in self.players if not (p.get("ip") == ip and p.get("port") == port)
        ]
        # Drop the saved selection too, otherwise the panel opens on a player
        # that is no longer configured.
        if self.last_selected and (
            self.last_selected.get("ip") == ip and self.last_selected.get("port") == port
        ):
            self.last_selected = None
        self._save_settings()
        return True

    # ------------------------------------------------------------------
    # volume
    # ------------------------------------------------------------------

    async def _volume_request(
        self, ip: str, port: int, params: Optional[Dict[str, Any]], action: str
    ) -> Dict[str, Any]:
        try:
            root = await _get(_build_url(ip, port, "/Volume", params))
        except urllib.error.HTTPError as exc:
            decky.logger.error("%s %s:%s -> HTTP %s", action, ip, port, exc.code)
            return {"error": f"{ip} returned HTTP {exc.code}"}
        except (urllib.error.URLError, OSError) as exc:
            decky.logger.error("%s %s:%s -> %s", action, ip, port, exc)
            return {"error": f"Could not reach {ip}:{port}"}
        except ET.ParseError:
            decky.logger.error("%s %s:%s -> malformed XML", action, ip, port)
            return {"error": f"{ip} returned an unreadable response"}
        return _parse_volume(root)

    async def get_volume(self, ip: str, port: int = DEFAULT_PORT) -> Dict[str, Any]:
        return await self._volume_request(ip, port, None, "get_volume")

    async def set_volume(
        self,
        ip: str,
        level: int,
        port: int = DEFAULT_PORT,
        tell_slaves: bool = False,
    ) -> Dict[str, Any]:
        """Set absolute volume (0-100).

        `tell_slaves` propagates the change to every player grouped under this
        one. Off by default; group control is not exposed in the UI yet.
        """
        params: Dict[str, Any] = {"level": max(0, min(100, int(level)))}
        if tell_slaves:
            params["tell_slaves"] = 1
        return await self._volume_request(ip, port, params, "set_volume")

    async def set_mute(
        self, ip: str, mute: bool, port: int = DEFAULT_PORT
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {"mute": 1 if mute else 0}
        return await self._volume_request(ip, port, params, "set_mute")
