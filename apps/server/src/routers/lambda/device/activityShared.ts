import type { DeviceEnroller } from '@lobechat/types';

import type { TopicModel } from '@/database/models/topic';
import { UserModel } from '@/database/models/user';

/**
 * "Who is running what on this device" — shared by the personal device page and
 * the admin console detail page, so both name the same person for the same run.
 */

/**
 * Display info for the members behind a set of running topics. The ids come
 * from topic rows the caller was already allowed to read, so this only adds
 * the public-facing name and avatar.
 */
export const loadTopicUsers = async (
  db: Parameters<typeof UserModel.getDisplayInfoByIds>[0],
  userIds: string[],
): Promise<Map<string, DeviceEnroller>> => {
  const rows = await UserModel.getDisplayInfoByIds(db, [...new Set(userIds)]);
  return new Map(
    rows.map((u) => [
      u.id,
      { avatar: u.avatar, fullName: u.fullName, userId: u.id, username: u.username },
    ]),
  );
};

/**
 * The member running each topic now: the initiator of its current run, else
 * its creator (a client-executed run writes no operation row). In a workspace
 * a teammate can continue someone else's topic, so the creator alone would
 * name the wrong person as using the device.
 */
export const resolveRunUserIds = async (
  topicModel: TopicModel,
  topics: { id: string; userId: string }[],
): Promise<Map<string, string>> => {
  const initiators = await topicModel.findRunInitiators(topics.map((topic) => topic.id));
  return new Map(topics.map((topic) => [topic.id, initiators.get(topic.id) ?? topic.userId]));
};
