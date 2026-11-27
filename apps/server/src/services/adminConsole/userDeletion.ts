import { eq, inArray } from 'drizzle-orm';

import { serverDBEnv } from '@/config/db';
import { AdminConsoleModel } from '@/database/models/adminConsole';
import { files, globalFiles } from '@/database/schemas/file';
import type { LobeChatDatabase } from '@/database/type';
import { FileService } from '@/server/services/file';

interface OwnedFile {
  fileHash: string | null;
  url: string | null;
}

export interface UserDeletionResult {
  /** `files` rows the account owned at deletion time. */
  deletedFiles: number;
  /** Stored objects reclaimed from the file storage backend. */
  removedObjects: number;
}

const listOwnedFiles = async (db: LobeChatDatabase, userId: string): Promise<OwnedFile[]> =>
  db
    .select({ fileHash: files.fileHash, url: files.url })
    .from(files)
    .where(eq(files.userId, userId));

/**
 * Reclaim the stored objects of an account that was just deleted from the DB.
 *
 * `files` rows are gone by now (users cascade), so the pre-delete snapshot is
 * the only record of what the account uploaded. A hash still referenced by a
 * remaining `files` row belongs to another account through the dedupe table:
 * its object stays. Object deletion is best effort — an unreferenced object
 * left behind is recoverable garbage; a failed account deletion is not.
 */
const purgeOwnedObjects = async (
  db: LobeChatDatabase,
  userId: string,
  owned: OwnedFile[],
): Promise<number> => {
  if (owned.length === 0 || !serverDBEnv.REMOVE_GLOBAL_FILE) return 0;

  const hashes = [...new Set(owned.map((file) => file.fileHash).filter(Boolean))] as string[];

  const stillReferenced = new Set<string>();
  if (hashes.length > 0) {
    const remaining = await db
      .select({ fileHash: files.fileHash })
      .from(files)
      .where(inArray(files.fileHash, hashes));
    for (const row of remaining) if (row.fileHash) stillReferenced.add(row.fileHash);
  }

  const reclaimableHashes = hashes.filter((hash) => !stillReferenced.has(hash));
  const urls = new Set<string>();
  for (const file of owned) {
    if (!file.url) continue;
    if (file.fileHash && stillReferenced.has(file.fileHash)) continue;
    urls.add(file.url);
  }

  if (urls.size > 0) {
    try {
      await new FileService(db, userId).deleteFiles([...urls]);
    } catch (error) {
      console.error('[admin:delete-user] stored object cleanup failed', error);
      return 0;
    }
  }

  if (reclaimableHashes.length > 0) {
    try {
      await db.delete(globalFiles).where(inArray(globalFiles.hashId, reclaimableHashes));
    } catch (error) {
      console.error('[admin:delete-user] global file row cleanup failed', error);
    }
  }

  return urls.size;
};

/**
 * Permanently delete an account through the admin console (CUST-008 P1).
 *
 * Order matters: the file snapshot has to be taken before the DB delete, and
 * the storage sweep only makes sense after it. The model owns the guards and
 * the cascade; this wrapper adds the object-storage part that SQL cannot see.
 */
export const deleteUserAccount = async (
  db: LobeChatDatabase,
  actingUserId: string,
  userId: string,
): Promise<UserDeletionResult> => {
  const owned = await listOwnedFiles(db, userId);

  await new AdminConsoleModel(db, actingUserId).deleteUser(userId);

  const removedObjects = await purgeOwnedObjects(db, userId, owned);

  return { deletedFiles: owned.length, removedObjects };
};
