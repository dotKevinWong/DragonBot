const COURSE_CODE_REGEX = /^([A-Z]{2,4})\s*(\d{3})$/i;

export function validateCourseCode(input: string): boolean {
  return COURSE_CODE_REGEX.test(input.trim());
}

export function formatCourseCode(input: string): string | null {
  const match = input.trim().match(COURSE_CODE_REGEX);
  if (!match) return null;
  return `${match[1].toUpperCase()} ${match[2]}`;
}
