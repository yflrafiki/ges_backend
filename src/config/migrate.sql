ALTER TABLE promotion_documents
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS hr_notes TEXT;

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS title VARCHAR(20),
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS marital_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS nationality VARCHAR(100),
  ADD COLUMN IF NOT EXISTS hometown VARCHAR(100),
  ADD COLUMN IF NOT EXISTS national_date_of_present_rank DATE,
  ADD COLUMN IF NOT EXISTS years_in_current_rank INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS date_of_first_appointment DATE,
  ADD COLUMN IF NOT EXISTS date_of_confirmation DATE,
  ADD COLUMN IF NOT EXISTS date_of_current_posting DATE,
  ADD COLUMN IF NOT EXISTS employment_status VARCHAR(50) DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS disability_status BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS disability_type TEXT,
  ADD COLUMN IF NOT EXISTS passport_photo VARCHAR(500),
  ADD COLUMN IF NOT EXISTS house_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ghana_card_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS ghana_card_issue_date DATE,
  ADD COLUMN IF NOT EXISTS ghana_card_expiry_date DATE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_ghana_card_number_key'
  ) THEN
    ALTER TABLE teachers ADD CONSTRAINT teachers_ghana_card_number_key UNIQUE (ghana_card_number);
  END IF;
END $$;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS ocr_validation TEXT,
  ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credentials_document_id_key'
  ) THEN
    ALTER TABLE credentials ADD CONSTRAINT credentials_document_id_key UNIQUE (document_id);
  END IF;
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS region VARCHAR(100),
  ADD COLUMN IF NOT EXISTS district VARCHAR(100),
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS email_verification_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS email_verification_code_expires_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS teacher_education (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  school_name VARCHAR(255) NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE blockchain_references
  ADD COLUMN IF NOT EXISTS teacher_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS blockchain_tx_id VARCHAR(500),
  ADD COLUMN IF NOT EXISTS org_msp VARCHAR(50),
  ADD COLUMN IF NOT EXISTS issued_by VARCHAR(255),
  ADD COLUMN IF NOT EXISTS issued_date DATE,
  ADD COLUMN IF NOT EXISTS cert_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS anchored_on_chain BOOLEAN DEFAULT false;

CREATE TABLE IF NOT EXISTS change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  field_name VARCHAR(100) NOT NULL,
  current_value TEXT,
  requested_value TEXT NOT NULL,
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMP,
  hr_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE change_requests
  ADD COLUMN IF NOT EXISTS document_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS document_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS document_hash VARCHAR(64);

-- Document type drives which chaincode check (if any) applies on upload:
-- 'qualification' -> cross-checked against GTEC's anchored record,
-- 'license' -> cross-checked against NTC's, 'other' -> hash-anchor only.
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS document_type VARCHAR(20) DEFAULT 'other';

-- Tracks how many times a teacher has submitted a document for a given
-- promotion application — the first failed OCR/blockchain check sends them
-- back to re-upload; a second failure routes to HR for manual review.
ALTER TABLE promotion_documents
  ADD COLUMN IF NOT EXISTS submission_attempts INTEGER DEFAULT 0;

-- Statutory/professional registration data collected at intake (NTC, NSS,
-- SSNIT, tertiary academic background) plus the supporting documents for
-- National Service and the degree/diploma and appointment/promotion letter.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS residential_address TEXT,
  ADD COLUMN IF NOT EXISTS ntc_license_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS nss_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS nss_certificate_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS ssnit_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS institution_attended VARCHAR(255),
  ADD COLUMN IF NOT EXISTS graduation_date DATE,
  ADD COLUMN IF NOT EXISTS major_minor_courses VARCHAR(255),
  ADD COLUMN IF NOT EXISTS student_index_number VARCHAR(100),
  ADD COLUMN IF NOT EXISTS degree_certificate_path VARCHAR(500),
  ADD COLUMN IF NOT EXISTS appointment_letter_path VARCHAR(500);

-- Display name for the post-login welcome message. For teachers this is set
-- server-side from first_name+last_name at registration; for hr_officer/
-- admin/examiner accounts (which have no teachers row) it's collected
-- directly on the registration form.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);

-- In-app notifications (polled by the frontend every 30-60s) so HR/admin
-- don't have to keep refreshing to see new requests, and teachers don't have
-- to keep checking back for a decision on their application.
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

-- Teacher display name uses title + last name (e.g. "Ms. Taylor") instead of
-- the full personal name. Recomputed unconditionally (not just WHERE NULL)
-- so existing accounts pick up the new format too, not just brand new ones.
UPDATE users u
SET full_name = CASE
  WHEN t.title IS NOT NULL AND t.title != '' THEN TRIM(CONCAT(t.title, '. ', t.last_name))
  ELSE TRIM(CONCAT(t.first_name, ' ', t.last_name))
END
FROM teachers t
WHERE t.user_id = u.id AND u.role = 'teacher';

-- Forgot-password flow reuses the same code+expiry pattern as email
-- verification, just on separate columns so a pending verification code and
-- a pending reset code can't ever clobber each other.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_code VARCHAR(10),
  ADD COLUMN IF NOT EXISTS password_reset_code_expires_at TIMESTAMP;

-- Tracks whether a teacher has already been sent the "you're eligible for
-- promotion" notification for their CURRENT rank, so the daily check doesn't
-- re-notify them every day once they're past the threshold. Reset to false
-- whenever they actually get promoted (new rank starts a fresh countdown).
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS promotion_eligibility_notified BOOLEAN DEFAULT false;

-- Stores the teacher's grade at the time they applied for promotion, so
-- the frontend can always show the grade transition (from → to) in history.
ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS from_grade VARCHAR(100);

-- Web Push subscriptions (one per browser/device a user has granted
-- notification permission on) — lets the backend deliver a real OS-level
-- notification even when the app isn't open, unlike the SSE stream which
-- only works while a tab is connected.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh VARCHAR(255) NOT NULL,
  auth VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
