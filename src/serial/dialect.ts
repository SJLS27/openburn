/**
 * Controller dialects. Most machines speak stock GRBL; xTool's firmware (D1
 * and similar) answers to GRBL commands but differs in ways that matter:
 *
 * - Input is strictly line based. GRBL's bare '?' real-time poll is buffered
 *   and corrupts the next command, so status needs '?\n'.
 * - That status reply comes with an extra 'ok', which would be miscounted as a
 *   line acknowledgement while a job streams, so polling pauses during jobs.
 * - '$J=' jogs are acknowledged but ignored, and motion commands are only
 *   executed after an M2 program end (this is also how LightBurn jogs it).
 * - Status reports carry no state word: '<MPos:x,y,z,a>'.
 * - It emits 'ok:IDLE' / 'ok:512' chatter that is not an acknowledgement.
 */
export type Dialect = 'grbl' | 'xtool';

/** Device setting: detect from the controller's '$I' reply, or force one. */
export type FirmwareSetting = 'auto' | Dialect;

/** Sent on connect when auto-detecting; both dialects answer '$I'. */
export const IDENTIFY_COMMAND = '\n$I\n';

/** How long to wait for an identification before assuming stock GRBL. */
export const IDENTIFY_TIMEOUT_MS = 1500;

/** Dialect announced by a controller line, or null if the line says nothing. */
export function dialectFromLine(line: string): Dialect | null {
  if (/^\[XTool/i.test(line)) return 'xtool';
  if (/^\[VER:|^Grbl /.test(line)) return 'grbl';
  return null;
}

/** Status poll to send now, or null to skip this tick. */
export function statusPoll(dialect: Dialect, jobActive: boolean): string | null {
  if (dialect === 'xtool') return jobActive ? null : '?\n';
  return '?';
}

/** Lines that move the head by (dx, dy) mm at `feed` mm/min, laser off. */
export function jogLines(dialect: Dialect, dx: number, dy: number, feed: number): string[] {
  const axes = [dx !== 0 ? `X${dx}` : '', dy !== 0 ? `Y${dy}` : ''].filter(Boolean).join(' ');
  if (dialect === 'xtool') return ['G91', `G1 ${axes} F${feed} S0`, 'G90', 'M2'];
  return [`$J=G91 ${axes} F${feed}`];
}

/** Controller output that is neither data nor an acknowledgement. */
export function isChatter(line: string): boolean {
  return line.startsWith('ok:');
}
