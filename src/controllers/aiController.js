const Groq = require('groq-sdk');

const GES_CONTEXT = `
You are an AI assistant built into the Ghana Education Service (GES) Management System.

GES Rank Ladder (lowest to highest):
Pupil Teacher, Superintendent II, Superintendent I, Senior Superintendent II, Senior Superintendent I, Principal Superintendent, Assistant Director II, Assistant Director I, Deputy Director, Director II, Director I, Deputy Director-General, Director-General

Key GES Rules:
- Promotion requires a minimum of 4 years in the current rank (from date of present rank, not total service years).
- A valid NTC (National Teaching Council) license is required for promotion. Licenses renew every 5 years.
- Credential documents must be uploaded and blockchain-verified before a promotion application can succeed.
- Transfer requests are reviewed by the HR officer of the destination region.
- Documents are OCR-scanned and cross-checked against blockchain reference records for authenticity.
`;

// Page descriptions per role
const PAGE_CONTEXT = {
  teacher: {
    '/dashboard':   'The teacher is on their Dashboard — shows overview stats, recent activity, application statuses.',
    '/profile':     'The teacher is on their Profile page — they can view and edit personal and professional details, upload a passport photo.',
    '/documents':   'The teacher is on their Documents page — they can upload documents, view OCR extraction results and blockchain verification status.',
    '/transfers':   'The teacher is on their Transfers page — they can submit a transfer request and track the status of existing requests.',
    '/promotions':  'The teacher is on their Promotions page — they can check promotion eligibility, apply for promotion, and attach supporting documents.',
    '/exams':       'The teacher is on their Exams page — they can view available exams, take an exam, and see their results.',
    '/credentials': 'The teacher is on their Credentials page — they can submit documents for blockchain verification and check verification status.',
  },
  hr_officer: {
    '/hr/dashboard':            'The HR officer is on their Dashboard — shows summary stats of teachers, pending applications.',
    '/hr/teachers':             'The HR officer is on the Teachers list — they can search and view all teacher records.',
    '/hr/teachers/add':         'The HR officer is on the Add Teacher page — registering a new teacher account.',
    '/hr/transfers':            'The HR officer is on the Transfers page — reviewing and approving or rejecting teacher transfer requests.',
    '/hr/promotions':           'The HR officer is on the Promotions page — reviewing and approving or rejecting teacher promotion applications.',
    '/hr/promotion-documents':  'The HR officer is on the Promotion Documents page — reviewing OCR-validated documents submitted for promotions.',
    '/hr/change-requests':      'The HR officer is on the Change Requests page — reviewing teacher-submitted record change requests.',
    '/hr/exams':                'The HR officer is on the Exams page — viewing all exams and results.',
  },
  admin: {
    '/admin/dashboard':              'The admin is on the Dashboard.',
    '/admin/reports':                'The admin is on the Reports page — system-wide statistics and charts.',
    '/admin/audit':                  'The admin is on the Audit Log page — full trail of all system actions.',
    '/admin/blockchain':             'The admin is on the Blockchain Nodes page — viewing network node status.',
    '/admin/blockchain-references':  'The admin is on the Blockchain References page — managing reference documents for OCR cross-checking.',
    '/hr/teachers':                  'The admin is on the Teachers list.',
    '/hr/transfers':                 'The admin is on the Transfers review page.',
    '/hr/promotions':                'The admin is on the Promotions review page.',
  },
  examiner: {
    '/examiner/dashboard':  'The examiner is on their Dashboard — shows exam statistics.',
    '/examiner/exams':      'The examiner is on the Exams page — they can create exams with MCQ questions, publish them, close them, and view results.',
  },
};

const ROLE_LABELS = {
  teacher:    'GES Teacher',
  hr_officer: 'GES HR Officer',
  admin:      'GES System Administrator',
  examiner:   'GES Examiner',
};

