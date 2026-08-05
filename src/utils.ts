/**
 * Trailing-edge debounce.
 *
 * `SliderField` exposes no release event, only a continuous `onChange`, so
 * "send on release" is approximated by committing the last value once
 * movement stops. This keeps one HTTP request per adjustment instead of one
 * per step, which also stays inside BluOS's rate limit.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): ((...args: Args) => void) & { cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;

  const debounced = (...args: Args) => {
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = undefined;
      fn(...args);
    }, waitMs);
  };

  debounced.cancel = () => {
    if (handle !== undefined) clearTimeout(handle);
    handle = undefined;
  };

  return debounced;
}

/** Loose IPv4 / hostname check for the add-player field. */
export function isValidHost(value: string): boolean {
  const host = value.trim();
  if (!host) return false;
  const match = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (match) {
    return match.slice(1).every((octet) => Number(octet) <= 255);
  }
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9-]+)*$/.test(host);
}
