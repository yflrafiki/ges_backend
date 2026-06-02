CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users / Auth table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('teacher', 'hr_officer', 'admin', 'examiner')),
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE IF EXISTS users
  DROP CONSTRAINT IF EXISTS users_role_check,
  ADD CONSTRAINT users_role_check CHECK (role IN ('teacher', 'hr_officer', 'admin', 'examiner'));

-- Teachers table
CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  staff_id VARCHAR(100) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  title VARCHAR(20),
  date_of_birth DATE,
  phone VARCHAR(20),
  gender VARCHAR(10),
  subject_specialization VARCHAR(100),
  current_grade VARCHAR(50),
  current_school VARCHAR(200),
  current_district VARCHAR(100),
  current_region VARCHAR(100),
  years_of_service INTEGER DEFAULT 0,
  qualification VARCHAR(100),
  marital_status VARCHAR(20),
  nationality VARCHAR(100),
  hometown VARCHAR(100),
  national_date_of_present_rank DATE,
  years_in_current_rank INTEGER DEFAULT 0,
  date_of_first_appointment DATE,
  date_of_confirmation DATE,
  date_of_current_posting DATE,
  employment_status VARCHAR(50) DEFAULT 'active',
  disability_status BOOLEAN DEFAULT false,
  disability_type TEXT,
  passport_photo VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Teacher record history (every update saved here)
CREATE TABLE IF NOT EXISTS teacher_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  changed_field VARCHAR(100),
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES users(id),
  changed_at TIMESTAMP DEFAULT NOW()
);

-- Applications (transfers & promotions)
CREATE TABLE IF NOT EXISTS applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  type VARCHAR(50) NOT NULL CHECK (type IN ('transfer', 'promotion')),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'more_info')),
  reason TEXT,
  requested_district VARCHAR(100),
  requested_region VARCHAR(100),
  hr_notes TEXT,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Documents (uploaded files)
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  application_id UUID REFERENCES applications(id),
  file_name VARCHAR(255),
  file_path VARCHAR(500),
  file_type VARCHAR(100),
  ocr_extracted_text TEXT,
  ocr_validation TEXT,
  document_hash VARCHAR(64),
  ocr_status VARCHAR(50) DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'completed', 'failed')),
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Credentials (blockchain verification records)
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  document_id UUID REFERENCES documents(id),
  document_hash VARCHAR(500),
  blockchain_tx_id VARCHAR(500),
  verification_status VARCHAR(50) DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'failed')),
  verified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  action VARCHAR(200) NOT NULL,
  entity VARCHAR(100),
  entity_id UUID,
  details TEXT,
  ip_address VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Promotion documents
CREATE TABLE IF NOT EXISTS promotion_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES applications(id),
  teacher_id UUID REFERENCES teachers(id),
  document_id UUID REFERENCES documents(id),
  ocr_name_match BOOLEAN DEFAULT false,
  ocr_staff_id_match BOOLEAN DEFAULT false,
  ocr_validation TEXT,
  hr_decision VARCHAR(50) DEFAULT 'manual_review',
  hr_reviewed BOOLEAN DEFAULT false,
  exam_access_granted BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Blockchain reference records
CREATE TABLE IF NOT EXISTS blockchain_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id VARCHAR(100),
  document_hash VARCHAR(500),
  file_name VARCHAR(255),
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Exam management tables
CREATE TABLE IF NOT EXISTS exams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration_minutes INTEGER DEFAULT 60,
  total_marks INTEGER DEFAULT 0,
  pass_mark INTEGER DEFAULT 0,
  created_by UUID REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  option_a TEXT,
  option_b TEXT,
  option_c TEXT,
  option_d TEXT,
  correct_answer VARCHAR(10),
  marks INTEGER DEFAULT 1,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID REFERENCES exams(id),
  teacher_id UUID REFERENCES teachers(id),
  status VARCHAR(50) DEFAULT 'in_progress',
  started_at TIMESTAMP,
  submitted_at TIMESTAMP,
  score INTEGER DEFAULT 0,
  passed BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS exam_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id UUID REFERENCES exam_questions(id),
  selected_answer VARCHAR(50),
  is_correct BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
