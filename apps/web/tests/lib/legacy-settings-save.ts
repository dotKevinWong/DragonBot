// Verbatim copy of the request-building part of handleSave in
// apps/web/src/app/dashboard/server/[guildId]/page.tsx at git HEAD d09dc0c (lines 561-619),
// wrapped in a function. Only `settings`, `savedSettings` and `hasDiscordData` were closure
// variables; they are parameters here. Kept so the characterization tests can prove the
// extracted buildSettingsPatch builds the same PATCH body. Do not edit.
/* eslint-disable @typescript-eslint/no-explicit-any */
export function legacyBuildUpdateFields(settings: any, savedSettings: any | null, hasDiscordData: boolean): Record<string, unknown> {
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
    // turns the honeypot on sends all three, so what gets armed is what this tab shows.
    const turnsHoneypotOn = settings.isHoneypotEnabled && !savedSettings?.isHoneypotEnabled;
    if (settings.isHoneypotEnabled !== savedSettings?.isHoneypotEnabled) {
      updateFields.isHoneypotEnabled = settings.isHoneypotEnabled;
    }
    if (turnsHoneypotOn || settings.honeypotAction !== savedSettings?.honeypotAction) {
      updateFields.honeypotAction = settings.honeypotAction;
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
      if (turnsHoneypotOn || settings.honeypotChannelId !== savedSettings?.honeypotChannelId) {
        updateFields.honeypotChannelId = settings.honeypotChannelId;
      }
    }
    return updateFields;
}
