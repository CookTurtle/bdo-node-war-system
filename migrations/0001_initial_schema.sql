-- Reconstructed from the SQL in functions/, not exported from production.
-- Replace with the real schema once the project owner has exported it.

CREATE TABLE users (
  discord_id TEXT PRIMARY KEY,
  name TEXT,
  role TEXT
);

CREATE TABLE guilds (
  name TEXT PRIMARY KEY
);

CREATE TABLE members (
  name TEXT PRIMARY KEY,
  guild TEXT
);

CREATE TABLE matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  played_on TEXT NOT NULL,
  guild TEXT NOT NULL DEFAULT '',
  node TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL,
  uploader TEXT,
  UNIQUE (played_on, guild, node)
);

CREATE TABLE player_stats (
  match_id INTEGER NOT NULL,
  family_name TEXT NOT NULL,
  class_id TEXT,
  style TEXT,
  kills INTEGER,
  deaths INTEGER,
  max_streak INTEGER,
  dmg_dealt INTEGER,
  dmg_taken INTEGER,
  cc_hits INTEGER,
  heal INTEGER,
  ally_heal INTEGER,
  fort_dmg INTEGER,
  cannon_shots INTEGER,
  cannon_kills INTEGER,
  cannon_max_dist INTEGER,
  traps INTEGER,
  dead_sec INTEGER,
  alive_sec INTEGER,
  PRIMARY KEY (match_id, family_name)
);

CREATE TABLE icon_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id TEXT NOT NULL,
  vec TEXT NOT NULL,
  created_by TEXT
);
