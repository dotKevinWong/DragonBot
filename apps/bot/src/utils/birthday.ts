export const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The year of a birthday's next occurrence, counting today: this year, or next year once it has passed. Uses local
 * time. Feb 29 counts as not yet passed until March, so in a non-leap year it gives this year.
 */
export function nextBirthdayYear(month: number, day: number, now: Date): number {
  const todayMonth = now.getMonth() + 1;
  const todayDay = now.getDate();
  const passed = month < todayMonth || (month === todayMonth && day < todayDay);
  return passed ? now.getFullYear() + 1 : now.getFullYear();
}
