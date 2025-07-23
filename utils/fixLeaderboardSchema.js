import { pool } from "../db/db.js";

export const fixLeaderboardSchema = async () => {
  try {
    // Alter the accuracy_percentage column to allow larger values
    await pool.query(`
      ALTER TABLE user_leaderboard_stats 
      ALTER COLUMN accuracy_percentage TYPE DECIMAL(6,2);
    `);

    // Also make sure other numeric fields can handle large values
    await pool.query(`
      ALTER TABLE user_leaderboard_stats 
      ALTER COLUMN playtime_hours TYPE DECIMAL(12,2);
    `);

    console.log("✅ Leaderboard schema updated successfully");
  } catch (error) {
    console.error("❌ Error updating leaderboard schema:", error);
    // Don't throw error if columns already have correct type
    if (!error.message.includes('already exists') && !error.message.includes('type already')) {
      throw error;
    }
  }
};
