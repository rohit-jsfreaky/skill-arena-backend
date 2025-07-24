import { pool } from "../db/db.js";

// Utility functions to automatically update platform statistics when events occur

export const incrementPlatformStat = async (statKey, incrementBy = 1) => {
  try {
    const query = `
      UPDATE platform_statistics 
      SET stat_value = stat_value + $1, updated_at = CURRENT_TIMESTAMP 
      WHERE stat_key = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [incrementBy, statKey]);
    return result.rows[0];
  } catch (error) {
    console.error(`Error incrementing platform stat ${statKey}:`, error);
    return null;
  }
};

export const decrementPlatformStat = async (statKey, decrementBy = 1) => {
  try {
    const query = `
      UPDATE platform_statistics 
      SET stat_value = GREATEST(stat_value - $1, 0), updated_at = CURRENT_TIMESTAMP 
      WHERE stat_key = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [decrementBy, statKey]);
    return result.rows[0];
  } catch (error) {
    console.error(`Error decrementing platform stat ${statKey}:`, error);
    return null;
  }
};

export const setPlatformStat = async (statKey, value) => {
  try {
    const query = `
      UPDATE platform_statistics 
      SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
      WHERE stat_key = $2
      RETURNING *
    `;
    
    const result = await pool.query(query, [value, statKey]);
    return result.rows[0];
  } catch (error) {
    console.error(`Error setting platform stat ${statKey}:`, error);
    return null;
  }
};

// Event handlers to call when specific actions occur

export const onUserRegistered = async () => {
  await incrementPlatformStat('total_players');
};

export const onTournamentCreated = async () => {
  await incrementPlatformStat('total_tournaments');
  await incrementPlatformStat('active_tournaments');
};

export const onTournamentCompleted = async (prizePool) => {
  await decrementPlatformStat('active_tournaments');
  await incrementPlatformStat('total_matches');
  if (prizePool > 0) {
    await incrementPlatformStat('total_prizes', prizePool);
  }
};

export const onTournamentDeleted = async () => {
  await decrementPlatformStat('total_tournaments');
};

export const onMatchCompleted = async () => {
  await incrementPlatformStat('total_matches');
};
