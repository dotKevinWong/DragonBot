export enum ErrorCode {
  // Verification
  VERIFICATION_EXPIRED = "VERIFICATION_EXPIRED",
  INVALID_EMAIL_DOMAIN = "INVALID_EMAIL_DOMAIN",
  ALREADY_VERIFIED = "ALREADY_VERIFIED",

  // Profile
  PROFILE_DISABLED = "PROFILE_DISABLED",
  PROFILE_NOT_FOUND = "PROFILE_NOT_FOUND",

  // Suggestions
  SUGGESTIONS_DISABLED = "SUGGESTIONS_DISABLED",

  // Permissions
  ADMIN_NOT_FOUND = "ADMIN_NOT_FOUND",

  // General
  NOT_FOUND = "NOT_FOUND",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
