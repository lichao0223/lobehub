import dayjs from 'dayjs';

export const formatDateTime = (value: Date | string | null | undefined) =>
  value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';

export const userDisplayName = (user: {
  email: string | null;
  fullName: string | null;
  username: string | null;
}) => user.fullName || user.username || user.email || '—';
