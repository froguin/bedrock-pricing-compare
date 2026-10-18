/**
 * Write a JSON snapshot only when its content changed.
 *
 * Every collector run stamps a fresh `generated_at`. Rewriting an otherwise
 * identical file made the scheduled workflow commit a timestamp-only change
 * on every forced run, which then raced with (and rejected) human pushes.
 * If the existing file matches apart from `generated_at`, it is left alone.
 * Returns true when the file was written.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const strip = (o) => { const { generated_at, ...rest } = o; return JSON.stringify(rest); };

export function writeJsonIfChanged(path, obj, space) {
  if (existsSync(path)) {
    try {
      if (strip(JSON.parse(readFileSync(path, "utf8"))) === strip(obj)) return false;
    } catch { /* unreadable -> overwrite */ }
  }
  writeFileSync(path, JSON.stringify(obj, null, space));
  return true;
}
