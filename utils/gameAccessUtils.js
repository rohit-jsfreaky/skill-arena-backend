import { pool } from "../db/db.js";

/**
 * Set games as premium when adding to a membership
 * @param {Array} gameIds Array of game IDs to mark as pro
 */
export const markGamesAsPro = async (gameIds) => {
  if (!gameIds || gameIds.length === 0) return;
  
  try {
    await pool.query(`
      UPDATE games
      SET access_type = 'pro'
      WHERE id = ANY($1::int[])
    `, [gameIds]);
    
    console.log(`Updated ${gameIds.length} games to pro status`);
  } catch (error) {
    console.error("Error marking games as pro:", error);
  }
};

/**
 * Check if games should revert to free after being removed from a membership
 * @param {Array} gameIds Array of game IDs to check
 */
export const updateGameAccessAfterRemoval = async (gameIds) => {
  if (!gameIds || gameIds.length === 0) return;
  
  try {
    // Find games that are not in any membership anymore
    const result = await pool.query(`
      SELECT g.id 
      FROM games g
      LEFT JOIN membership_games mg ON g.id = mg.game_id
      WHERE g.id = ANY($1::int[])
      GROUP BY g.id
      HAVING COUNT(mg.id) = 0
    `, [gameIds]);
    
    const gamesToRevert = result.rows.map(row => row.id);
    
    if (gamesToRevert.length > 0) {
      // Mark these games as free since they're not in any membership
      await pool.query(`
        UPDATE games
        SET access_type = 'free'
        WHERE id = ANY($1::int[])
      `, [gamesToRevert]);
      
      console.log(`Reverted ${gamesToRevert.length} games to free status`);
    }
  } catch (error) {
    console.error("Error updating game access after removal:", error);
  }
};