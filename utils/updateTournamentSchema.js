import { pool } from "../db/db.js";

export const updateTournamentSchemaForSlots = async () => {
  try {
    await pool.query('BEGIN');
    
    console.log("🔄 Updating tournament schema for slot-based system...");
    
    // 1. Add new columns to tournaments table
    await pool.query(`
      ALTER TABLE tournaments 
      ADD COLUMN IF NOT EXISTS tournament_mode VARCHAR(10) DEFAULT 'solo' CHECK (tournament_mode IN ('solo', 'duo', '4v4', '6v6', '8v8')),
      ADD COLUMN IF NOT EXISTS group_count INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS slots_per_group INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS total_slots INTEGER GENERATED ALWAYS AS (group_count * slots_per_group) STORED
    `);
    
    console.log("✅ Added tournament mode and slot columns");
    
    // 2. Create tournament_slots table to track individual slot occupancy
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournament_slots (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        group_number INTEGER NOT NULL,
        slot_position INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tournament_id, group_number, slot_position),
        UNIQUE(tournament_id, user_id), -- Prevent duplicate joining
        CHECK(group_number > 0),
        CHECK(slot_position > 0)
      )
    `);
    
    console.log("✅ Created tournament_slots table");
    
    // 3. Create index for better performance
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tournament_slots_tournament_group 
      ON tournament_slots(tournament_id, group_number)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_tournament_slots_user 
      ON tournament_slots(tournament_id, user_id)
    `);
    
    console.log("✅ Created indexes for tournament slots");
    
    // 4. Update existing tournaments to have default values
    await pool.query(`
      UPDATE tournaments 
      SET 
        tournament_mode = 'solo',
        group_count = CASE 
          WHEN max_participants <= 50 THEN max_participants 
          ELSE 50 
        END,
        slots_per_group = 1
      WHERE tournament_mode IS NULL
    `);
    
    console.log("✅ Updated existing tournaments with default values");
    
    // 5. Create a function to get available slots for a tournament
    await pool.query(`
      CREATE OR REPLACE FUNCTION get_tournament_group_availability(tournament_id_param INTEGER)
      RETURNS TABLE(
        group_number INTEGER,
        slots_filled BIGINT,
        slots_total INTEGER,
        is_full BOOLEAN
      ) AS $$
      BEGIN
        RETURN QUERY
        WITH group_series AS (
          SELECT generate_series(1, t.group_count) as group_num
          FROM tournaments t 
          WHERE t.id = tournament_id_param
        ),
        group_counts AS (
          SELECT 
            gs.group_num as group_number,
            COALESCE(COUNT(ts.user_id), 0) as slots_filled,
            t.slots_per_group as slots_total
          FROM group_series gs
          LEFT JOIN tournament_slots ts ON ts.tournament_id = tournament_id_param 
            AND ts.group_number = gs.group_num 
            AND ts.user_id IS NOT NULL
          CROSS JOIN tournaments t
          WHERE t.id = tournament_id_param
          GROUP BY gs.group_num, t.slots_per_group
        )
        SELECT 
          gc.group_number,
          gc.slots_filled,
          gc.slots_total,
          (gc.slots_filled >= gc.slots_total) as is_full
        FROM group_counts gc
        ORDER BY gc.group_number;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    console.log("✅ Created tournament group availability function");
    
    await pool.query('COMMIT');
    console.log("🎉 Tournament schema update completed successfully!");
    
  } catch (error) {
    await pool.query('ROLLBACK');
    console.error("❌ Error updating tournament schema:", error);
    throw error;
  }
};

// Function to set slots per group based on tournament mode
export const getSlotsPerGroup = (tournamentMode) => {
  const slotMap = {
    'solo': 1,
    'duo': 2,
    '4v4': 4,
    '6v6': 6,
    '8v8': 8
  };
  return slotMap[tournamentMode] || 1;
};

// Utility function to validate tournament mode
export const validateTournamentMode = (mode) => {
  const validModes = ['solo', 'duo', '4v4', '6v6', '8v8'];
  return validModes.includes(mode);
};
