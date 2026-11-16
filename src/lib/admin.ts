import type { User } from 'firebase/auth';

export const ADMIN_EMAIL = '8887ashu@gmail.com';
export const ADMIN_DISPLAY_NAME = 'Ashutosh Temgire';

export function isAdminUser(user: User | null | undefined): boolean {
  if (!user || !user.email) return false;
  return Boolean(
    user.emailVerified && user.email.trim().toLowerCase() === ADMIN_EMAIL,
  );
}

export async function getAuthHeaders(
  user: User | null | undefined,
): Promise<Record<string, string>> {
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
