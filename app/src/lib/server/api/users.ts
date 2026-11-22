import { eq } from "drizzle-orm";

import type { UserPreferences } from "#lib/schemas.ts";
import { UserPreferencesSchema } from "#lib/schemas.ts";
import { getDb } from "../db";
import { users } from "../schema";

function parsePreferences(raw: string): UserPreferences {
  try {
    const result = UserPreferencesSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

export async function getUserPreferences(
  userId: number,
): Promise<UserPreferences> {
  const db = getDb();
  const rows = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows.length === 0) return {};
  return parsePreferences(rows[0].preferences);
}

export async function updateUserPreferences(
  userId: number,
  preferences: UserPreferences,
): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ preferences: users.preferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");
    if (rows.length === 0) return;

    const current = parsePreferences(rows[0].preferences);

    await tx
      .update(users)
      .set({ preferences: JSON.stringify({ ...current, ...preferences }) })
      .where(eq(users.id, userId));
  });
}
