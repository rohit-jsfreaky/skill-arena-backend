import { pool } from "../db/db.js";

export const updateSchemaConstraints = async () => {
  try {
    await pool.query('BEGIN');
    
    // Update user_tournaments foreign key
    await pool.query(`
      ALTER TABLE user_tournaments 
      DROP CONSTRAINT IF EXISTS user_tournaments_tournament_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE user_tournaments
      ADD CONSTRAINT user_tournaments_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
      ON DELETE CASCADE;
    `);
    
    // Update tournament_screenshots foreign key
    await pool.query(`
      ALTER TABLE tournament_screenshots 
      DROP CONSTRAINT IF EXISTS tournament_screenshots_tournament_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE tournament_screenshots
      ADD CONSTRAINT tournament_screenshots_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
      ON DELETE CASCADE;
    `);
    
    // Update tournament_results foreign key
    await pool.query(`
      ALTER TABLE tournament_results 
      DROP CONSTRAINT IF EXISTS tournament_results_tournament_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE tournament_results
      ADD CONSTRAINT tournament_results_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
      ON DELETE CASCADE;
    `);
    
    // Update teams foreign key
    await pool.query(`
      ALTER TABLE teams 
      DROP CONSTRAINT IF EXISTS teams_tournament_id_fkey;
    `);
    await pool.query(`
      ALTER TABLE teams
      ADD CONSTRAINT teams_tournament_id_fkey
      FOREIGN KEY (tournament_id) REFERENCES tournaments(id)
      ON DELETE CASCADE;
    `);
    
    await pool.query('COMMIT');
    console.log("Schema constraints updated successfully");
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error("Error updating schema constraints:", error);
    throw error;
  }
};