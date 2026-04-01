export interface IntroValidationResult {
  valid: boolean;
  reason?: string;
}

export interface IntroValidationOptions {
  minChars: number;
  minWords: number;
  minSubstantiveWords: number;
  /** 0–100 percentage; 0 disables the check */
  uniqueWordRatio: number;
  /** 0–100 percentage; 0 disables the check */
  maxRepeatedCharPct: number;
}

/**
 * Common filler words that don't carry intro content.
 * A real introduction should contain substantive words beyond these
 * (names, majors, hobbies, locations with context, etc.).
 */
const STOP_WORDS = new Set([
  "hi", "hey", "hello", "yo", "sup",
  "everyone", "everybody", "guys", "all", "yall", "y'all",
  "nice", "meet", "meeting", "pleased",
  "i", "im", "i'm", "me", "my", "mine", "myself",
  "you", "your", "yours", "we", "our", "they", "them",
  "a", "an", "the", "this", "that", "these", "those",
  "is", "am", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "to", "in", "on", "at", "of", "for", "with", "from", "by",
  "and", "or", "but", "so", "just", "also", "too",
  "here", "there", "really", "very", "much", "well",
  "oh", "ya", "yeah", "yes", "no", "nah",
  "lol", "haha", "hehe", "lmao",
  "new", "glad",
]);

export function validateIntroduction(
  content: string,
  options: IntroValidationOptions,
): IntroValidationResult {
  const trimmed = content.trim();

  // --- Basic gates (existing) ---

  if (trimmed.length < options.minChars) {
    return {
      valid: false,
      reason: `Your introduction must be at least ${options.minChars} characters (currently ${trimmed.length}).`,
    };
  }

  const words = trimmed.split(/\s+/);
  const wordCount = words.length;

  if (wordCount < options.minWords) {
    return {
      valid: false,
      reason: `Your introduction must be at least ${options.minWords} words (currently ${wordCount}).`,
    };
  }

  // --- Repeated character check ---

  if (options.maxRepeatedCharPct > 0) {
    const noSpaces = trimmed.replace(/\s/g, "").toLowerCase();
    if (noSpaces.length > 0) {
      const charCounts = new Map<string, number>();
      for (const ch of noSpaces) {
        charCounts.set(ch, (charCounts.get(ch) ?? 0) + 1);
      }
      const maxCount = Math.max(...charCounts.values());
      const pct = (maxCount / noSpaces.length) * 100;
      if (pct > options.maxRepeatedCharPct) {
        return {
          valid: false,
          reason: `Your introduction contains too much repeated text. Please write a genuine introduction about yourself.`,
        };
      }
    }
  }

  // --- Unique word ratio ---

  if (options.uniqueWordRatio > 0) {
    const lowerWords = words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")).filter(Boolean);
    if (lowerWords.length > 0) {
      const uniqueCount = new Set(lowerWords).size;
      const ratio = (uniqueCount / lowerWords.length) * 100;
      if (ratio < options.uniqueWordRatio) {
        return {
          valid: false,
          reason: `Your introduction has too many repeated words. Please write a more detailed introduction.`,
        };
      }
    }
  }

  // --- Substantive word count ---

  if (options.minSubstantiveWords > 0) {
    const substantiveCount = words.filter((w) => {
      const cleaned = w.toLowerCase().replace(/[^a-z']/g, "");
      return cleaned.length > 2 && !STOP_WORDS.has(cleaned);
    }).length;

    if (substantiveCount < options.minSubstantiveWords) {
      return {
        valid: false,
        reason: `Your introduction needs more detail — tell us about yourself! Mention your name, major, hobbies, or interests (need at least ${options.minSubstantiveWords} substantive words, found ${substantiveCount}).`,
      };
    }
  }

  return { valid: true };
}
