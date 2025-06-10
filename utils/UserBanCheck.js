import cron from "node-cron";
import { pool } from "../db/db.js";

// Function to automatically unban users whose ban period has expired
const automaticUnbanExpiredUsers = async () => {
  let client;
  
  try {
    client = await pool.connect();
    
    // Find and unban users whose ban period has expired
    const query = `
      UPDATE users
      SET is_banned = FALSE,
          banned_until = NULL,
          ban_reason = NULL
      WHERE is_banned = TRUE
        AND banned_until IS NOT NULL
        AND banned_until <= CURRENT_TIMESTAMP
      RETURNING id, username
    `;
    
    const result = await client.query(query);
    
    if (result.rows.length > 0) {
      console.log(`Automatically unbanned ${result.rows.length} users:`);
      result.rows.forEach(user => {
        console.log(`- User ID: ${user.id}, Username: ${user.username}`);
      });
    }
  } catch (error) {
    console.error("Error in automatic user unban process:", error);
  } finally {
    if (client) {
      client.release();
    }
  }
};

// Run the check every 5 minutes
// You can adjust the frequency as needed
cron.schedule("*/5 * * * *", () => {
  console.log("Running automatic user unban check...");
  automaticUnbanExpiredUsers();
});

export default automaticUnbanExpiredUsers;