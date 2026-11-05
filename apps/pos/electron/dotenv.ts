/**
 * Parse KEY=VALUE lines from a .env file.
 * Blank lines and comments are skipped. The first assignment of a key wins.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    if (key in out) continue;
    out[key] = m[2]!.trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

/** Merge a .env file into `into`. Keys already set are left alone (first file wins). */
export function mergeDotEnv(into: Record<string, string>, text: string): void {
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (!(key in into)) into[key] = value;
  }
}
