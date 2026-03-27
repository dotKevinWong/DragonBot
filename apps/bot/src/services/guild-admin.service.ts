import { GuildAdminRepository } from "../repositories/guild-admin.repository.js";
import { AppError, ErrorCode } from "../types/errors.js";
import { PERMISSION_SCOPES, type PermissionScope } from "@dragonbot/db";
import { TTLCache } from "../utils/cache.js";

interface CachedAdmin {
  permissions: string[];
}

export class GuildAdminService {
  // Cache key: "guildId:discordId"
  private cache = new TTLCache<CachedAdmin | null>(86400); // 24h (invalidated on write, TTL is safety net only)

  constructor(private repo: GuildAdminRepository) {}

  private cacheKey(guildId: string, discordId: string): string {
    return `${guildId}:${discordId}`;
  }

  private async getCachedAdmin(guildId: string, discordId: string) {
    const key = this.cacheKey(guildId, discordId);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;

    const admin = await this.repo.findByGuildAndUser(guildId, discordId);
    const entry = admin ? { permissions: admin.permissions } : null;
    this.cache.set(key, entry);
    return entry;
  }

  /** Check if a user has a specific permission scope for a guild */
  async hasPermission(guildId: string, discordId: string, scope: PermissionScope): Promise<boolean> {
    const admin = await this.getCachedAdmin(guildId, discordId);
    if (!admin) return false;
    return admin.permissions.includes("*") || admin.permissions.includes(scope);
  }

  /** Check if a user has ANY permission for a guild (used for view-settings) */
  async hasAnyPermission(guildId: string, discordId: string): Promise<boolean> {
    const admin = await this.getCachedAdmin(guildId, discordId);
    return admin !== null && admin.permissions.length > 0;
  }

  /** Get all permissions for a user in a guild */
  async getPermissions(guildId: string, discordId: string): Promise<string[]> {
    const admin = await this.getCachedAdmin(guildId, discordId);
    return admin?.permissions ?? [];
  }

  /** List all admins for a guild */
  async listAdmins(guildId: string) {
    return this.repo.findAllByGuild(guildId);
  }

  /** Add or update a guild admin with the given permissions */
  async addAdmin(
    guildId: string,
    discordId: string,
    permissions: string[],
    addedBy: string,
  ) {
    const validated = this.validatePermissions(permissions);
    const result = await this.repo.upsert(guildId, discordId, validated, addedBy);
    this.cache.invalidate(this.cacheKey(guildId, discordId));
    return result;
  }

  /** Remove a guild admin */
  async removeAdmin(guildId: string, discordId: string): Promise<void> {
    const removed = await this.repo.remove(guildId, discordId);
    if (!removed) {
      throw new AppError(ErrorCode.ADMIN_NOT_FOUND, "That user is not a guild manager.");
    }
    this.cache.invalidate(this.cacheKey(guildId, discordId));
  }

  /** Update permissions for an existing guild admin */
  async updatePermissions(
    guildId: string,
    discordId: string,
    permissions: string[],
    _updatedBy: string,
  ) {
    const existing = await this.repo.findByGuildAndUser(guildId, discordId);
    if (!existing) {
      throw new AppError(ErrorCode.ADMIN_NOT_FOUND, "That user is not a guild manager.");
    }
    const validated = this.validatePermissions(permissions);
    const result = await this.repo.upsert(guildId, discordId, validated, existing.addedBy);
    this.cache.invalidate(this.cacheKey(guildId, discordId));
    return result;
  }

  /** Validate that all permission strings are recognized scopes */
  private validatePermissions(permissions: string[]): string[] {
    const validScopes = PERMISSION_SCOPES as readonly string[];
    const invalid = permissions.filter((p) => !validScopes.includes(p));
    if (invalid.length > 0) {
      throw new AppError(
        ErrorCode.VALIDATION_ERROR,
        `Invalid permission scopes: ${invalid.join(", ")}. Valid scopes: ${PERMISSION_SCOPES.join(", ")}`,
      );
    }
    return permissions;
  }
}
