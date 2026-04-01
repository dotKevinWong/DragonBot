import { describe, it, expect } from "vitest";
import { validateIntroduction, type IntroValidationOptions } from "../../src/utils/intro-validator.js";

const defaults: IntroValidationOptions = {
  minChars: 24,
  minWords: 5,
  minSubstantiveWords: 3,
  uniqueWordRatio: 50,
  maxRepeatedCharPct: 50,
};

function validate(content: string, overrides: Partial<IntroValidationOptions> = {}) {
  return validateIntroduction(content, { ...defaults, ...overrides });
}

describe("validateIntroduction", () => {
  describe("basic gates", () => {
    it("rejects messages below min chars", () => {
      const result = validate("hi there");
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("characters");
    });

    it("rejects messages below min words", () => {
      const result = validate("superlongwordthatismorethan24chars", { minWords: 5 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("words");
    });
  });

  describe("repeated character check", () => {
    it("rejects messages with excessive character repetition", () => {
      const result = validate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra words here now", { maxRepeatedCharPct: 50 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("repeated");
    });

    it("allows normal text", () => {
      const result = validate("Hi I'm Kevin studying computer science at Drexel and I like hiking", { maxRepeatedCharPct: 50 });
      expect(result.valid).toBe(true);
    });

    it("skips check when set to 0", () => {
      const result = validate("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra words here now", {
        maxRepeatedCharPct: 0,
        minSubstantiveWords: 0,
        uniqueWordRatio: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("unique word ratio", () => {
    it("rejects messages with too many repeated words", () => {
      const result = validate("hi hi hi hi hi hi hi hi hi hi", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 0,
        uniqueWordRatio: 50,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("repeated words");
    });

    it("allows messages with diverse words", () => {
      const result = validate("Hi I'm Kevin studying computer science at Drexel and I like hiking");
      expect(result.valid).toBe(true);
    });

    it("skips check when set to 0", () => {
      const result = validate("hi hi hi hi hi hi hi hi hi hi", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 0,
        uniqueWordRatio: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("substantive word count", () => {
    it("rejects messages with only filler words", () => {
      const result = validate("hey everyone nice to meet you all here", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 3,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain("substantive");
    });

    it("rejects low-effort intros like 'hi im from florida'", () => {
      // "florida" is the only substantive word (>2 chars, not a stop word)
      const result = validate("hey everyone im from florida nice to meet you", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 3,
      });
      expect(result.valid).toBe(false);
    });

    it("accepts real introductions", () => {
      const result = validate(
        "Hi I'm Kevin, CS major from Philly, I like hiking and gaming",
      );
      expect(result.valid).toBe(true);
    });

    it("accepts intros with hobbies and details", () => {
      const result = validate(
        "Hello everyone I'm Sarah studying biology and I love photography and cooking",
      );
      expect(result.valid).toBe(true);
    });

    it("skips check when set to 0", () => {
      const result = validate("hey everyone nice to meet you all here", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("all checks disabled", () => {
    it("only applies basic gates when heuristics are all 0", () => {
      const result = validate("hey everyone nice to meet you all here", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 0,
        uniqueWordRatio: 0,
        maxRepeatedCharPct: 0,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = validate("");
      expect(result.valid).toBe(false);
    });

    it("handles whitespace-only string", () => {
      const result = validate("   ");
      expect(result.valid).toBe(false);
    });

    it("handles mixed case stop words", () => {
      const result = validate("HEY EVERYONE NICE TO MEET YOU ALL HERE", {
        minChars: 1,
        minWords: 1,
        minSubstantiveWords: 3,
      });
      expect(result.valid).toBe(false);
    });

    it("handles punctuation around substantive words", () => {
      // "kevin" "studying" "computer" "science" should all count
      const result = validate(
        "Hi! I'm Kevin, studying computer science. Love it!",
      );
      expect(result.valid).toBe(true);
    });
  });
});
