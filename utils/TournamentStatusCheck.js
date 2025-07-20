import cron from "node-cron";
import { pool } from "../db/db.js";

const updateTournamentStatus = async () => {
  const client = await pool.connect();

  try {
    // Get current time in IST (your local timezone)
    const currentTimeResult = await client.query(`
      SELECT 
        NOW() as server_time,
        NOW() AT TIME ZONE 'UTC' as utc_time,
        NOW() AT TIME ZONE 'Asia/Kolkata' as ist_time
    `);
    
    const times = currentTimeResult.rows[0];
    console.log("🕐 Server Time:", times.server_time);
    console.log("🕐 UTC Time:", times.utc_time);
    console.log("🕐 IST Time:", times.ist_time);
    
    // Use server local time for comparison (assuming your server is in IST)
    const currentTime = times.server_time;
    
    // Log current tournaments for debugging
    const res = await client.query(`
      SELECT id, name, 
             start_time,
             end_time,
             status,
             start_time <= $1 as should_start,
             end_time <= $1 as should_end,
             EXTRACT(EPOCH FROM ($1 - start_time)) as seconds_since_start,
             EXTRACT(EPOCH FROM ($1 - end_time)) as seconds_since_end
      FROM tournaments
      WHERE status IN ('upcoming', 'ongoing')
    `, [currentTime]);
    
    console.log("📋 Tournaments to check:");
    res.rows.forEach(tournament => {
      console.log(`
        Tournament ID: ${tournament.id}
        Name: ${tournament.name}
        Status: ${tournament.status}
        
        Start Time: ${tournament.start_time}
        End Time: ${tournament.end_time}
        Current Time: ${currentTime}
        
        Should Start: ${tournament.should_start}
        Should End: ${tournament.should_end}
        
        Seconds since start: ${tournament.seconds_since_start}
        Seconds since end: ${tournament.seconds_since_end}
        
        ═══════════════════════════════════════
      `);
    });

    // ✅ Step 1: Update upcoming to ongoing
    console.log("🔄 Step 1: Checking upcoming tournaments to make ongoing...");
    const ongoingResult = await client.query(`
      UPDATE tournaments
      SET status = 'ongoing'
      WHERE status = 'upcoming'
        AND start_time <= $1
        AND end_time > $1
      RETURNING id, name, status, start_time, end_time
    `, [currentTime]);
    
    if (ongoingResult.rows.length > 0) {
      console.log("✅ Updated to ongoing:", ongoingResult.rows);
    } else {
      console.log("❌ No tournaments updated to ongoing");
    }

    // ✅ Step 2: Update ongoing to completed
    console.log("🔄 Step 2: Checking ongoing tournaments to complete...");
    const completedResult = await client.query(`
      UPDATE tournaments
      SET status = 'completed'
      WHERE status = 'ongoing'
        AND end_time <= $1
      RETURNING id, name, status, end_time
    `, [currentTime]);
    
    if (completedResult.rows.length > 0) {
      console.log("✅ Updated to completed:", completedResult.rows);
    } else {
      console.log("❌ No ongoing tournaments updated to completed");
    }

    // ✅ Step 3: Update expired upcoming tournaments
    console.log("🔄 Step 3: Checking expired upcoming tournaments...");
    const expiredUpcomingResult = await client.query(`
      UPDATE tournaments
      SET status = 'completed'
      WHERE status = 'upcoming'
        AND end_time <= $1
      RETURNING id, name, status, end_time
    `, [currentTime]);
    
    if (expiredUpcomingResult.rows.length > 0) {
      console.log("✅ Updated expired upcoming to completed:", expiredUpcomingResult.rows);
    } else {
      console.log("❌ No expired upcoming tournaments updated");
    }

    console.log("🏁 Tournament status update completed.");
    
  } catch (err) {
    console.error("❌ Error updating tournament statuses:", err);
  } finally {
    client.release();
  }
};

// Run every minute for testing
cron.schedule("* * * * *", () => {
  console.log("🚀 Running tournament status update...");
  updateTournamentStatus();
});

export default updateTournamentStatus;