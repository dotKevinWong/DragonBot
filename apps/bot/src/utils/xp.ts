/**
 * Pure XP/level math utilities.
 * MEE6-style formula: XP required for level N = 5 * N^2 + 50 * N + 100
 */

/** XP required to go from level (N-1) to level N. */
export function xpForLevel(level: number): number {
  return 5 * level * level + 50 * level + 100;
}

/** Total cumulative XP required to reach a given level from 0. */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += xpForLevel(i);
  }
  return total;
}

/** Calculate the current level from a total XP amount. */
export function levelFromXp(totalXp: number): number {
  let level = 0;
  let xpNeeded = 0;
  while (true) {
    const next = xpForLevel(level + 1);
    if (xpNeeded + next > totalXp) break;
    xpNeeded += next;
    level++;
  }
  return level;
}

/** Random XP in the range [min, max] (inclusive). */
export function randomXp(min: number, max: number): number {
  if (min > max) [min, max] = [max, min];
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** XP progress within the current level: { current, required } */
export function xpProgress(totalXp: number, level: number): { current: number; required: number } {
  const baseXp = totalXpForLevel(level);
  const current = totalXp - baseXp;
  const required = xpForLevel(level + 1);
  return { current, required };
}

/** Generate a text-based progress bar. */
export function progressBar(current: number, total: number, length = 10): string {
  if (total <= 0) return "░".repeat(length);
  const ratio = Math.max(0, Math.min(1, current / total));
  const filled = Math.round(ratio * length);
  const empty = length - filled;
  return "▓".repeat(filled) + "░".repeat(empty);
}
