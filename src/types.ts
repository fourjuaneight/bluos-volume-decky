/** Shapes mirroring what `main.py` returns across the bridge. */

export interface Player {
  ip: string;
  port: number;
  name: string;
}

export interface VolumeState {
  /** 0-100. Negative means the player runs at a fixed output level. */
  volume: number;
  mute: boolean;
  db: string;
  fixed: boolean;
}

/** Backend methods never throw; failures arrive as `{error}`. */
export type Maybe<T> = T | { error: string };

export function isError<T>(value: Maybe<T>): value is { error: string } {
  return !!value && typeof value === "object" && "error" in value;
}

export function playerKey(player: Pick<Player, "ip" | "port">): string {
  return `${player.ip}:${player.port}`;
}

export function samePlayer(
  a: Pick<Player, "ip" | "port"> | null | undefined,
  b: Pick<Player, "ip" | "port"> | null | undefined,
): boolean {
  return !!a && !!b && a.ip === b.ip && a.port === b.port;
}
