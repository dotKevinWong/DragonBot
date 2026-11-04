import { describe, it, expect } from "vitest";
import { AppError, ErrorCode } from "../../src/types/errors.js";

describe("AppError", () => {
  it("carries its code and message", () => {
    const err = new AppError(ErrorCode.VALIDATION_ERROR, "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("AppError");
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("nope");
  });

  it("keeps the string values of the codes in use", () => {
    expect({
      VERIFICATION_EXPIRED: ErrorCode.VERIFICATION_EXPIRED,
      INVALID_EMAIL_DOMAIN: ErrorCode.INVALID_EMAIL_DOMAIN,
      ALREADY_VERIFIED: ErrorCode.ALREADY_VERIFIED,
      PROFILE_DISABLED: ErrorCode.PROFILE_DISABLED,
      PROFILE_NOT_FOUND: ErrorCode.PROFILE_NOT_FOUND,
      SUGGESTIONS_DISABLED: ErrorCode.SUGGESTIONS_DISABLED,
      ADMIN_NOT_FOUND: ErrorCode.ADMIN_NOT_FOUND,
      NOT_FOUND: ErrorCode.NOT_FOUND,
      VALIDATION_ERROR: ErrorCode.VALIDATION_ERROR,
    }).toEqual({
      VERIFICATION_EXPIRED: "VERIFICATION_EXPIRED",
      INVALID_EMAIL_DOMAIN: "INVALID_EMAIL_DOMAIN",
      ALREADY_VERIFIED: "ALREADY_VERIFIED",
      PROFILE_DISABLED: "PROFILE_DISABLED",
      PROFILE_NOT_FOUND: "PROFILE_NOT_FOUND",
      SUGGESTIONS_DISABLED: "SUGGESTIONS_DISABLED",
      ADMIN_NOT_FOUND: "ADMIN_NOT_FOUND",
      NOT_FOUND: "NOT_FOUND",
      VALIDATION_ERROR: "VALIDATION_ERROR",
    });
  });
});
