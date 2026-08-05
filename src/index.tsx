import { PanelSection, PanelSectionRow, Spinner, staticClasses } from "@decky/ui";
import { definePlugin } from "@decky/api";
import { useCallback, useEffect, useState } from "react";
import { FaVolumeUp } from "react-icons/fa";

import * as api from "./api";
import { PlayerControl } from "./components/PlayerControl";
import { PlayerPicker } from "./components/PlayerPicker";
import { PlayerSettings } from "./components/PlayerSettings";
import { samePlayer, type Player } from "./types";

function Content() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [selected, setSelected] = useState<Player | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);

  /**
   * Reload the player list and work out which screen to land on:
   *   0 players            -> setup
   *   1 player             -> straight to volume, no back arrow
   *   2+ with a saved pick -> straight to volume, back arrow available
   *   2+ without one       -> picker
   */
  const load = useCallback(async () => {
    const [list, last] = await Promise.all([api.getPlayers(), api.getLastSelected()]);

    const known = list ?? [];
    setPlayers(known);

    if (known.length === 1) {
      setSelected(known[0]);
    } else if (known.length > 1) {
      setSelected(known.find((player) => samePlayer(player, last)) ?? null);
    } else {
      setSelected(null);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSelect = useCallback(async (player: Player) => {
    setSelected(player);
    await api.setLastSelected(player.ip, player.port);
  }, []);

  const openSettings = useCallback(() => setShowSettings(true), []);

  const closeSettings = useCallback(async () => {
    setShowSettings(false);
    await load();
  }, [load]);

  if (loading) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <Spinner style={{ height: "48px" }} />
        </PanelSectionRow>
      </PanelSection>
    );
  }

  // Nothing configured yet: the setup screen is the only thing worth showing.
  if (players.length === 0) {
    return <PlayerSettings players={players} setup onChanged={load} />;
  }

  if (showSettings) {
    return <PlayerSettings players={players} onChanged={load} onDone={closeSettings} />;
  }

  if (selected) {
    return (
      <PlayerControl
        player={selected}
        // The back arrow only makes sense when there is a picker to go back to.
        onBack={players.length > 1 ? () => setSelected(null) : undefined}
        onOpenSettings={openSettings}
      />
    );
  }

  return (
    <PlayerPicker
      players={players}
      onSelect={handleSelect}
      onOpenSettings={openSettings}
    />
  );
}

export default definePlugin(() => ({
  name: "BluOS Volume",
  titleView: <div className={staticClasses.Title}>BluOS Volume</div>,
  content: <Content />,
  icon: <FaVolumeUp />,
  onDismount() {},
}));
