const pool = require('../config/db');

// @route  POST /api/exams
// @access HR Officer, Admin
const createExam = async (req, res) => {
  const { title, description, duration_minutes, total_marks, pass_mark, questions } = req.body;

  if (!title || !questions || questions.length === 0) {
    return res.status(400).json({ message: 'Title and questions are required' });
  }

  try {
    // Create exam
    const examResult = await pool.query(
      `INSERT INTO exams (title, description, duration_minutes, total_marks, pass_mark, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, description, duration_minutes || 60, total_marks || questions.length, pass_mark || Math.ceil(questions.length * 0.5), req.user.id]
    );

    const exam = examResult.rows[0];

    // Insert questions
    for (const q of questions) {
      await pool.query(
        `INSERT INTO exam_questions (exam_id, question, option_a, option_b, option_c, option_d, correct_answer, marks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [exam.id, q.question, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.marks || 1]
      );
    }

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'CREATE_EXAM', 'exams', exam.id, `Exam created: ${title}`]
    );

    res.status(201).json({ message: 'Exam created successfully', exam });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/exams/:id/publish
// @access HR Officer, Admin
const publishExam = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE exams SET status = 'published', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Exam not found' });
    }

    res.json({ message: 'Exam published successfully', exam: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  PUT /api/exams/:id/close
// @access HR Officer, Admin
const closeExam = async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE exams SET status = 'closed', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [req.params.id]
    );
    res.json({ message: 'Exam closed', exam: result.rows[0] });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/exams
// @access HR Officer, Admin
const getAllExams = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT e.*, u.email as created_by_email,
        (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) as question_count,
        (SELECT COUNT(*) FROM exam_attempts WHERE exam_id = e.id) as attempt_count
       FROM exams e
       JOIN users u ON e.created_by = u.id
       ORDER BY e.created_at DESC`
    );
    res.json({ count: result.rows.length, exams: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/exams/available
// @access Teacher only — shows published exams for eligible teachers
const getAvailableExams = async (req, res) => {
  try {
    // Get teacher
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher profile not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check if teacher has an approved promotion application
    const promotionResult = await pool.query(
      `SELECT id FROM applications 
       WHERE teacher_id = $1 AND type = 'promotion' AND status = 'approved'`,
      [teacher.id]
    );

    // Get published exams with attempt status
    const result = await pool.query(
      `SELECT e.*,
        (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) as question_count,
        (SELECT status FROM exam_attempts WHERE exam_id = e.id AND teacher_id = $1 LIMIT 1) as my_attempt_status,
        (SELECT score FROM exam_attempts WHERE exam_id = e.id AND teacher_id = $1 LIMIT 1) as my_score,
        (SELECT passed FROM exam_attempts WHERE exam_id = e.id AND teacher_id = $1 LIMIT 1) as my_passed
       FROM exams e
       WHERE e.status = 'published'
       ORDER BY e.created_at DESC`,
      [teacher.id]
    );

    res.json({
      eligible: promotionResult.rows.length > 0,
      exams: result.rows
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/exams/:id/questions
// @access Teacher only — get exam questions without correct answers
const getExamQuestions = async (req, res) => {
  try {
    const teacherResult = await pool.query(
      'SELECT * FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    if (teacherResult.rows.length === 0) {
      return res.status(404).json({ message: 'Teacher not found' });
    }

    const teacher = teacherResult.rows[0];

    // Check exam exists and is published
    const examResult = await pool.query(
      'SELECT * FROM exams WHERE id = $1 AND status = $2',
      [req.params.id, 'published']
    );

    if (examResult.rows.length === 0) {
      return res.status(404).json({ message: 'Exam not found or not available' });
    }

    const exam = examResult.rows[0];

    // Check if already submitted
    const attemptResult = await pool.query(
      `SELECT * FROM exam_attempts WHERE exam_id = $1 AND teacher_id = $2`,
      [req.params.id, teacher.id]
    );

    if (attemptResult.rows.length > 0 && attemptResult.rows[0].status === 'submitted') {
      return res.status(400).json({ message: 'You have already submitted this exam' });
    }

    // Start attempt if not started
    let attempt = attemptResult.rows[0];
    if (!attempt) {
      const newAttempt = await pool.query(
        `INSERT INTO exam_attempts (exam_id, teacher_id, status, started_at)
         VALUES ($1, $2, 'in_progress', NOW()) RETURNING *`,
        [req.params.id, teacher.id]
      );
      attempt = newAttempt.rows[0];
    }

    // Get questions WITHOUT correct answers
    const questions = await pool.query(
      `SELECT id, question, option_a, option_b, option_c, option_d, marks
       FROM exam_questions WHERE exam_id = $1 ORDER BY created_at`,
      [req.params.id]
    );

    res.json({
      exam: {
        id: exam.id,
        title: exam.title,
        description: exam.description,
        duration_minutes: exam.duration_minutes,
        total_marks: exam.total_marks,
        pass_mark: exam.pass_mark,
      },
      attempt_id: attempt.id,
      questions: questions.rows
    });

  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  POST /api/exams/:id/submit
// @access Teacher only
const submitExam = async (req, res) => {
  const { attempt_id, answers } = req.body;

  if (!attempt_id || !answers) {
    return res.status(400).json({ message: 'Attempt ID and answers are required' });
  }

  try {
    const teacherResult = await pool.query(
      'SELECT id FROM teachers WHERE user_id = $1',
      [req.user.id]
    );

    const teacher_id = teacherResult.rows[0].id;

    // Get attempt
    const attemptResult = await pool.query(
      'SELECT * FROM exam_attempts WHERE id = $1 AND teacher_id = $2',
      [attempt_id, teacher_id]
    );

    if (attemptResult.rows.length === 0) {
      return res.status(404).json({ message: 'Attempt not found' });
    }

    if (attemptResult.rows[0].status === 'submitted') {
      return res.status(400).json({ message: 'Exam already submitted' });
    }

    // Get correct answers
    const questions = await pool.query(
      'SELECT id, correct_answer, marks FROM exam_questions WHERE exam_id = $1',
      [attemptResult.rows[0].exam_id]
    );

    // Get exam pass mark
    const examResult = await pool.query(
      'SELECT pass_mark, total_marks FROM exams WHERE id = $1',
      [attemptResult.rows[0].exam_id]
    );

    const { pass_mark, total_marks } = examResult.rows[0];

    // Grade answers
    let score = 0;
    for (const q of questions.rows) {
      const answer = answers[q.id];
      const isCorrect = answer === q.correct_answer;
      if (isCorrect) score += q.marks;

      await pool.query(
        `INSERT INTO exam_answers (attempt_id, question_id, selected_answer, is_correct)
         VALUES ($1, $2, $3, $4)`,
        [attempt_id, q.id, answer || null, isCorrect]
      );
    }

    const passed = score >= pass_mark;

    // Update attempt
    await pool.query(
      `UPDATE exam_attempts SET
        status = 'submitted',
        score = $1,
        passed = $2,
        submitted_at = NOW()
       WHERE id = $3`,
      [score, passed, attempt_id]
    );

    // Audit log
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, entity, entity_id, details) VALUES ($1,$2,$3,$4,$5)',
      [req.user.id, 'SUBMIT_EXAM', 'exam_attempts', attempt_id,
        `Exam submitted. Score: ${score}/${total_marks}. ${passed ? 'PASSED' : 'FAILED'}`]
    );

    res.json({
      message: 'Exam submitted successfully',
      score,
      total_marks,
      pass_mark,
      passed,
      percentage: Math.round((score / total_marks) * 100)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

// @route  GET /api/exams/:id/results
// @access HR Officer, Admin
const getExamResults = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT ea.*,
        t.first_name, t.last_name, t.staff_id,
        e.title as exam_title, e.pass_mark, e.total_marks
       FROM exam_attempts ea
       JOIN teachers t ON ea.teacher_id = t.id
       JOIN exams e ON ea.exam_id = e.id
       WHERE ea.exam_id = $1 AND ea.status = 'submitted'
       ORDER BY ea.score DESC`,
      [req.params.id]
    );

    res.json({ count: result.rows.length, results: result.rows });
  } catch (err) {
    res.status(500).json({ message: 'Server error', error: err.message });
  }
};

module.exports = {
  createExam,
  publishExam,
  closeExam,
  getAllExams,
  getAvailableExams,
  getExamQuestions,
  submitExam,
  getExamResults
};