-- NCTF schema (MySQL 8.0.16+ for CHECK constraints, 8.0.13+ for expression defaults)
CREATE DATABASE IF NOT EXISTS nctf_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE nctf_db;

CREATE TABLE users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(255) NOT NULL UNIQUE,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  password_hash CHAR(60)     NOT NULL,
  role          ENUM('user','admin') NOT NULL DEFAULT 'user',
  team_id       INT UNSIGNED NULL,
  created_at    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP())
) ENGINE=InnoDB;

CREATE TABLE teams (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(40) NOT NULL UNIQUE,
  captain_id    INT UNSIGNED NOT NULL,
  profile_photo VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  CONSTRAINT fk_teams_captain FOREIGN KEY (captain_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE users
  ADD CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;

CREATE TABLE events (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  description TEXT NULL,
  start_time  DATETIME NOT NULL,
  end_time    DATETIME NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  CONSTRAINT chk_event_window CHECK (end_time > start_time),
  INDEX idx_events_window (start_time, end_time)
) ENGINE=InnoDB;

CREATE TABLE event_registrations (
  event_id      INT UNSIGNED NOT NULL,
  team_id       INT UNSIGNED NOT NULL,
  registered_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (event_id, team_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id)  REFERENCES teams(id)  ON DELETE CASCADE
) ENGINE=InnoDB;

-- Spendable points per team per event (separate from earned score)
CREATE TABLE team_event_balances (
  team_id  INT UNSIGNED NOT NULL,
  event_id INT UNSIGNED NOT NULL,
  balance  INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (team_id, event_id),
  FOREIGN KEY (team_id)  REFERENCES teams(id)  ON DELETE CASCADE,
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE challenges (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  event_id    INT UNSIGNED NOT NULL,
  title       VARCHAR(120) NOT NULL,
  description TEXT NULL,
  category    VARCHAR(40)  NOT NULL DEFAULT 'misc',
  flag_hmac   CHAR(64)     NOT NULL,
  point_value INT UNSIGNED NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  INDEX idx_challenges_event (event_id),
  FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE hints (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  challenge_id INT UNSIGNED NOT NULL,
  body         TEXT NOT NULL,
  cost         INT UNSIGNED NOT NULL DEFAULT 0,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE hint_purchases (
  team_id      INT UNSIGNED NOT NULL,
  hint_id      INT UNSIGNED NOT NULL,
  purchased_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  PRIMARY KEY (team_id, hint_id),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (hint_id) REFERENCES hints(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE solves (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id        INT UNSIGNED NOT NULL,
  challenge_id   INT UNSIGNED NOT NULL,
  event_id       INT UNSIGNED NOT NULL,
  points_awarded INT UNSIGNED NOT NULL,
  solved_at      DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  UNIQUE KEY uq_solve (team_id, challenge_id),
  INDEX idx_solves_event (event_id, team_id),
  FOREIGN KEY (team_id)      REFERENCES teams(id)      ON DELETE CASCADE,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
  FOREIGN KEY (event_id)     REFERENCES events(id)     ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE team_requests (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  team_id    INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  type       ENUM('request','invite') NOT NULL,
  status     ENUM('pending','accepted','declined') NOT NULL DEFAULT 'pending',
  created_at DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
  INDEX idx_req_team (team_id, status),
  INDEX idx_req_user (user_id, status),
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;
