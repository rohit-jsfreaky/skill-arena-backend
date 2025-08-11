import { pool } from "../db/db.js";

export async function updateTournamentSchemaForSlots() {
  const client = await pool.connect();
  
  try {
    console.log("Updating tournament schema for slot-based tournaments...");

    // Create ENUM type for tournament modes if it doesn't exist
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE tournament_mode_enum AS ENUM ('solo', 'duo', '4v4', '6v6', '8v8');
      EXCEPTION
        WHEN duplicate_object THEN null;
      END $$;
    `);

    // Add new columns to tournaments table
    await client.query(`
      DO $$ BEGIN
        -- Add tournament_mode column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='tournaments' AND column_name='tournament_mode') THEN
          ALTER TABLE tournaments ADD COLUMN tournament_mode tournament_mode_enum DEFAULT 'solo';
        END IF;
        
        -- Add max_groups column
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name='tournaments' AND column_name='max_groups') THEN
          ALTER TABLE tournaments ADD COLUMN max_groups INTEGER DEFAULT 1;
        END IF;
      END $$;
    `);

    // Create tournament_groups table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_groups (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL,
        group_number INTEGER NOT NULL,
        is_full BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
        UNIQUE(tournament_id, group_number)
      );
    `);

    // Create tournament_group_members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS tournament_group_members (
        id SERIAL PRIMARY KEY,
        group_id INTEGER NOT NULL,
        user_id VARCHAR(255) NOT NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES tournament_groups(id) ON DELETE CASCADE,
        UNIQUE(group_id, user_id)
      );
    `);

    // Create indexes for better performance
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_tournament_groups_tournament_id ON tournament_groups(tournament_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_group_members_group_id ON tournament_group_members(group_id);
      CREATE INDEX IF NOT EXISTS idx_tournament_group_members_user_id ON tournament_group_members(user_id);
    `);

    console.log("Tournament schema updated successfully for slot-based tournaments!");

  } catch (error) {
    console.error("Error updating tournament schema:", error);
    throw error;
  } finally {
    client.release();
  }
}
