import { ButtonItem, PanelSection, PanelSectionRow, TextField } from "@decky/ui";
import { toaster } from "@decky/api";
import { useState } from "react";

import * as api from "../api";
import { isError, playerKey, type Player } from "../types";
import { isValidHost } from "../utils";

const DEFAULT_PORT = 11000;

interface PlayerSettingsProps {
  players: Player[];
  /** Setup variant: shown when nothing is configured yet, hides Done. */
  setup?: boolean;
  onChanged: () => Promise<void> | void;
  onDone?: () => void;
}

export function PlayerSettings({
  players,
  setup = false,
  onChanged,
  onDone,
}: PlayerSettingsProps) {
  const [ip, setIp] = useState("");
  const [busy, setBusy] = useState(false);

  const handleAdd = async () => {
    const address = ip.trim();
    if (!isValidHost(address)) return;

    setBusy(true);
    const result = await api.addPlayer(address, DEFAULT_PORT, "");
    setBusy(false);

    if (isError(result)) {
      toaster.toast({ title: "BluOS Volume", body: result.error });
      return;
    }

    toaster.toast({ title: "Player added", body: result.name });
    setIp("");
    await onChanged();
  };

  const handleRemove = async (player: Player) => {
    setBusy(true);
    await api.removePlayer(player.ip, player.port);
    setBusy(false);
    await onChanged();
  };

  return (
    <PanelSection title={setup ? "BluOS Volume" : "Manage Players"}>
      {setup && (
        <PanelSectionRow>
          <div style={{ fontSize: "0.9em", opacity: 0.8, padding: "4px 0" }}>
            No players configured. Enter the IP address of a BluOS player on this network.
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        <TextField
          label="Player IP"
          value={ip}
          onChange={(event) => setIp(event.target.value)}
        />
      </PanelSectionRow>

      <PanelSectionRow>
        <ButtonItem
          layout="below"
          disabled={busy || !isValidHost(ip)}
          onClick={handleAdd}
        >
          {busy ? "Working…" : "Add Player"}
        </ButtonItem>
      </PanelSectionRow>

      {players.map((player) => (
        <PanelSectionRow key={playerKey(player)}>
          <ButtonItem
            layout="below"
            description={player.ip}
            disabled={busy}
            onClick={() => handleRemove(player)}
          >
            Remove {player.name}
          </ButtonItem>
        </PanelSectionRow>
      ))}

      {!setup && onDone && (
        <PanelSectionRow>
          <ButtonItem layout="below" onClick={onDone}>
            Done
          </ButtonItem>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}
