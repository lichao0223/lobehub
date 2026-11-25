import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * CUST-009 gate (test time): every server-side read of a lab flag must go
 * through the deployment resolver.
 *
 * In `admin` mode the console owns `preference.lab`, so a code path that read
 * the stored row directly would silently keep honouring the user's own switch —
 * the exact drift this whole feature exists to prevent. The resolver is cheap
 * to forget (a new gate is one `preference.lab?.enableX` away), so the read
 * points are pinned here: adding a read without wiring the resolver makes this
 * test fail.
 *
 * Implementation is a source-text scan rather than AST: it needs to see the
 * three shapes actually used in this repo (member access, optional member
 * access, and the raw jsonb operator inside a SQL template), and a scan keeps
 * the gate readable. The scanned roots are `apps/server/src` (server gates) and
 * `packages/database/src` (models). `packages/business-server/src` is excluded
 * on purpose: it *is* the resolver, so its reads are the implementation under
 * test elsewhere.
 */

const SCANNED_ROOTS = ['apps/server/src', 'packages/database/src'];

/** `preference.lab`, `preference?.lab`, and `->'lab'->>…` in a SQL template. */
const DIRECT_READ = /(?:^|[\s(=,{?])preference\??\.lab\b|->'lab'->>/;

/** `lab?.enableFoo`: a flag read off a `lab` this test cannot attribute. */
const FLAG_ACCESS = /\blab\??\.enable[A-Z]\w*/;

const TEST_FILE = /\.(?:test|spec)\.[cm]?tsx?$|(?:^|\/)__tests?__\//;

/** A comment line must not count as a read point. */
const COMMENT_LINE = /^\s*(?:\*|\/\/|\/\*)/;

interface ReadPoint {
  reason: string;
  /**
   * What makes the read trustworthy.
   * - a resolver name: the file must call it before touching the flag;
   * - `caller-tri-state`: the file receives the resolved answer as an argument
   *   (a SQL predicate cannot await a resolver inside a query builder).
   */
  via: string;
}

/**
 * Every file allowed to read a lab flag, and why.
 *
 * Each entry is pinned to the resolver it must go through, so the file cannot
 * quietly swap the resolver for a direct read and still pass.
 */
const READ_POINTS: Record<string, ReadPoint> = {
  'apps/server/src/routers/lambda/user/profile.ts': {
    reason: 'getUserState payload: hands the stored lab to resolveLabsForUserState',
    via: 'resolveLabsForUserState',
  },
  'apps/server/src/services/agentSignal/featureGate.ts': {
    reason: 'Agent Signal self-learning gate (cached user switch)',
    via: 'resolveEffectiveLabForPreference',
  },
  'apps/server/src/services/aiAgent/pipeline/codexDeviceRuntime.ts': {
    reason: 'Codex app-server lab decides the device runtime',
    via: 'resolveEffectiveLabForPreference',
  },
  'apps/server/src/services/aiAgent/pipeline/heteroDispatch/codexCollaboration.ts': {
    reason: 'Codex collaboration mode requires the app-server lab',
    via: 'resolveEffectiveLabForPreference',
  },
  'apps/server/src/services/aiAgent/pipeline/runSettings.ts': {
    reason: 'expertise injection follows the self-learning lab',
    via: 'resolveEffectiveLabForPreference',
  },
  'packages/database/src/models/agentSignal/nightlyReview.ts': {
    reason:
      'nightly review SQL predicate: resolves through options.selfLearningEnabled (admin mode drops the per-row filter)',
    via: 'caller-tri-state',
  },
};

/** Repo root, found by walking up to the workspace manifest. */
const repoRoot = (): string => {
  let dir = path.resolve(import.meta.dirname);

  for (let depth = 0; depth < 10; depth += 1) {
    try {
      if (statSync(path.join(dir, 'pnpm-workspace.yaml')).isFile()) return dir;
    } catch {
      // Keep walking: this level is not the workspace root.
    }
    const parent = path.resolve(dir, '..');
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error(`Could not locate the repository root from ${import.meta.dirname}`);
};

const collectSources = (root: string): string[] => {
  const files: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(?:ts|tsx|mts)$/.test(entry.name) && !TEST_FILE.test(full)) {
        files.push(full);
      }
    }
  };

  walk(root);
  return files;
};

interface LabRead {
  /** Line numbers (1-based) that read a flag, for the failure message. */
  lines: number[];
  path: string;
  text: string;
}

const scanLabReads = (): LabRead[] => {
  const root = repoRoot();
  const reads: LabRead[] = [];

  for (const scannedRoot of SCANNED_ROOTS) {
    for (const file of collectSources(path.join(root, scannedRoot))) {
      const text = readFileSync(file, 'utf8');
      const lines: number[] = [];

      text.split('\n').forEach((line, index) => {
        if (COMMENT_LINE.test(line)) return;
        if (DIRECT_READ.test(line) || FLAG_ACCESS.test(line)) lines.push(index + 1);
      });

      if (lines.length > 0) reads.push({ lines, path: path.relative(root, file), text });
    }
  }

  return reads;
};

describe('lab flag read points', () => {
  const reads = scanLabReads();

  it('finds the reads it is meant to police', () => {
    // Guards the scan itself: a broken regex or a moved directory would make
    // every assertion below pass vacuously.
    expect(reads.length).toBeGreaterThan(0);
  });

  it('reads lab flags only from whitelisted files', () => {
    const unlisted = reads.filter((read) => !(read.path in READ_POINTS));

    expect(
      unlisted.map(({ lines, path: file }) => `${file}:${lines.join(',')}`),
      [
        'These files read a lab flag without going through the CUST-009 resolver:',
        ...unlisted.map(({ lines, path: file }) => `  ${file}:${lines.join(',')}`),
        'Fix: resolve through resolveEffectiveLabForPreference(db, preference) (or',
        'resolveLabsForUserState for the user bootstrap) before reading the flag.',
        'A brand-new intentional read must be added to READ_POINTS in this file with its reason.',
      ].join('\n'),
    ).toEqual([]);
  });

  it('keeps the whitelist free of stale entries', () => {
    // The reverse direction: after a read point is deleted or refactored, the
    // allow-list entry must go too, or it silently re-authorises a future
    // direct read in the same file.
    const seen = new Set(reads.map((read) => read.path));
    const stale = Object.keys(READ_POINTS).filter((entry) => !seen.has(entry));

    expect(
      stale,
      `READ_POINTS lists files that no longer read a lab flag: ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('routes every read point through its declared resolver', () => {
    for (const read of reads) {
      const readPoint = READ_POINTS[read.path];

      if (readPoint.via === 'caller-tri-state') {
        // The SQL predicate cannot await: it must branch on the resolved
        // tri-state, keeping the per-row filter only for `undefined`.
        expect(read.text, `${read.path} must branch on the resolved tri-state`).toMatch(
          /selfLearningEnabled === undefined|selfLearningEnabled !== undefined/,
        );
        continue;
      }

      expect(read.text, `${read.path} must call ${readPoint.via}`).toContain(readPoint.via);
    }
  });

  it('gives every whitelisted read point a reason', () => {
    for (const [file, { reason }] of Object.entries(READ_POINTS)) {
      expect(reason.trim().length, `${file} needs a written reason`).toBeGreaterThan(0);
    }
  });
});
