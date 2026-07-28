const pool = require('../config/db');
const { recordPromotionDecision } = require('../services/blockchainService');
const { validateAgainstTeacherRecord, parseDocumentFields, extractTextFromFile } = require('../services/ocrService');
const { notifyHrForRegion, notifyTeacher } = require('../services/notificationService');
const { GRADE_ORDER, MIN_YEARS_IN_RANK, getNextGrade, computeYearsInRank, computeYearsOfService } = require('../services/rankService');

const checkEligibility = (teacher) => {
  const nextGrade = getNextGrade(teacher.current_grade);

  const yearsInRank = computeYearsInRank(teacher.national_date_of_present_rank);
  if (yearsInRank === null) {
    return {
      eligible: false,
      reason: 'National Date of Present Rank is not set on your record. Contact HR.'
    };
  }

  if (yearsInRank < MIN_YEARS_IN_RANK) {
    return {
      eligible: false,
      reason: `${MIN_YEARS_IN_RANK} years in your current rank required. You have ${yearsInRank.toFixed(2)} years.`
    };
  }

  if (!nextGrade) {
    if (!teacher.current_grade) {
      return { eligible: true, nextGrade: GRADE_ORDER[0] };
    }
    return { eligible: false, reason: 'Teacher is already at the highest grade' };
  }

  return { eligible: true, nextGrade };
};

