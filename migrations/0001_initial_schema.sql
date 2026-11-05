-- nodewar 完整資料表結構（依目前原始碼整理）
-- 適用：Cloudflare D1 / SQLite
-- 新資料庫可整份執行；已有資料庫請改跑下方「既有庫遷移」段落，避免清掉資料。

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 1. Discord 可登入使用者（白名單）
--    role = 'admin' 管理員（上傳/清理/成員管理）
--    role = 'member' 普通成員（僅查詢，由身份組同步寫入）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  discord_id TEXT PRIMARY KEY,
  name       TEXT,
  role       TEXT NOT NULL DEFAULT 'member'
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ---------------------------------------------------------------------------
-- 2. 場次
--    guild / node 為舊欄位，程式固定寫入空字串；唯一鍵 (played_on, guild, node)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  played_on    TEXT    NOT NULL,          -- YYYY-MM-DD
  guild        TEXT    NOT NULL DEFAULT '',
  node         TEXT    NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL,          -- 秒
  uploader     TEXT,                      -- Discord ID
  created_at   TEXT    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (played_on, guild, node)
);

CREATE INDEX IF NOT EXISTS idx_matches_played_on ON matches(played_on);

-- ---------------------------------------------------------------------------
-- 3. 玩家單場戰績
--    INSERT OR REPLACE 依 (match_id, family_name) 覆蓋
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_stats (
  match_id         INTEGER NOT NULL,
  family_name      TEXT    NOT NULL,
  class_id         TEXT,
  style            TEXT,               -- succession | awakening | open
  kills            INTEGER NOT NULL DEFAULT 0,
  deaths           INTEGER NOT NULL DEFAULT 0,
  max_streak       INTEGER NOT NULL DEFAULT 0,
  dmg_dealt        INTEGER NOT NULL DEFAULT 0,
  dmg_taken        INTEGER NOT NULL DEFAULT 0,
  cc_hits          INTEGER NOT NULL DEFAULT 0,
  heal             INTEGER NOT NULL DEFAULT 0,
  ally_heal        INTEGER NOT NULL DEFAULT 0,
  fort_dmg         INTEGER NOT NULL DEFAULT 0,
  cannon_shots     INTEGER NOT NULL DEFAULT 0,
  cannon_kills     INTEGER NOT NULL DEFAULT 0,
  cannon_max_dist  INTEGER NOT NULL DEFAULT 0,
  traps            INTEGER NOT NULL DEFAULT 0,
  dead_sec         INTEGER NOT NULL DEFAULT 0,
  alive_sec        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (match_id, family_name),
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_player_stats_family ON player_stats(family_name);

-- ---------------------------------------------------------------------------
-- 4. 家門名稱名單（AI 辨識對照用，與 Discord users 不同）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS members (
  name       TEXT PRIMARY KEY,
  guild      TEXT,                     -- 所屬公會名稱，可空
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_members_guild ON members(guild);

-- ---------------------------------------------------------------------------
-- 5. 公會列表（成員名單下拉用）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS guilds (
  name       TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 6. 職業圖示模板（灰階 32×32 → 1024 個 0–255，JSON 陣列字串）
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS icon_templates (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id   TEXT    NOT NULL,
  vec        TEXT    NOT NULL,         -- JSON array length 1024
  created_by TEXT,                     -- Discord ID
  created_at TEXT    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icon_templates_class ON icon_templates(class_id);