const SYSTEM_PROMPTS = {
  teacher: `${GES_CONTEXT}
You are the GES Career Assistant speaking DIRECTLY TO A TEACHER.
- Always address the user as "you" — never "the teacher" or third person.
- Never use HR/management language or pretend you are talking to staff who manage others.
- CRITICAL: You will be given the teacher's profile data (name, grade, years in rank, etc.) in the conversation context. ALWAYS use this data to give specific, personalised answers. NEVER ask the teacher for information you already have. If asked about eligibility, calculate it directly from their grade and years in rank.
- Help with: understanding application statuses, writing transfer/promotion reasons, explaining GES policies in plain language, career planning, document uploads and credential verification.
- Tone: Friendly, encouraging, practical.`,

  hr_officer: `${GES_CONTEXT}
You are the GES HR Assistant speaking to a GES HR Officer.
- Help with: drafting professional letters and HR notes, explaining GES policies, advising on borderline cases, reviewing OCR-validated documents.
- Tone: Professional, formal, concise.`,

  admin: `${GES_CONTEXT}
You are the GES Admin Assistant speaking to a GES System Administrator.
- Help with: interpreting reports and audit logs, user account management, blockchain node health, drafting announcements, explaining the OCR/blockchain pipeline.
- Tone: Technical yet clear. Authoritative.`,

  examiner: `${GES_CONTEXT}
You are the GES Examiner Assistant speaking to a GES Examiner.
- Help with: drafting MCQ questions, advising on exam structure and pass marks, interpreting results, best practices for fair assessments.
- Tone: Academic, precise, constructive.`,
};

// @route  POST /api/ai/chat
// @access All authenticated users
const chat = async (req, res) => {
  const { messages, page, teacherContext, userContext } = req.body;

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ message: 'AI service is not configured on this server.' });
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ message: 'messages array is required' });
  }

  const role = userContext?.role || req.user?.role || 'teacher';
  const roleLabel = ROLE_LABELS[role] || 'GES Teacher';
  const systemPrompt = SYSTEM_PROMPTS[role] || SYSTEM_PROMPTS.teacher;

  // Resolve page context — match the current path prefix
  const pageMap = PAGE_CONTEXT[role] || {};
  const pageDesc = (page && Object.keys(pageMap).find(k => page.startsWith(k)))
    ? pageMap[Object.keys(pageMap).find(k => page.startsWith(k))]
    : null;

  const anchorParts = [`I am the GES AI Assistant. I am speaking with a ${roleLabel}.`];
  if (teacherContext) {
    const eligible = typeof teacherContext.yearsInRank === 'number'
      ? teacherContext.yearsInRank >= 4 ? 'meets the minimum 4-year rank requirement' : `does NOT yet meet the 4-year rank requirement (only ${teacherContext.yearsInRank} year(s) in current rank)`
      : 'has unknown years in rank';
    anchorParts.push(
      `TEACHER PROFILE (use this data directly in all answers — do NOT ask the teacher to provide info already listed here):`,
      `Name: ${teacherContext.name} | Staff ID: ${teacherContext.staffId} | Current Grade: ${teacherContext.grade} | Subject: ${teacherContext.subject} | School: ${teacherContext.school} | District: ${teacherContext.district} | Region: ${teacherContext.region} | Years in current rank: ${teacherContext.yearsInRank ?? 'unknown'}.`,
      `Promotion eligibility note: This teacher ${eligible}.`
    );
  }
  if (userContext) {
    const scopeParts = [];
    if (userContext.region) scopeParts.push(`region: ${userContext.region}`);
    if (userContext.district) scopeParts.push(`district: ${userContext.district}`);
    anchorParts.push(`Their name is ${userContext.name}, email: ${userContext.email}${scopeParts.length ? ', scoped to ' + scopeParts.join(', ') : ''}.`);
  }
  if (pageDesc) anchorParts.push(pageDesc);
  anchorParts.push('I will tailor all my responses to this context.');
  const anchorContent = anchorParts.join(' ');

  console.log(`[AI] user=${req.user?.id} role=${role} page=${page || 'unknown'}`);

  try {
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

    const groqMessages = [
      { role: 'system', content: systemPrompt },
      { role: 'assistant', content: anchorContent },
      ...messages.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
    ];

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const stream = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: groqMessages,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || '';
      if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (err) {
    console.error('[AI] error:', err.message);
    if (!res.headersSent) {
      return res.status(500).json({ message: 'AI service error', error: err.message });
    }
    res.write(`data: ${JSON.stringify({ error: 'AI error — please try again.' })}\n\n`);
    res.end();
  }
};

module.exports = { chat };
