import { ButtonItem, PanelSection, PanelSectionRow } from "@decky/ui";
import { FaPlay } from "react-icons/fa";

import { playerKey, type Player } from "../types";

interface PlayerPickerProps {
  players: Player[];
  onSelect: (player: Player) => void;
  onOpenSettings: () => void;
}

export function PlayerPicker({ players, onSelect, onOpenSettings }: PlayerPickerProps) {
  return (
    <PanelSection title="Select Player">
      {players.map((player) => (
        <PanelSectionRow key={playerKey(player)}>
          <ButtonItem
            layout="below"
            description={player.ip}
            onClick={() => onSelect(player)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <FaPlay />
              <span>{player.name}</span>
            </div>
          </ButtonItem>
        </PanelSectionRow>
      ))}

      <PanelSectionRow>
        <ButtonItem layout="below" onClick={onOpenSettings}>
          Settings
        </ButtonItem>
      </PanelSectionRow>
    </PanelSection>
  );
}
