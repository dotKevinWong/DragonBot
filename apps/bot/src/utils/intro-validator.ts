export interface IntroValidationResult {
  valid: boolean;
  reason?: string;
}

export function validateIntroduction(
  content: string,
  minChars: number,
  minWords: number,
): IntroValidationResult {
  const trimmed = content.trim();

  if (trimmed.length < minChars) {
    return {
      valid: false,
      reason: `Your introduction must be at least ${minChars} characters (currently ${trimmed.length}).`,
    };
  }

  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount < minWords) {
    return {
      valid: false,
      reason: `Your introduction must be at least ${minWords} words (currently ${wordCount}).`,
    };
  }

  return { valid: true };
}
