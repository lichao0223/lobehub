import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Fork 迁移车道维护脚本（上游合并后运行）。
 *
 * 约定：`packages/database/migrations` 归上游所有；本 Fork 的迁移一律排在 journal 尾部，
 * 且 `idx` 落在 9000+ 保留区。drizzle-kit 用「最后一条 idx + 1」命名新迁移，所以 fork
 * 条目保持在队尾时，fork 自己生成的迁移会自动是 9001、9002…，不会占用上游编号。
 *
 * 运行时（drizzle-orm）只按 journal 数组顺序执行，并用 `when` 与已应用的
 * `__drizzle_migrations.created_at` 比较决定是否执行，`idx` 不参与执行判定。
 * 因此本脚本只维护「顺序 / idx 归属 / when 单调 / 快照基准」，不改任何 SQL。
 *
 * 用法：
 *   tsx scripts/fork/reconcileMigrations.ts          # 检查并修复
 *   tsx scripts/fork/reconcileMigrations.ts --check  # 只检查，需要修复时退出码 1
 */

const META_DIR = path.join(__dirname, '../../packages/database/migrations/meta');
const JOURNAL_PATH = path.join(META_DIR, '_journal.json');

/** Fork 迁移编号保留区起点。上游迁移永远在它之前。 */
const FORK_IDX_START = 9000;

/** Fork 自己拥有的表：快照里必须有，其余表必须与上游最新快照保持一致。新增 fork 表时在这里补一行。 */
const FORK_TABLES = ['public.deploy_resume_queue'];

const SNAPSHOT_FILE = /^(\d+)_snapshot\.json$/;

interface JournalEntry {
  breakpoints: boolean;
  idx: number;
  tag: string;
  version: string;
  when: number;
}

interface Journal {
  dialect: string;
  entries: JournalEntry[];
  version: string;
}

interface SnapshotMeta {
  columns?: Record<string, unknown>;
  schemas?: Record<string, unknown>;
  tables?: Record<string, unknown>;
}

interface Snapshot {
  [key: string]: unknown;
  _meta?: SnapshotMeta;
  dialect: string;
  id: string;
  prevId: string;
  tables: Record<string, unknown>;
  version: string;
}

interface SnapshotFile {
  idx: number;
  path: string;
  snapshot: Snapshot;
}

const readJournal = (): Journal => JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as Journal;

const readSnapshots = (): SnapshotFile[] => {
  const snapshots: SnapshotFile[] = [];

  for (const file of readdirSync(META_DIR)) {
    const match = SNAPSHOT_FILE.exec(file);
    if (!match) continue;

    const filePath = path.join(META_DIR, file);
    snapshots.push({
      idx: Number(match[1]),
      path: filePath,
      snapshot: JSON.parse(readFileSync(filePath, 'utf8')) as Snapshot,
    });
  }

  return snapshots.sort((a, b) => a.idx - b.idx);
};

const padded = (idx: number) => String(idx).padStart(4, '0');

const pick = (source: Record<string, unknown> | undefined, keys: string[]): Record<string, unknown> => {
  const picked: Record<string, unknown> = {};
  if (!source) return picked;

  for (const key of keys) {
    if (key in source) picked[key] = source[key];
  }

  return picked;
};

/** 深比较用：对象键排序，数组保持顺序。 */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => canonical(item));

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, canonical(item)]));
  }

  return value;
};

const sameJson = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

/** drizzle-kit 写出的 JSON 文件都以换行结尾，保持一致避免无意义 diff。 */
const writeJson = (filePath: string, value: unknown) => writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);

const stripIds = (snapshot: Snapshot) => {
  const copy: Record<string, unknown> = { ...snapshot };
  delete copy.id;
  delete copy.prevId;
  return copy;
};

/** 以最新上游快照为底，叠加 fork 表，重建 fork 快照（id 重新生成，prevId 指向上游快照）。 */
const buildSnapshot = (upstream: Snapshot, fork: Snapshot): Snapshot => {
  const tables = { ...upstream.tables };
  const forkMeta = fork._meta ?? {};
  const meta: SnapshotMeta = { ...upstream._meta };

  for (const table of FORK_TABLES) {
    tables[table] = fork.tables[table];
  }

  if (forkMeta.tables) meta.tables = { ...meta.tables, ...pick(forkMeta.tables, FORK_TABLES) };
  if (forkMeta.columns) meta.columns = { ...meta.columns, ...pick(forkMeta.columns, FORK_TABLES) };

  return { ...upstream, id: randomUUID(), prevId: upstream.id, tables, _meta: meta };
};

