CREATE DATABASE IF NOT EXISTS college_grading_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE college_grading_system;
CREATE TABLE IF NOT EXISTS grade_sessions (
  session_id VARCHAR(128) NOT NULL,
  session_data MEDIUMBLOB NOT NULL,
  expires_at BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (session_id),
  KEY idx_grade_sessions_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grade_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  student_name VARCHAR(150) NOT NULL,
  student_id VARCHAR(50) NOT NULL,
  prelim_grade DECIMAL(5,2) NOT NULL,
  midterm_grade DECIMAL(5,2) NOT NULL,
  final_grade DECIMAL(5,2) NOT NULL,
  computed_grade DECIMAL(5,2) NOT NULL,
  equivalent_grade DECIMAL(4,2) NOT NULL,
  remarks ENUM('PASSED','FAILED') NOT NULL,
  activity_breakdown_json LONGTEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uq_grade_records_student_id (student_id),
  CONSTRAINT chk_prelim_grade CHECK (prelim_grade BETWEEN 0 AND 100),
  CONSTRAINT chk_midterm_grade CHECK (midterm_grade BETWEEN 0 AND 100),
  CONSTRAINT chk_final_grade CHECK (final_grade BETWEEN 0 AND 100)
) ENGINE=InnoDB;

ALTER TABLE grade_records ADD COLUMN IF NOT EXISTS activity_breakdown_json LONGTEXT DEFAULT NULL AFTER remarks;

CREATE TABLE IF NOT EXISTS grade_users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  login_id VARCHAR(50) NOT NULL,
  role ENUM('admin','student') NOT NULL,
  student_id VARCHAR(50) DEFAULT NULL,
  student_name VARCHAR(150) DEFAULT NULL,
  password_hash VARCHAR(255) NOT NULL,
  session_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_activity_at DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grade_users_role_login (role, login_id),
  UNIQUE KEY uq_grade_users_student_id (student_id),
  KEY idx_grade_users_role (role)
) ENGINE=InnoDB;

ALTER TABLE grade_users ADD COLUMN IF NOT EXISTS last_activity_at DATETIME DEFAULT NULL AFTER created_at;

CREATE TABLE IF NOT EXISTS grade_student_user_ids (
  student_user_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (student_user_id),
  UNIQUE KEY uq_grade_student_user_ids_user_id (user_id),
  CONSTRAINT fk_grade_student_user_ids_user FOREIGN KEY (user_id) REFERENCES grade_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO grade_student_user_ids (user_id)
SELECT u.id FROM grade_users u
LEFT JOIN grade_student_user_ids su ON su.user_id = u.id
WHERE u.role = 'student' AND su.user_id IS NULL
ORDER BY u.created_at, u.id;

CREATE TABLE IF NOT EXISTS grade_registration_approvals (
  student_id VARCHAR(50) NOT NULL,
  expires_at DATETIME NOT NULL,
  approved_by BIGINT UNSIGNED NOT NULL,
  approved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (student_id),
  KEY idx_grade_registration_expires (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grade_user_profiles (
  user_id BIGINT UNSIGNED NOT NULL,
  student_id VARCHAR(50) DEFAULT NULL,
  first_name VARCHAR(60) NOT NULL,
  middle_name VARCHAR(60) DEFAULT NULL,
  last_name VARCHAR(60) NOT NULL,
  year_level VARCHAR(50) NOT NULL,
  department VARCHAR(120) NOT NULL,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_grade_user_profiles_student_id (student_id),
  CONSTRAINT fk_grade_user_profiles_user FOREIGN KEY (user_id) REFERENCES grade_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE grade_user_profiles ADD COLUMN IF NOT EXISTS student_id VARCHAR(50) DEFAULT NULL AFTER user_id;
ALTER TABLE grade_user_profiles ADD UNIQUE INDEX IF NOT EXISTS uq_grade_user_profiles_student_id (student_id);
UPDATE grade_user_profiles p
JOIN grade_users u ON u.id = p.user_id
SET p.student_id = COALESCE(u.student_id, u.login_id)
WHERE u.role = 'student' AND p.student_id IS NULL;

CREATE TABLE IF NOT EXISTS grade_calculations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  calculation_name VARCHAR(100) NOT NULL,
  prelim_grade DECIMAL(5,2) NOT NULL,
  midterm_grade DECIMAL(5,2) NOT NULL,
  final_grade DECIMAL(5,2) NOT NULL,
  computed_grade DECIMAL(5,2) NOT NULL,
  equivalent_grade DECIMAL(4,2) NOT NULL,
  remarks ENUM('PASSED','FAILED') NOT NULL,
  activity_breakdown_json LONGTEXT DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_grade_calculations_user_created (user_id, created_at, id),
  CONSTRAINT fk_grade_calculations_user FOREIGN KEY (user_id) REFERENCES grade_users (id) ON DELETE CASCADE
) ENGINE=InnoDB;

ALTER TABLE grade_calculations ADD COLUMN IF NOT EXISTS activity_breakdown_json LONGTEXT DEFAULT NULL AFTER remarks;
