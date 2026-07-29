const pool = require('../config/db');

// Retirement age used across GES (civil service statutory age).
const RETIREMENT_AGE = 60;

// A teacher is "junior" if they have fewer than 10 years of service —
// a rough proxy for pipeline capacity to fill senior vacancies.
const JUNIOR_THRESHOLD_YEARS = 10;

const getCrisis = async (req, res) => {
  try {
    const [summaryRes, districtRes, waveRes, gradeRes] = await Promise.all([

      // Overall summary counts
      pool.query(`
        SELECT
          COUNT(*)::int                                                        AS total_active,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 year'
          )::int                                                               AS retiring_1yr,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 years'
          )::int                                                               AS retiring_3yr,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 years'
          )::int                                                               AS retiring_5yr
        FROM teachers
        WHERE employment_status = 'active'
      `),

      // Per-district breakdown
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(current_district), ''), 'Unknown')  AS district,
          COALESCE(NULLIF(TRIM(current_region),   ''), 'Unknown')  AS region,
          COUNT(*)::int                                              AS total,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '1 year'
          )::int                                                     AS retiring_1yr,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '3 years'
          )::int                                                     AS retiring_3yr,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 years'
          )::int                                                     AS retiring_5yr,
          COUNT(*) FILTER (
            WHERE years_of_service < ${JUNIOR_THRESHOLD_YEARS}
          )::int                                                     AS junior_count
        FROM teachers
        WHERE employment_status = 'active'
        GROUP BY current_district, current_region
        HAVING COUNT(*) > 0
        ORDER BY retiring_5yr DESC, total DESC
      `),

      // Year-by-year retirement wave (next 5 years)
      pool.query(`
        SELECT
          EXTRACT(YEAR FROM (date_of_birth + INTERVAL '${RETIREMENT_AGE} years'))::int AS year,
          COUNT(*)::int                                                                  AS retirements
        FROM teachers
        WHERE employment_status = 'active'
          AND date_of_birth IS NOT NULL
          AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
              BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 years'
        GROUP BY year
        ORDER BY year
      `),

      // Grade breakdown — which ranks are most exposed
      pool.query(`
        SELECT
          COALESCE(NULLIF(TRIM(current_grade), ''), 'Unknown')  AS grade,
          COUNT(*)::int                                           AS total,
          COUNT(*) FILTER (
            WHERE date_of_birth IS NOT NULL
              AND date_of_birth + INTERVAL '${RETIREMENT_AGE} years'
                  BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '5 years'
          )::int                                                  AS retiring_5yr
        FROM teachers
        WHERE employment_status = 'active'
          AND current_grade IS NOT NULL AND TRIM(current_grade) <> ''
        GROUP BY current_grade
        ORDER BY retiring_5yr DESC, total DESC
        LIMIT 10
      `),
    ]);

    const summary = summaryRes.rows[0] || {
      total_active: 0, retiring_1yr: 0, retiring_3yr: 0, retiring_5yr: 0,
    };

    // Compute a risk score per district.
    // Score = (% retiring in 5yr × 70) + (gap % × 30), capped at 100.
    // Gap = max(0, retiring_5yr − junior_count).
    const districts = districtRes.rows.map((d) => {
      const pct5yr  = d.total > 0 ? d.retiring_5yr / d.total : 0;
      const gap     = Math.max(0, d.retiring_5yr - d.junior_count);
      const gapPct  = d.total > 0 ? gap / d.total : 0;
      const score   = Math.min(100, Math.round(pct5yr * 70 + gapPct * 30));
      const level   =
        score >= 60 ? 'critical' :
        score >= 40 ? 'high'     :
        score >= 20 ? 'medium'   : 'low';
      return { ...d, risk_score: score, risk_level: level };
    });

    const critical_districts = districts.filter((d) => d.risk_level === 'critical').length;

    // Fill gaps so every year from now → now+5 appears in the wave array.
    const currentYear = new Date().getFullYear();
    const waveMap = {};
    waveRes.rows.forEach((r) => { waveMap[r.year] = r.retirements; });
    const wave = [];
    for (let y = currentYear; y <= currentYear + 5; y++) {
      wave.push({ year: String(y), retirements: waveMap[y] || 0 });
    }

    res.json({
      summary: { ...summary, critical_districts },
      districts,
      wave,
      grades: gradeRes.rows,
    });
  } catch (err) {
    console.error('[staffingController] getCrisis error:', err);
    res.status(500).json({ message: 'Failed to generate staffing analysis', error: err.message });
  }
};

module.exports = { getCrisis };
