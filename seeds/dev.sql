-- Sample data for local development only. Never run this against production.

INSERT INTO users (discord_id, name, role) VALUES ('dev-admin', 'Dev Admin', 'admin');

INSERT INTO matches (id, played_on, duration_sec) VALUES (1, '2026-11-01', 2100);

INSERT INTO player_stats (
  match_id, family_name, class_id, style,
  kills, deaths, max_streak, dmg_dealt, dmg_taken, cc_hits, heal, ally_heal, fort_dmg,
  cannon_shots, cannon_kills, cannon_max_dist, traps, dead_sec, alive_sec
) VALUES (
  1, 'TestPlayer', NULL, 'awakening',
  12, 5, 4, 1360000, 900000, 40, 500000, 0, 250000,
  0, 0, 0, 0, 300, 1800
);
