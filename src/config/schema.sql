CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users / Auth table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('teacher', 'hr_officer', 'admin', 'examiner')),
  region VARCHAR(100),
  district VARCHAR(100),
  full_name VARCHAR(255),
  email_verified BOOLEAN DEFAULT false,
  email_verification_token VARCHAR(255),
  email_verified_at TIMESTAMP,
  created_by UUID REFERENCES users(id),
  email_verification_code VARCHAR(10),
  email_verification_code_expires_at TIMESTAMP,
  password_reset_code VARCHAR(10),
  password_reset_code_expires_at TIMESTAMP,
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
  house_number VARCHAR(50),
  residential_address TEXT,
  national_date_of_present_rank DATE,
  years_in_current_rank INTEGER DEFAULT 0,
  date_of_first_appointment DATE,
  date_of_confirmation DATE,
  date_of_current_posting DATE,
  employment_status VARCHAR(50) DEFAULT 'active',
  disability_status BOOLEAN DEFAULT false,
  disability_type TEXT,
  passport_photo VARCHAR(500),
  ghana_card_number VARCHAR(50) UNIQUE,
  ghana_card_issue_date DATE,
  ghana_card_expiry_date DATE,
  ntc_license_number VARCHAR(50),
  nss_number VARCHAR(50),
  nss_certificate_path VARCHAR(500),
  ssnit_number VARCHAR(50),
  institution_attended VARCHAR(255),
  graduation_date DATE,
  major_minor_courses VARCHAR(255),
  student_index_number VARCHAR(100),
  degree_certificate_path VARCHAR(500),
  appointment_letter_path VARCHAR(500),
  promotion_eligibility_notified BOOLEAN DEFAULT false,
  position VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Schools attended by a teacher (with start/end dates)
CREATE TABLE IF NOT EXISTS teacher_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  school_name VARCHAR(255) NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Teacher-requested edits to restricted fields, pending admin approval
CREATE TABLE IF NOT EXISTS change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  current_value TEXT,
  requested_value TEXT NOT NULL,
  reason TEXT,
  document_path VARCHAR(500),
  document_name VARCHAR(255),
  document_hash VARCHAR(64),
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  hr_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
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
  from_grade VARCHAR(100),
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
  document_type VARCHAR(20) DEFAULT 'other',
  ocr_status VARCHAR(50) DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'completed', 'failed')),
  uploaded_at TIMESTAMP DEFAULT NOW()
);

-- Credentials (blockchain verification records)
CREATE TABLE IF NOT EXISTS credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id),
  document_id UUID REFERENCES documents(id) UNIQUE,
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
  hr_notes TEXT,
  hr_reviewed BOOLEAN DEFAULT false,
  exam_access_granted BOOLEAN DEFAULT false,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  submission_attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Blockchain reference records
CREATE TABLE IF NOT EXISTS blockchain_references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id VARCHAR(100),
  teacher_name VARCHAR(255),
  document_type VARCHAR(50),
  document_hash VARCHAR(500),
  file_name VARCHAR(255),
  blockchain_tx_id VARCHAR(500),
  org_msp VARCHAR(50),
  issued_by VARCHAR(255),
  issued_date DATE,
  cert_id VARCHAR(255),
  anchored_on_chain BOOLEAN DEFAULT false,
  uploaded_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- In-app notifications (SSE stream + bell badge)
CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  link VARCHAR(255),
  entity_type VARCHAR(50),
  entity_id UUID,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, read);

-- Web Push subscriptions (one per browser/device)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);

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
