import { readdirSync } from 'node:fs';
import type { RigConfig } from './config.js';
import { readNight } from './digest/reader.js';
import type { RunStatus } from './digest/types.js';
import { lastBeat, type Beat } from './heartbeat.js';

export type NightStatus = {
  night: string;
  // Jobs by their latest status, not counts of historical attempts.
  counts: Record<RunStatus, number>;
};

export type Status = {
  adapter: string;
  installed: string;
  lastBeat: Beat | null;
  nights: NightStatus[];
};

// Nights on disk = runs/<YYYY-MM-DD>.jsonl, newest first.
export function nightsOnDisk(runsDir: string): string[] {
  try {
    return readdirSync(runsDir)
      .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .map((f) => f.slice(0, 10))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function readStatus(config: RigConfig): Promise<Status> {
  const nights = await Promise.all(nightsOnDisk(config.runsDir).map(async (night): Promise<NightStatus> => {
    const digest = await readNight(config.runsDir, night);
    const counts: NightStatus['counts'] = { ok: 0, retry: 0, fail: 0 };
    for (const row of digest.rows) counts[row.lastStatus]++;
    return { night, counts };
  }));

  return {
    adapter: config.adapter,
    installed: config.installed,
    lastBeat: lastBeat(),
    nights,
  };
}
