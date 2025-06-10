import cron from "node-cron";
import { pool } from "../db/db.js";

const adminAuthOtpCheck = async () => {
  try {
    await pool.query(`
        DELETE FROM email_verifications WHERE created_at < NOW() - INTERVAL '15 minutes'
      `);
    console.log("Expired email verifications deleted");
  } catch (error) {
    console.error("Error deleting expired verifications:", error);
  }
};

cron.schedule("* * * * *", () => {
  console.log("Running Auth otp status Check...");
  adminAuthOtpCheck();
});

export default adminAuthOtpCheck;
