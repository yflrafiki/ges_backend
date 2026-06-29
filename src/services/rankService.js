// Ghana Education Service rank ladder, lowest to highest — must match
// GRADES in ges-hr-admin/src/constants/teacherOptions.ts, since that's what
// the "Current Grade / Rank" picker offers when an account is created.
const GRADE_ORDER = [
  'Pupil Teacher', 'Superintendent II', 'Superintendent I',
  'Senior Superintendent II', 'Senior Superintendent I', 'Principal Superintendent',
  'Assistant Director II', 'Assistant Director I', 'Deputy Director',
  'Director II', 'Director I', 'Deputy Director-General', 'Director-General',
];

// Promotion requires this many years of satisfactory service at the
// teacher's current rank, measured from national_date_of_present_rank (the
// "notional date") — not total years of service / date of first appointment.
const MIN_YEARS_IN_RANK = 4;

const getNextGrade = (currentGrade) => {
  const currentIndex = GRADE_ORDER.indexOf(currentGrade);
  if (currentIndex === -1 || currentIndex === GRADE_ORDER.length - 1) return null;
  return GRADE_ORDER[currentIndex + 1];
};

// Years in current rank is derived from national_date_of_present_rank, not
// a number anyone enters — it changes every day, so storing a snapshot would
// go stale immediately. Every read recomputes it fresh from that date.
const computeYearsInRank = (nationalDateOfPresentRank) => {
  if (!nationalDateOfPresentRank) return null;
  const start = new Date(nationalDateOfPresentRank);
  if (isNaN(start)) return null;
  const years = (Date.now() - start.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
  return Math.floor(years * 100) / 100;
};

module.exports = { GRADE_ORDER, MIN_YEARS_IN_RANK, getNextGrade, computeYearsInRank };
