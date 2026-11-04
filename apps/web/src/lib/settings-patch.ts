import type { GuildSettings } from "./guild-settings";

/**
 * The PATCH /api/server/[guildId] body the settings page sends on save.
 * The route checks a scope for every key in the body, so which keys are present matters as
 * much as their values: keep the key set and order unless the route is meant to change too.
 *
 * @param settings       the settings as edited in this tab
 * @param saved          the settings as last loaded or saved (null before the first load)
 * @param hasDiscordData whether channels or roles loaded from Discord
 */
export function buildSettingsPatch(
  settings: GuildSettings,
  saved: GuildSettings | null,
  hasDiscordData: boolean,
): Record<string, unknown> {
  // Always include non-Discord fields
  const updateFields: Record<string, unknown> = {
    isVerificationSyncEnabled: settings.isVerificationSyncEnabled,
    isBanSyncEnabled: settings.isBanSyncEnabled,
    welcomeMessage: settings.welcomeMessage,
    isWelcomeEnabled: settings.isWelcomeEnabled,
    dmWelcomeMessage: settings.dmWelcomeMessage,
    isDmWelcomeEnabled: settings.isDmWelcomeEnabled,
    isLoggingEnabled: settings.isLoggingEnabled,
    logEvents: settings.logEvents,
    isIntroGateEnabled: settings.isIntroGateEnabled,
    introMinChars: settings.introMinChars,
    introMinWords: settings.introMinWords,
    introMinSubstantiveWords: settings.introMinSubstantiveWords,
    introUniqueWordRatio: settings.introUniqueWordRatio,
    introMaxRepeatedCharPct: settings.introMaxRepeatedCharPct,
    isSuggestionsEnabled: settings.isSuggestionsEnabled,
    isAskEnabled: settings.isAskEnabled,
    askSystemPrompt: settings.askSystemPrompt,
    offtopicImages: settings.offtopicImages,
    offtopicMessage: settings.offtopicMessage,
    isXpEnabled: settings.isXpEnabled,
    xpMin: settings.xpMin,
    xpMax: settings.xpMax,
    xpCooldownSeconds: settings.xpCooldownSeconds,
    xpExcludedChannelIds: settings.xpExcludedChannelIds,
    xpExcludedRoleIds: settings.xpExcludedRoleIds,
    isBirthdayEnabled: settings.isBirthdayEnabled,
    birthdayMessage: settings.birthdayMessage,
    birthdayTimezone: settings.birthdayTimezone,
  };

  // Send the honeypot fields only when this tab changed them, so a tab loaded before another admin's change
  // can't turn the honeypot back on, or put back an old action or channel, on an unrelated save. A save that
  // turns the honeypot on sends all three, so what gets armed is what this tab shows. The repeated-message
  // check works the same way: its three fields go only when changed, and a save that turns it on sends all three.
  const turnsHoneypotOn = settings.isHoneypotEnabled && !saved?.isHoneypotEnabled;
  if (settings.isHoneypotEnabled !== saved?.isHoneypotEnabled) {
    updateFields.isHoneypotEnabled = settings.isHoneypotEnabled;
  }
  if (turnsHoneypotOn || settings.honeypotAction !== saved?.honeypotAction) {
    updateFields.honeypotAction = settings.honeypotAction;
  }
  const turnsRepeatSpamOn = settings.isRepeatSpamEnabled && !saved?.isRepeatSpamEnabled;
  if (settings.isRepeatSpamEnabled !== saved?.isRepeatSpamEnabled) {
    updateFields.isRepeatSpamEnabled = settings.isRepeatSpamEnabled;
  }
  if (turnsRepeatSpamOn || settings.repeatSpamChannelCount !== saved?.repeatSpamChannelCount) {
    updateFields.repeatSpamChannelCount = settings.repeatSpamChannelCount;
  }
  if (turnsRepeatSpamOn || settings.repeatSpamMatchMode !== saved?.repeatSpamMatchMode) {
    updateFields.repeatSpamMatchMode = settings.repeatSpamMatchMode;
  }

  // Only include role/channel IDs if we successfully loaded Discord data
  // (prevents overwriting with null when API was rate-limited)
  if (hasDiscordData) {
    updateFields.verificationRoleId = settings.verificationRoleId;
    updateFields.welcomeChannelId = settings.welcomeChannelId;
    updateFields.logChannelId = settings.logChannelId;
    updateFields.introChannelId = settings.introChannelId;
    updateFields.introRoleId = settings.introRoleId;
    updateFields.modNotesChannelId = settings.modNotesChannelId;
    updateFields.xpLevelupChannelId = settings.xpLevelupChannelId;
    updateFields.birthdayChannelId = settings.birthdayChannelId;
    updateFields.birthdayRoleId = settings.birthdayRoleId;
    if (turnsHoneypotOn || settings.honeypotChannelId !== saved?.honeypotChannelId) {
      updateFields.honeypotChannelId = settings.honeypotChannelId;
    }
  }

  return updateFields;
}
