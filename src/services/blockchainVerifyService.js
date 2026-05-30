const pool = require('../config/db');

const verifyAgainstReference = async (staffId, teacherName, documentHash) => {
  try {
    const result = await pool.query(
      `SELECT * FROM blockchain_references WHERE staff_id = $1 ORDER BY created_at DESC`,
      [staffId.toUpperCase()]
    );

    if (result.rows.length === 0) {
      return {
        found: false,
        result: 'not_found',
        message: 'No reference documents found on blockchain for this teacher'
      };
    }

    const references = result.rows;

    const nameMatch = references.some(ref => {
      const refName = ref.teacher_name.toUpperCase();
      const checkName = teacherName.toUpperCase();
      return refName.includes(checkName) || checkName.includes(refName) ||
        refName.split(' ').some((part) => checkName.includes(part) && part.length > 2);
    });

    const hashMatch = references.some(ref => ref.document_hash === documentHash);

    return {
      found: true,
      result: hashMatch ? 'exact_match' : nameMatch ? 'name_match' : 'mismatch',
      message: hashMatch
        ? 'Exact document match found on blockchain'
        : nameMatch
        ? 'Teacher name verified against blockchain reference'
        : 'Document does not match any blockchain reference for this teacher',
      nameMatch,
      hashMatch,
      references: references.map(r => ({
        document_type: r.document_type,
        org_msp: r.org_msp,
        blockchain_tx_id: r.blockchain_tx_id,
        issued_by: r.issued_by
      }))
    };

  } catch (err) {
    console.error('Blockchain verification error:', err);
    return { found: false, result: 'error', message: err.message };
  }
};

module.exports = { verifyAgainstReference };
