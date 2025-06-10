import cron from "node-cron";
import { pool } from "../db/db.js";

// Function to update tournament statuses
const updateTournamentStatus = async () => {
  const client = await pool.connect();
  
  try {
    // Update ongoing tournaments to completed if end_time has passed
    await client.query(`
      UPDATE tournaments
      SET status = 'completed'
      WHERE status = 'ongoing' AND end_time < CURRENT_TIMESTAMP
    `);
    
    // Update upcoming tournaments to ongoing if start_time has passed but end_time hasn't
    await client.query(`
      UPDATE tournaments
      SET status = 'ongoing'
      WHERE status = 'upcoming' AND start_time < CURRENT_TIMESTAMP AND end_time > CURRENT_TIMESTAMP
    `);
    
    console.log("Tournament statuses updated.");
  } catch (err) {
    console.error("Error updating tournament statuses:", err);
  } finally {
    client.release();
  }
};

// Run every minute
cron.schedule("* * * * *", () => {
  console.log("Running tournament status update...");
  updateTournamentStatus();
});

export default updateTournamentStatus;
