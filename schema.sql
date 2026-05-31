-- FarmTycoon Datenbankschema
-- In MySQL Workbench ausführen, nachdem du eine Datenbank "farmtycoon" angelegt hast

CREATE TABLE IF NOT EXISTS users (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(30)  NOT NULL UNIQUE,
  email        VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_states (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  user_id       INT NOT NULL UNIQUE,
  save_version  INT NOT NULL DEFAULT 0,
  state_json    LONGTEXT NOT NULL,
  last_saved_at BIGINT NOT NULL,   -- Unix-Millisekunden (für Offline-Ticks)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index für schnellen Lookup
CREATE INDEX idx_game_states_user ON game_states(user_id);
