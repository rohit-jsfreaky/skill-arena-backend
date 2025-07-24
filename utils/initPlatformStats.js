import { pool } from "../db/db.js";

export const initPlatformStatsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS platform_statistics (
        id SERIAL PRIMARY KEY,
        stat_key VARCHAR(100) UNIQUE NOT NULL,
        stat_value BIGINT DEFAULT 0,
        stat_label VARCHAR(255) NOT NULL,
        stat_description TEXT,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        icon VARCHAR(100),
        format_type VARCHAR(50) DEFAULT 'number', -- 'number', 'currency', 'percentage'
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Insert default statistics if they don't exist
    await pool.query(`
      INSERT INTO platform_statistics (stat_key, stat_value, stat_label, stat_description, display_order, icon, format_type)
      VALUES 
        ('total_matches', 0, 'Total Matches Played', 'Total number of matches played across all tournaments', 1, 'trophy', 'number'),
        ('total_prizes', 0, 'Total Prizes Distributed', 'Total amount of prizes distributed to players', 2, 'dollar-sign', 'currency'),
        ('total_players', 0, 'Total Registered Players', 'Total number of registered players on the platform', 3, 'users', 'number'),
        ('active_tournaments', 0, 'Active Tournaments', 'Number of currently active tournaments', 4, 'calendar', 'number'),
        ('total_tournaments', 0, 'Total Tournaments', 'Total number of tournaments hosted', 5, 'award', 'number')
      ON CONFLICT (stat_key) DO NOTHING;
    `);

    console.log("✅ Platform statistics table created successfully");
  } catch (error) {
    console.error("❌ Error creating platform statistics table:", error);
    throw error;
  }
};