const main = () => {
  const checkOnly = process.argv.includes('--check');
  const journal = readJournal();
  const snapshots = readSnapshots();
  const migrationsDir = path.join(META_DIR, '..');

  const fixes: string[] = [];
  const problems: string[] = [];

  // 1. 每个 journal 条目都必须有对应的 SQL 文件。
  for (const entry of journal.entries) {
    if (!existsSync(path.join(migrationsDir, `${entry.tag}.sql`))) {
      problems.push(`缺少迁移文件 ${entry.tag}.sql`);
    }
  }

  const upstream = journal.entries.filter((entry) => entry.idx < FORK_IDX_START).sort((a, b) => a.idx - b.idx);
  const fork = journal.entries.filter((entry) => entry.idx >= FORK_IDX_START).sort((a, b) => a.idx - b.idx);

  // 2. 上游条目必须从 0 开始连续；fork 条目 idx 必须唯一。上游碰到保留区说明约定失效。
  upstream.forEach((entry, index) => {
    if (entry.idx !== index) {
      problems.push(`上游 journal idx 不连续：第 ${index} 条是 ${entry.idx}（${entry.tag}）`);
    }
  });

  const duplicated = new Set(journal.entries.map((entry) => entry.idx)).size !== journal.entries.length;
  if (duplicated) problems.push('journal idx 存在重复');

  // 3. 顺序：上游在前，fork 在尾；fork 条目按 idx 升序。
  const ordered = [...upstream, ...fork];
  const orderChanged = ordered.some((entry, index) => entry.tag !== journal.entries[index]?.tag);
  let journalChanged = orderChanged;
  if (orderChanged) fixes.push('journal 顺序：上游条目在前，fork 条目排在尾部');

  // 4. when：fork 条目必须晚于全部上游条目，且彼此递增。
  //    运行时按 `when > 已应用的最大 created_at` 判定，when 落后会导致迁移被永久跳过。
  let previousWhen = upstream.reduce((max, entry) => Math.max(max, entry.when), 0);
  for (const entry of fork) {
    if (entry.when <= previousWhen) {
      const nextWhen = previousWhen + 1;
      fixes.push(`journal when：${entry.tag} ${entry.when} → ${nextWhen}`);
      entry.when = nextWhen;
      journalChanged = true;
    }
    previousWhen = entry.when;
  }

  // 5. 快照基准：drizzle-kit 只拿「文件名排序最后一个」快照做 diff，
  //    即最新的 fork 快照。它必须等于「上游最新快照 + fork 表」，否则下次 generate 会重复上游变更。
  if (fork.length > 0) {
    const latestForkIdx = fork[fork.length - 1].idx;
    const upstreamSnapshot = [...snapshots].reverse().find((item) => item.idx < FORK_IDX_START);
    const forkSnapshot = [...snapshots].reverse().find((item) => item.idx >= FORK_IDX_START);

    if (!upstreamSnapshot) {
      problems.push('找不到上游快照（可能已被 prune 清理），无法校验 fork 快照内容');
    } else if (!forkSnapshot) {
      problems.push('找不到 fork 快照，无法确定快照基准；请先用 drizzle-kit 生成 fork 迁移');
    } else {
      const missingTables = FORK_TABLES.filter((table) => !forkSnapshot.snapshot.tables[table]);
      if (missingTables.length > 0) {
        problems.push(`fork 快照缺少表定义：${missingTables.join(', ')}`);
      } else {
        const targetPath = path.join(META_DIR, `${padded(latestForkIdx)}_snapshot.json`);
        const expected = buildSnapshot(upstreamSnapshot.snapshot, forkSnapshot.snapshot);
        const current: Snapshot | undefined = existsSync(targetPath)
          ? (JSON.parse(readFileSync(targetPath, 'utf8')) as Snapshot)
          : undefined;

        if (!current) {
          fixes.push(`快照：缺失 ${padded(latestForkIdx)}_snapshot.json，按上游快照重建`);
          if (!checkOnly) writeJson(targetPath, expected);
        } else if (!sameJson(stripIds(current), stripIds(expected))) {
          fixes.push(
            `快照：${padded(latestForkIdx)}_snapshot.json 与「上游最新快照 + fork 表」不一致，已按上游快照重建`,
          );
          if (!checkOnly) writeJson(targetPath, expected);
        } else if (current.prevId !== upstreamSnapshot.snapshot.id) {
          fixes.push(`快照：${padded(latestForkIdx)}_snapshot.json 的 prevId 指向上游快照`);
          if (!checkOnly) {
            writeJson(targetPath, { ...current, prevId: upstreamSnapshot.snapshot.id });
          }
        }
      }
    }
  }

  if (problems.length > 0) {
    console.error('❌ Fork 迁移车道存在问题：');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  if (checkOnly && fixes.length > 0) {
    console.error('❌ Fork 迁移车道需要修复（去掉 --check 或运行 bun run db:fork:reconcile）：');
    for (const fix of fixes) console.error(`  - ${fix}`);
    process.exit(1);
  }

  if (!checkOnly && fixes.length > 0) {
    if (journalChanged) writeJson(JOURNAL_PATH, { ...journal, entries: ordered });

    console.log('🔧 已修复：');
    for (const fix of fixes) console.log(`  - ${fix}`);
  }

  const upstreamRange = upstream.length > 0 ? `0–${upstream[upstream.length - 1].idx}` : '空';
  const forkRange = fork.length > 0 ? fork.map((entry) => entry.idx).join(', ') : '空';

  console.log('✅ Fork 迁移车道一致');
  console.log(`  upstream: ${upstreamRange}（${upstream.length} 条）`);
  console.log(`  fork: ${forkRange}（${fork.length} 条）`);
  console.log(`  快照基准: ${snapshots.length > 0 ? path.basename(snapshots[snapshots.length - 1].path) : '无'}`);
};

main();
