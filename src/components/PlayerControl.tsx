import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  SliderField,
  Spinner,
  ToggleField,
} from "@decky/ui";
import { toaster } from "@decky/api";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FaChevronLeft } from "react-icons/fa";

import * as api from "../api";
import { isError, type Player, type VolumeState } from "../types";
import { debounce } from "../utils";

// Long enough to coalesce a drag into one request, short enough that the
// player responds while the thumb is still under your finger.
const COMMIT_DELAY_MS = 250;
const VOLUME_STEP = 5;

interface PlayerControlProps {
  player: Player;
  /** Only rendered when more than one player is configured. */
  onBack?: () => void;
  onOpenSettings: () => void;
}

export function PlayerControl({ player, onBack, onOpenSettings }: PlayerControlProps) {
  const [state, setState] = useState<VolumeState | null>(null);
  const [level, setLevel] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    const result = await api.getVolume(player.ip, player.port);

    if (isError(result)) {
      setError(result.error);
    } else {
      setError("");
      setState(result);
      setLevel(Math.max(0, result.volume));
    }
    setLoading(false);
  }, [player.ip, player.port]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const commit = useMemo(
    () =>
      debounce((value: number) => {
        void (async () => {
          const result = await api.setVolume(player.ip, value, player.port, false);
          if (isError(result)) {
            toaster.toast({ title: "BluOS Volume", body: result.error });
            setError(result.error);
          } else {
            setError("");
            setState(result);
          }
        })();
      }, COMMIT_DELAY_MS),
    [player.ip, player.port],
  );

  useEffect(() => () => commit.cancel(), [commit]);

  const onVolumeChange = useCallback(
    (value: number) => {
      // Local state moves immediately; the request is sent once movement stops.
      setLevel(value);
      commit(value);
    },
    [commit],
  );

  const onMuteChange = useCallback(
    async (mute: boolean) => {
      setState((prev) => (prev ? { ...prev, mute } : prev));
      const result = await api.setMute(player.ip, mute, player.port);
      if (isError(result)) {
        toaster.toast({ title: "BluOS Volume", body: result.error });
        // Put the toggle back where it was; the player never changed.
        setState((prev) => (prev ? { ...prev, mute: !mute } : prev));
      } else {
        setState(result);
      }
    },
    [player.ip, player.port],
  );

  const header = onBack ? (
    <PanelSectionRow>
      <ButtonItem layout="below" onClick={onBack}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <FaChevronLeft />
          <span>{player.name}</span>
        </div>
      </ButtonItem>
    </PanelSectionRow>
  ) : null;

  const footer = (
    <PanelSectionRow>
      <ButtonItem layout="below" onClick={onOpenSettings}>
        Settings
      </ButtonItem>
    </PanelSectionRow>
  );

  if (loading) {
    return (
      <PanelSection title={onBack ? undefined : player.name}>
        {header}
        <PanelSectionRow>
          <Spinner style={{ height: "32px" }} />
        </PanelSectionRow>
        {footer}
      </PanelSection>
    );
  }

  if (state?.fixed) {
    return (
      <PanelSection title={onBack ? undefined : player.name}>
        {header}
        <PanelSectionRow>
          <div style={{ fontSize: "0.9em", opacity: 0.7, padding: "4px 0" }}>
            This player has a fixed output level. Volume is controlled downstream.
          </div>
        </PanelSectionRow>
        {footer}
      </PanelSection>
    );
  }

  return (
    <PanelSection title={onBack ? undefined : player.name}>
      {header}

      {error && (
        <PanelSectionRow>
          <div style={{ fontSize: "0.8em", color: "#e57373", padding: "4px 0" }}>
            {error}
          </div>
        </PanelSectionRow>
      )}

      <PanelSectionRow>
        {/* Dimmed while muted, but still adjustable so you can set a level
            before unmuting. */}
        <div style={{ opacity: state?.mute ? 0.5 : 1 }}>
          <SliderField
            label="Volume"
            value={level}
            min={0}
            max={100}
            step={VOLUME_STEP}
            showValue
            onChange={onVolumeChange}
          />
        </div>
      </PanelSectionRow>

      <PanelSectionRow>
        <ToggleField
          label="Mute"
          checked={state?.mute ?? false}
          onChange={onMuteChange}
        />
      </PanelSectionRow>

      {footer}
    </PanelSection>
  );
}
