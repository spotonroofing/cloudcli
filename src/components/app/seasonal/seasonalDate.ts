export type SeasonalMoment = 'april' | 'september' | 'halloween' | 'winter';

const WINTER_START_MONTH = 11;
const WINTER_END_MONTH = 0;

export function getSeasonalMoment(date: Date): SeasonalMoment | null {
  const month = date.getMonth();
  const day = date.getDate();

  if (month === 3 && day === 1) return 'april';
  if (month === 8 && day === 5) return 'september';
  if (month === 9 && day === 31) return 'halloween';
  if ((month === WINTER_START_MONTH && day >= 1) || (month === WINTER_END_MONTH && day <= 6)) return 'winter';

  return null;
}
