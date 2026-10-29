export type RunStatus = 'ok' | 'retry' | 'fail';

export type DigestRow = {
  job: string;
  // Owner from the last valid event, including an explicit null.
  owner: string | null;
  // Every valid event counts as a run; retry events also count as retries.
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // Most recent supplied error, retained even after a later successful event.
  lastError: string | null;
  // First/last valid events in append order, with original timestamp offsets.
  firstAt: string;
  lastAt: string;
};

export type NightDigest = {
  night: string;
  // Only a missing file is missing. An existing empty file has missing: false.
  missing: boolean;
  // Sorted by job using JavaScript string ordering.
  rows: DigestRow[];
  badLines: number;
};

/**
 * Signature of readNight, exported by ./reader.js.
 * Read runsDir/<night>.jsonl; night must be a real YYYY-MM-DD calendar date.
 * Invalid night names reject with RangeError before filesystem access.
 * Malformed JSON/schema lines count as badLines; a final newline is not a line.
 * ENOENT returns missing: true, empty rows and zero badLines; other I/O errors reject.
 */
export type ReadNight = (runsDir: string, night: string) => Promise<NightDigest>;