// @route  GET /api/promotions/eligibility
// @access Teacher only
const checkPromotionEligibility = async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = result.rows[0];
    const eligibility = checkEligibility(teacher);

    res.json({
      teacher: {
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        staff_id: teacher.staff_id,
        current_grade: teacher.current_grade,
        years_of_service: computeYearsOfService(teacher.date_of_first_appointment),
        qualification: teacher.qualification,
        current_school: teacher.current_school
      },
      ...eligibility
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/form
// @access Teacher only
const getPromotionForm = async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }
    const result = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = result.rows[0];
    const eligibility = checkEligibility(teacher);

    res.json({
      teacher: {
        first_name: teacher.first_name,
        last_name: teacher.last_name,
        staff_id: teacher.staff_id,
        current_grade: teacher.current_grade,
        years_of_service: computeYearsOfService(teacher.date_of_first_appointment),
        qualification: teacher.qualification,
        current_school: teacher.current_school
      },
      eligibility,
      form_fields: [
        {
          name: 'reason',
          label: 'Reason for promotion',
          type: 'textarea',
          required: true,
          placeholder: 'Explain why you are eligible for this promotion'
        }
      ]
    });
  } catch (err) {
    console.error(err.stack || err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/promotions
// @access Teacher only
const applyForPromotion = async (req, res) => {
  // A supporting document (uploaded right after this call, via
  // submit-document) is the actual evidence now — a written reason is no
  // longer required.
  const reason = req.body.reason || null;

  try {
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check eligibility before allowing application
    const eligibility = checkEligibility(teacher);
    if (!eligibility.eligible) {
      return res.status(400).json({
        message: 'You are not eligible for promotion',
        reason: eligibility.reason
      });
    }

    // Check if already has a pending promotion
    const existing = await pool.query(
      `SELECT id FROM applications 
       WHERE teacher_id = $1 AND type = 'promotion' AND status = 'pending'`,
      [teacher.id]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: 'You already have a pending promotion application' });
    }

    // Create application
    const result = await pool.query(
      `INSERT INTO applications 
        (teacher_id, type, reason)
       VALUES ($1, 'promotion', $2)
       RETURNING *`,
      [teacher.id, reason]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'CREATE_PROMOTION', 'applications', result.rows[0].id,
        `Teacher applied for promotion to ${eligibility.nextGrade}`]
    );

    notifyHrForRegion(teacher.current_region, {
      type: 'promotion_request',
      title: 'New promotion request',
      message: `${teacher.first_name} ${teacher.last_name} (${teacher.staff_id}) applied for promotion to ${eligibility.nextGrade}.`,
      link: '/hr/promotions',
      entityType: 'application',
      entityId: result.rows[0].id,
    });

    res.status(201).json({
      message: 'Promotion application submitted successfully',
      next_grade: eligibility.nextGrade,
      application: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/my
// @access Teacher only
const getMyPromotions = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    // Includes the linked promotion_documents/documents row (if any) so the
    // frontend can show what was actually submitted and its verification
    // status without relying on its own in-memory state — that state is
    // lost on a page refresh, but this query reflects exactly what's true
    // on the server, so a refreshed page can pick up right where it left off.
    const result = await pool.query(
      `SELECT a.*, u.email as reviewed_by_email,
        pd.id as promotion_document_id, pd.hr_decision, pd.hr_notes as document_hr_notes,
        pd.submission_attempts, pd.exam_access_granted, pd.hr_reviewed,
        d.file_name as document_file_name, d.ocr_status as document_ocr_status
       FROM applications a
       LEFT JOIN users u ON a.reviewed_by = u.id
       LEFT JOIN promotion_documents pd ON pd.application_id = a.id
       LEFT JOIN documents d ON d.id = pd.document_id
       WHERE a.teacher_id = $1 AND a.type = 'promotion'
       ORDER BY a.created_at DESC`,
      [teacherResult.rows[0].id]
    );

    res.json({
      count: result.rows.length,
      applications: result.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions
// @access HR Officer, Admin
const getAllPromotions = async (req, res) => {
  try {
    const { status } = req.query;

    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT a.*,
        t.first_name, t.last_name, t.staff_id,
        t.current_grade, t.date_of_first_appointment, t.qualification,
        u.email as reviewed_by_email,
        pd.hr_decision as document_hr_decision, pd.exam_access_granted
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       LEFT JOIN promotion_documents pd ON pd.application_id = a.id
       WHERE a.type = 'promotion'
    `;
    const params = [];
    let count = 1;

    if (status) {
      query += ` AND a.status = $${count++}`;
      params.push(status);
    }

    if (req.user.role === 'hr_officer') {
      query += ` AND t.current_region = $${count++}`;
      params.push(req.user.region);
    }

    query += ` ORDER BY a.created_at DESC`;

    const result = await pool.query(query, params);

    const applications = result.rows.map((row) => ({
      ...row,
      years_of_service: computeYearsOfService(row.date_of_first_appointment)
    }));

    res.json({
      count: applications.length,
      applications
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/:id
// @access HR Officer, Admin, Teacher (own only)
const getPromotionById = async (req, res) => {
  try {
    // Validate id is a UUID to avoid accidental routing of literal paths like 'form'
    const id = req.params.id;
    const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    if (!uuidRegex.test(id)) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }
    const result = await pool.query(
      `SELECT a.*,
        t.first_name, t.last_name, t.staff_id,
        t.current_grade, t.date_of_first_appointment, t.qualification,
        u.email as reviewed_by_email,
        pd.hr_decision as document_hr_decision, pd.exam_access_granted
       FROM applications a
       JOIN teachers t ON a.teacher_id = t.id
       LEFT JOIN users u ON a.reviewed_by = u.id
       LEFT JOIN promotion_documents pd ON pd.application_id = a.id
       WHERE a.id = $1 AND a.type = 'promotion'`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }

    // If teacher make sure they only see their own
    if (req.user.role === 'teacher') {
      const teacher = await pool.query(
        'SELECT id FROM teachers WHERE user_id = $1',
        [req.user.id]
      );
      if (result.rows[0].teacher_id !== teacher.rows[0].id) {
        return res.status(403).json({ message: 'Not authorized to view this application' });
      }
    }

    if (req.user.role === 'hr_officer') {
      const teacherRegion = await pool.query('SELECT current_region FROM teachers WHERE id = $1', [result.rows[0].teacher_id]);
      if (teacherRegion.rows[0]?.current_region !== req.user.region) {
        return res.status(403).json({ message: 'This application is outside your assigned region' });
      }
    }

    res.json({
      ...result.rows[0],
      years_of_service: computeYearsOfService(result.rows[0].date_of_first_appointment)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/promotions/:id/review
// @access HR Officer, Admin
const reviewPromotion = async (req, res) => {
  const { status, hr_notes } = req.body;

  if (!status) {
    return res.status(400).json({ message: 'Status is required' });
  }

  if (!['approved', 'rejected', 'more_info'].includes(status)) {
    return res.status(400).json({ message: 'Status must be approved, rejected or more_info' });
  }

  try {
    const appResult = await pool.query(
      'SELECT * FROM applications WHERE id = $1 AND type = $2',
      [req.params.id, 'promotion']
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }

    const application = appResult.rows[0];

    if (application.status !== 'pending' && application.status !== 'more_info') {
      return res.status(400).json({ message: 'Application has already been reviewed' });
    }

    if (req.user.role === 'hr_officer') {
      const teacherRegion = await pool.query('SELECT current_region FROM teachers WHERE id = $1', [application.teacher_id]);
      if (teacherRegion.rows[0]?.current_region !== req.user.region) {
        return res.status(403).json({ message: 'This application is outside your assigned region' });
      }
    }

    // Update application
    const updated = await pool.query(
      `UPDATE applications SET
        status = $1,
        hr_notes = $2,
        reviewed_by = $3,
        reviewed_at = NOW(),
        updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, hr_notes || null, req.user.id, req.params.id]
    );

    // If approved — auto update teacher grade
    if (status === 'approved') {
      const teacherResult = await pool.query(
        'SELECT * FROM teachers WHERE id = $1',
        [application.teacher_id]
      );

      const teacher = teacherResult.rows[0];
      const nextGrade = getNextGrade(teacher.current_grade);

      if (nextGrade) {
        // Save old grade to history
        await pool.query(
          `INSERT INTO teacher_history
            (teacher_id, changed_field, old_value, new_value, changed_by)
           VALUES ($1, $2, $3, $4, $5)`,
          [teacher.id, 'current_grade', teacher.current_grade, nextGrade, req.user.id]
        );

        // Update teacher grade — national_date_of_present_rank resets to
        // today (the new rank's countdown starts now) and
        // promotion_eligibility_notified resets so they get notified again
        // once they become due for the next promotion.
        await pool.query(
          `UPDATE teachers SET
            current_grade = $1,
            national_date_of_present_rank = CURRENT_DATE,
            promotion_eligibility_notified = false,
            updated_at = NOW()
           WHERE id = $2`,
          [nextGrade, teacher.id]
        );

        // Record promotion decision on blockchain
        recordPromotionDecision({
          application_id: req.params.id,
          staff_id: teacher.staff_id || teacher.id,
          from_grade: teacher.current_grade,
          to_grade: nextGrade,
          decision: 'approved',
          decided_by: req.user.id
        }).then(result => {
          if (result.success) {
            console.log(`Promotion recorded on blockchain. TX: ${result.transaction_id}`);
          }
        });
      }
    }

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
      [req.user.id, 'REVIEW_PROMOTION', 'applications', req.params.id,
        `Promotion application ${status} by HR officer`]
    );

    notifyTeacher(application.teacher_id, {
      type: 'promotion_reviewed',
      title: `Promotion ${status}`,
      message: status === 'approved'
        ? `Your promotion application was approved.`
        : status === 'rejected'
          ? `Your promotion application was rejected.${hr_notes ? ` Reason: ${hr_notes}` : ''}`
          : `HR requested more information on your promotion application.${hr_notes ? ` ${hr_notes}` : ''}`,
      link: '/promotions',
      entityType: 'application',
      entityId: req.params.id,
    });

    res.json({
      message: `Promotion application ${status} successfully`,
      application: updated.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};


// @route  POST /api/promotions/:id/submit-document
// @access Teacher — submit document for promotion
const submitPromotionDocument = async (req, res) => {
  const { document_id } = req.body;

  if (!document_id) {
    return res.status(400).json({ message: 'Document ID is required' });
  }

  try {
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check application exists and belongs to teacher
    const appResult = await pool.query(
      `SELECT * FROM applications WHERE id = $1 AND teacher_id = $2 AND type = 'promotion'`,
      [req.params.id, teacher.id]
    );

    if (appResult.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion application not found' });
    }

    // Get document
    const docResult = await pool.query(
      'SELECT * FROM documents WHERE id = $1 AND teacher_id = $2',
      [document_id, teacher.id]
    );

    if (docResult.rows.length === 0) {
      return res.status(404).json({ message: 'Document not found' });
    }

    const document = docResult.rows[0];

    // Parse OCR validation
    let validation = null;
    if (document.ocr_validation) {
      try { validation = JSON.parse(document.ocr_validation); } catch (e) {}
    }

    const nameMatch = validation?.nameMatch || false;
    const staffIdMatch = validation?.staffIdMatch || false;
    const blockchainResult = validation?.blockchainCheck?.result || null;

    // Pass requires: OCR name/staff ID match the teacher's own profile, AND
    // — for qualification/license documents — GTEC/NTC's on-chain record
    // actually matches (a fabricated cert with the right name/ID printed on
    // it still fails here, since nothing was ever anchored for it, or it
    // doesn't match what was).
    const blockchainOk = blockchainResult === null || blockchainResult === 'match';
    const passed = nameMatch && staffIdMatch && blockchainOk;

    const existing = await pool.query(
      'SELECT id, submission_attempts FROM promotion_documents WHERE application_id = $1',
      [req.params.id]
    );
    const previousAttempts = existing.rows[0]?.submission_attempts || 0;
    const attempts = previousAttempts + 1;

    // First failed attempt: let the teacher try again with a different
    // document. Second+ failure: stop auto-retrying and send it to HR.
    let hrDecision, examAccessGranted;
    if (passed) {
      hrDecision = 'approved';
      examAccessGranted = true;
    } else if (attempts <= 1) {
      hrDecision = 'retry';
      examAccessGranted = false;
    } else {
      hrDecision = 'manual_review';
      examAccessGranted = false;
    }

    let promoDoc;
    if (existing.rows.length > 0) {
      promoDoc = await pool.query(
        `UPDATE promotion_documents SET
          document_id = $1, ocr_name_match = $2, ocr_staff_id_match = $3,
          ocr_validation = $4, hr_decision = $5, hr_reviewed = false,
          exam_access_granted = $6, submission_attempts = $7
         WHERE application_id = $8 RETURNING *`,
        [document_id, nameMatch, staffIdMatch,
          document.ocr_validation, hrDecision, examAccessGranted, attempts, req.params.id]
      );
    } else {
      promoDoc = await pool.query(
        `INSERT INTO promotion_documents
          (application_id, teacher_id, document_id, ocr_name_match,
           ocr_staff_id_match, ocr_validation, hr_decision, exam_access_granted, submission_attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [req.params.id, teacher.id, document_id,
          nameMatch, staffIdMatch, document.ocr_validation, hrDecision, examAccessGranted, attempts]
      );
    }

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'SUBMIT_PROMO_DOC', 'promotion_documents',
        promoDoc.rows[0].id, `Document submitted for promotion application (attempt ${attempts}, decision: ${hrDecision})`]
    );

    if (hrDecision === 'manual_review') {
      notifyHrForRegion(teacher.current_region, {
        type: 'promotion_document_review',
        title: 'Promotion document needs manual review',
        message: `${teacher.first_name} ${teacher.last_name} (${teacher.staff_id})'s promotion document failed automatic verification twice and needs manual review.`,
        link: '/hr/promotion-documents',
        entityType: 'promotion_document',
        entityId: promoDoc.rows[0].id,
      });
    }

    const message =
      hrDecision === 'approved'
        ? 'Document verified — you can now take the promotion exam.'
        : hrDecision === 'retry'
          ? 'This does not look like the correct document for your profile. Please check and upload the correct document.'
          : 'We could not automatically verify this document. It is now being reviewed by HR.';

    res.json({
      message,
      ocr_result: {
        nameMatch,
        staffIdMatch,
        blockchainResult,
        auto_decision: hrDecision,
        attempts,
        can_retry: hrDecision === 'retry',
        details: validation?.details || []
      },
      promotion_document: promoDoc.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/promotions/documents
// @access HR Officer, Admin — see all promotion documents with OCR status
const getPromotionDocuments = async (req, res) => {
  try {
    if (req.user.role === 'hr_officer' && !req.user.region) {
      return res.status(403).json({ message: 'Your HR account has no region assigned. Contact an admin.' });
    }

    let query = `
      SELECT pd.*,
        t.first_name, t.last_name, t.staff_id, t.current_grade,
        t.qualification, t.date_of_first_appointment,
        d.file_name, d.file_type, d.ocr_status, d.ocr_extracted_text,
        a.reason as application_reason, a.status as application_status,
        u.email as reviewed_by_email
       FROM promotion_documents pd
       JOIN teachers t ON pd.teacher_id = t.id
       JOIN documents d ON pd.document_id = d.id
       JOIN applications a ON pd.application_id = a.id
       LEFT JOIN users u ON pd.reviewed_by = u.id
       WHERE pd.hr_decision != 'retry'
    `;
    const params = [];
    if (req.user.role === 'hr_officer') {
      query += ` AND t.current_region = $1`;
      params.push(req.user.region);
    }
    query += ` ORDER BY pd.created_at DESC`;

    const result = await pool.query(query, params);

    const documents = result.rows.map((row) => ({
      ...row,
      years_of_service: computeYearsOfService(row.date_of_first_appointment)
    }));

    res.json({ count: documents.length, documents });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/promotions/documents/:id/review
// @access HR Officer, Admin — review promotion document and grant exam access
const reviewPromotionDocument = async (req, res) => {
  const { decision, hr_notes } = req.body;

  if (!decision || !['approved', 'rejected', 'manual_review'].includes(decision)) {
    return res.status(400).json({ message: 'Valid decision required: approved, rejected, manual_review' });
  }

  try {
    if (req.user.role === 'hr_officer') {
      const pd = await pool.query(
        `SELECT t.current_region FROM promotion_documents pd
         JOIN teachers t ON pd.teacher_id = t.id WHERE pd.id = $1`,
        [req.params.id]
      );
      if (pd.rows.length === 0) {
        return res.status(404).json({ message: 'Promotion document not found' });
      }
      if (pd.rows[0].current_region !== req.user.region) {
        return res.status(403).json({ message: 'This document is outside your assigned region' });
      }
    }

    const grantExamAccess = decision === 'approved';

    const result = await pool.query(
      `UPDATE promotion_documents SET
        hr_decision = $1,
        hr_notes = $2,
        hr_reviewed = true,
        exam_access_granted = $3,
        reviewed_by = $4,
        reviewed_at = NOW()
       WHERE id = $5 RETURNING *`,
      [decision, hr_notes || null, grantExamAccess, req.user.id, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Promotion document not found' });
    }

    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'REVIEW_PROMO_DOC', 'promotion_documents',
        req.params.id, `HR decision: ${decision}. Exam access: ${grantExamAccess}`]
    );

    notifyTeacher(result.rows[0].teacher_id, {
      type: 'promotion_document_reviewed',
      title: `Promotion document ${decision}`,
      message: grantExamAccess
        ? 'Your promotion document was approved — you can now take the promotion exam.'
        : `Your promotion document was reviewed: ${decision}.${hr_notes ? ` ${hr_notes}` : ''}`,
      link: '/promotions',
      entityType: 'promotion_document',
      entityId: req.params.id,
    });

    res.json({
      message: `Document ${decision}. Exam access ${grantExamAccess ? 'granted' : 'denied'}.`,
      promotion_document: result.rows[0]
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};



module.exports = {
  checkPromotionEligibility,
  getPromotionForm,
  applyForPromotion,
  getMyPromotions,
  getAllPromotions,
  getPromotionById,
  reviewPromotion,
  submitPromotionDocument,
  getPromotionDocuments,
  reviewPromotionDocument
};