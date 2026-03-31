import { eq, and, isNotNull } from "drizzle-orm";
import type { DrizzleClient } from "@dragonbot/db";
import { users } from "@dragonbot/db";

export interface BirthdayRow {
  discordId: string;
  birthMonth: number;
  birthDay: number;
  birthYear: number | null;
}

export class BirthdayRepository {
  constructor(private db: DrizzleClient) {}

  async getUserBirthday(discordId: string): Promise<BirthdayRow | null> {
    const rows = await this.db
      .select({
        discordId: users.discordId,
        birthMonth: users.birthMonth,
        birthDay: users.birthDay,
        birthYear: users.birthYear,
      })
      .from(users)
      .where(eq(users.discordId, discordId))
      .limit(1);

    const row = rows[0];
    if (!row || row.birthMonth === null || row.birthDay === null) return null;
    return row as BirthdayRow;
  }

  async setBirthday(discordId: string, month: number, day: number, year: number | null): Promise<void> {
    // Upsert user row, then set birthday fields
    await this.db
      .insert(users)
      .values({ discordId, birthMonth: month, birthDay: day, birthYear: year })
      .onConflictDoUpdate({
        target: users.discordId,
        set: { birthMonth: month, birthDay: day, birthYear: year, updatedAt: new Date() },
      });
  }

  async removeBirthday(discordId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ birthMonth: null, birthDay: null, birthYear: null, updatedAt: new Date() })
      .where(eq(users.discordId, discordId));
  }

  async getBirthdaysByDate(month: number, day: number): Promise<BirthdayRow[]> {
    const rows = await this.db
      .select({
        discordId: users.discordId,
        birthMonth: users.birthMonth,
        birthDay: users.birthDay,
        birthYear: users.birthYear,
      })
      .from(users)
      .where(
        and(
          eq(users.birthMonth, month),
          eq(users.birthDay, day),
        ),
      );
    return rows as BirthdayRow[];
  }

  async getAllBirthdays(): Promise<BirthdayRow[]> {
    const rows = await this.db
      .select({
        discordId: users.discordId,
        birthMonth: users.birthMonth,
        birthDay: users.birthDay,
        birthYear: users.birthYear,
      })
      .from(users)
      .where(
        and(
          isNotNull(users.birthMonth),
          isNotNull(users.birthDay),
        ),
      );
    return rows as BirthdayRow[];
  }
}
