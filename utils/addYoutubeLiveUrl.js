import { pool } from "../db/db.js";

export const addYoutubeLiveUrlColumn = async () => {
  try {
    // Add youtube_live_url column to tournaments table
    await pool.query(`
      ALTER TABLE tournaments 
      ADD COLUMN IF NOT EXISTS youtube_live_url TEXT DEFAULT NULL;
    `);
    
    console.log("✅ YouTube live URL column added successfully");
  } catch (error) {
    console.error("❌ Error adding YouTube live URL column:", error);
    throw error;
  }
};
