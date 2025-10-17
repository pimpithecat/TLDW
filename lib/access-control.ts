import type { User } from '@supabase/supabase-js';

const unlimitedVideoUsers = new Set(
  (process.env.UNLIMITED_VIDEO_USERS ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
);

export function hasUnlimitedVideoAllowance(user: User | null | undefined): boolean {
  if (!user) {
    return false;
  }

  if (unlimitedVideoUsers.size === 0) {
    return false;
  }

  const normalizedId = user.id.toLowerCase();
  if (unlimitedVideoUsers.has(normalizedId)) {
    return true;
  }

  const email = user.email?.toLowerCase();
  return email ? unlimitedVideoUsers.has(email) : false;
}
