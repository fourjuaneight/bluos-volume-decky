/** Typed bindings for the Python methods on `Plugin` in main.py. */

import { callable } from "@decky/api";

import type { Maybe, Player, VolumeState } from "./types";

export const getPlayers = callable<[], Player[]>("get_players");

export const getLastSelected = callable<[], Pick<Player, "ip" | "port"> | null>(
  "get_last_selected",
);

export const setLastSelected = callable<[ip: string, port: number], boolean>(
  "set_last_selected",
);

export const addPlayer = callable<
  [ip: string, port: number, name: string],
  Maybe<Player>
>("add_player");

export const removePlayer = callable<[ip: string, port: number], boolean>(
  "remove_player",
);

export const getVolume = callable<[ip: string, port: number], Maybe<VolumeState>>(
  "get_volume",
);

export const setVolume = callable<
  [ip: string, level: number, port: number, tellSlaves: boolean],
  Maybe<VolumeState>
>("set_volume");

export const setMute = callable<
  [ip: string, mute: boolean, port: number],
  Maybe<VolumeState>
>("set_mute");
