import { pool } from "../db/db.js";

export const initLeaderboardTables = async () => {
  try {
    // Create user_leaderboard_stats table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_leaderboard_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        total_kills INTEGER DEFAULT 0,
        total_deaths INTEGER DEFAULT 0,
        kill_death_ratio DECIMAL(10,2) DEFAULT 0.00,
        headshots INTEGER DEFAULT 0,
        assists INTEGER DEFAULT 0,
        damage_dealt BIGINT DEFAULT 0,
        accuracy_percentage DECIMAL(5,2) DEFAULT 0.00,
        mvp_count INTEGER DEFAULT 0,
        longest_killstreak INTEGER DEFAULT 0,
        favorite_weapon VARCHAR(100) DEFAULT NULL,
        playtime_hours DECIMAL(10,2) DEFAULT 0.00,
        rank_points INTEGER DEFAULT 0,
        season_rank VARCHAR(50) DEFAULT 'Unranked',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
      );
    `);

    // Create game_specific_stats table for per-game statistics
    await pool.query(`
      CREATE TABLE IF NOT EXISTS game_specific_stats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        game_name VARCHAR(255) NOT NULL,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        wins INTEGER DEFAULT 0,
        losses INTEGER DEFAULT 0,
        matches_played INTEGER DEFAULT 0,
        kill_death_ratio DECIMAL(10,2) DEFAULT 0.00,
        win_rate DECIMAL(5,2) DEFAULT 0.00,
        best_score INTEGER DEFAULT 0,
        playtime_hours DECIMAL(10,2) DEFAULT 0.00,
        last_played TIMESTAMP DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, game_name)
      );
    `);

    // Create function to update kill_death_ratio automatically
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_kd_ratio()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Update kill_death_ratio in user_leaderboard_stats
        NEW.kill_death_ratio = CASE 
          WHEN NEW.total_deaths = 0 THEN NEW.total_kills::DECIMAL
          ELSE ROUND(NEW.total_kills::DECIMAL / NEW.total_deaths::DECIMAL, 2)
        END;
        
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create function to update game-specific kill_death_ratio and win_rate
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_game_stats()
      RETURNS TRIGGER AS $$
      BEGIN
        -- Update kill_death_ratio
        NEW.kill_death_ratio = CASE 
          WHEN NEW.deaths = 0 THEN NEW.kills::DECIMAL
          ELSE ROUND(NEW.kills::DECIMAL / NEW.deaths::DECIMAL, 2)
        END;
        
        -- Update win_rate
        NEW.win_rate = CASE 
          WHEN NEW.matches_played = 0 THEN 0
          ELSE ROUND((NEW.wins::DECIMAL / NEW.matches_played::DECIMAL) * 100, 2)
        END;
        
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create triggers
    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_update_kd_ratio ON user_leaderboard_stats;
      CREATE TRIGGER trigger_update_kd_ratio
        BEFORE INSERT OR UPDATE ON user_leaderboard_stats
        FOR EACH ROW EXECUTE FUNCTION update_kd_ratio();
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_update_game_stats ON game_specific_stats;
      CREATE TRIGGER trigger_update_game_stats
        BEFORE INSERT OR UPDATE ON game_specific_stats
        FOR EACH ROW EXECUTE FUNCTION update_game_stats();
    `);

    // Create indexes for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_user_leaderboard_stats_user_id ON user_leaderboard_stats(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_leaderboard_stats_rank_points ON user_leaderboard_stats(rank_points DESC);
      CREATE INDEX IF NOT EXISTS idx_user_leaderboard_stats_kills ON user_leaderboard_stats(total_kills DESC);
      CREATE INDEX IF NOT EXISTS idx_game_specific_stats_user_game ON game_specific_stats(user_id, game_name);
      CREATE INDEX IF NOT EXISTS idx_game_specific_stats_game_kills ON game_specific_stats(game_name, kills DESC);
    `);

    console.log("✅ Leaderboard tables created successfully");
  } catch (error) {
    console.error("❌ Error creating leaderboard tables:", error);
    throw error;
  }
};

// Function to initialize default stats for existing users
export const initializeDefaultStatsForUsers = async () => {
  try {
    // Insert default stats for users who don't have leaderboard stats yet
    await pool.query(`
      INSERT INTO user_leaderboard_stats (user_id)
      SELECT u.id 
      FROM users u
      LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
      WHERE uls.user_id IS NULL
    `);

    console.log("✅ Default leaderboard stats initialized for existing users");
  } catch (error) {
    console.error("❌ Error initializing default stats:", error);
    throw error;
  }
};