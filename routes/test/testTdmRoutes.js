import { Router } from "express";
import { pool } from "../../db/db.js";

const testTdmRouter = Router();

// Test route to populate a TDM match with random users
testTdmRouter.post("/populate-tdm/:match_id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { match_id } = req.params;
    const { captainId = 20 } = req.body; // Default to user ID 20 as captain
    
    await client.query("BEGIN");
    
    // Check if match exists
    const matchCheck = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );
    
    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchCheck.rows[0];
    const teamSize = match.team_size || 4;
    
    // Get random users from database
    const usersResult = await client.query(
      "SELECT id, username FROM users WHERE id != $1 ORDER BY RANDOM() LIMIT $2",
      [captainId, (teamSize * 2) - 1] // -1 because captain is already included
    );
    
    if (usersResult.rows.length < (teamSize * 2) - 1) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Not enough users in database. Need ${(teamSize * 2) - 1} users, found ${usersResult.rows.length}`
      });
    }
    
    const randomUsers = usersResult.rows;
    
    // Split users into two teams
    const teamAUsers = [{ id: captainId, username: 'Captain' }, ...randomUsers.slice(0, teamSize - 1)];
    const teamBUsers = randomUsers.slice(teamSize - 1, (teamSize * 2) - 1);
    
    // Get teams
    const teamsResult = await client.query(
      "SELECT * FROM tdm_teams WHERE match_id = $1 ORDER BY team_type",
      [match_id]
    );
    
    const teamA = teamsResult.rows.find(t => t.team_type === 'team_a');
    const teamB = teamsResult.rows.find(t => t.team_type === 'team_b');
    
    if (!teamA || !teamB) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Match teams not found"
      });
    }
    
    // Update team names
    await client.query(
      "UPDATE tdm_teams SET team_name = $1 WHERE id = $2",
      [`Team Alpha`, teamA.id]
    );
    
    await client.query(
      "UPDATE tdm_teams SET team_name = $1 WHERE id = $2",
      [`Team Beta`, teamB.id]
    );
    
    // Clear existing members
    await client.query(
      "DELETE FROM tdm_team_members WHERE team_id IN ($1, $2)",
      [teamA.id, teamB.id]
    );
    
    // Add Team A members
    for (let i = 0; i < teamAUsers.length; i++) {
      const user = teamAUsers[i];
      const isCaptain = i === 0; // First user is captain
      
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [teamA.id, user.id, isCaptain, match.entry_fee]
      );
    }
    
    // Add Team B members
    for (let i = 0; i < teamBUsers.length; i++) {
      const user = teamBUsers[i];
      const isCaptain = i === 0; // First user is captain
      
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [teamB.id, user.id, isCaptain, match.entry_fee]
      );
    }
    
    // Mark teams as ready and payment completed
    await client.query(
      "UPDATE tdm_teams SET is_ready = true, payment_completed = true WHERE match_id = $1",
      [match_id]
    );
    
    // Update match status to confirmed since both teams are ready
    await client.query(
      "UPDATE tdm_matches SET status = 'confirmed' WHERE id = $1",
      [match_id]
    );
    
    await client.query("COMMIT");
    
    res.status(200).json({
      success: true,
      message: `Successfully populated TDM match ${match_id} with ${teamSize}v${teamSize} teams`,
      data: {
        match_id: match_id,
        team_a: {
          name: "Team Alpha",
          members: teamAUsers.length,
          captain: teamAUsers[0].username
        },
        team_b: {
          name: "Team Beta", 
          members: teamBUsers.length,
          captain: teamBUsers[0].username
        },
        status: "confirmed"
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error populating TDM match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to populate TDM match",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test route to create a dummy TDM match
testTdmRouter.post("/create-dummy-match", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { 
      game_name = "Free Fire",
      entry_fee = 50,
      team_size = 4,
      match_type = "public"
    } = req.body;
    
    const prize_pool = entry_fee * team_size * 2; // Both teams entry fees
    
    await client.query("BEGIN");
    
    // Create the match
    const matchResult = await client.query(
      `INSERT INTO tdm_matches (match_type, status, game_name, entry_fee, prize_pool, created_by, team_size)
       VALUES ($1, 'waiting', $2, $3, $4, 1, $5)
       RETURNING *`,
      [match_type, game_name, entry_fee, prize_pool, team_size]
    );
    
    const match = matchResult.rows[0];
    
    // Create empty team slots
    await client.query(
      `INSERT INTO tdm_teams (match_id, team_type, team_name, is_ready, payment_completed)
       VALUES ($1, 'team_a', NULL, false, false)`,
      [match.id]
    );
    
    await client.query(
      `INSERT INTO tdm_teams (match_id, team_type, team_name, is_ready, payment_completed)
       VALUES ($1, 'team_b', NULL, false, false)`,
      [match.id]
    );
    
    await client.query("COMMIT");
    
    res.status(201).json({
      success: true,
      message: "Dummy TDM match created successfully",
      data: {
        match_id: match.id,
        game_name: match.game_name,
        entry_fee: match.entry_fee,
        prize_pool: match.prize_pool,
        team_size: match.team_size,
        status: match.status
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating dummy TDM match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create dummy TDM match",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test route to check match data and team details
testTdmRouter.get("/check-match/:match_id", async (req, res) => {
  try {
    const { match_id } = req.params;
    
    // Get match with teams and members
    const matchData = await pool.query(
      `SELECT m.*,
        (SELECT row_to_json(ta) FROM (
          SELECT t.*, 
            (SELECT json_agg(tm_data) FROM (
              SELECT tm.*, u.username, u.name, u.profile
              FROM tdm_team_members tm
              JOIN users u ON tm.user_id = u.id
              WHERE tm.team_id = t.id
            ) tm_data) as members
          FROM tdm_teams t
          WHERE t.match_id = m.id AND t.team_type = 'team_a'
        ) ta) as team_a,
        (SELECT row_to_json(tb) FROM (
          SELECT t.*, 
            (SELECT json_agg(tm_data) FROM (
              SELECT tm.*, u.username, u.name, u.profile
              FROM tdm_team_members tm
              JOIN users u ON tm.user_id = u.id
              WHERE tm.team_id = t.id
            ) tm_data) as members
          FROM tdm_teams t
          WHERE t.match_id = m.id AND t.team_type = 'team_b'
        ) tb) as team_b
       FROM tdm_matches m
       WHERE m.id = $1`,
      [match_id]
    );
    
    if (matchData.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchData.rows[0];
    
    // Calculate team stats
    const teamAMembers = match.team_a?.members?.length || 0;
    const teamBMembers = match.team_b?.members?.length || 0;
    const teamAPaid = match.team_a?.members?.filter(m => m.payment_status === 'completed').length || 0;
    const teamBPaid = match.team_b?.members?.filter(m => m.payment_status === 'completed').length || 0;
    
    res.status(200).json({
      success: true,
      message: "Match data retrieved",
      data: {
        match_details: match,
        team_stats: {
          team_a: {
            name: match.team_a?.team_name,
            members: teamAMembers,
            paid: teamAPaid,
            ready: match.team_a?.is_ready
          },
          team_b: {
            name: match.team_b?.team_name,
            members: teamBMembers,
            paid: teamBPaid,
            ready: match.team_b?.is_ready
          }
        },
        required_team_size: match.team_size || 4
      }
    });
    
  } catch (error) {
    console.error("Error checking match data:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// Test route to set room details for a match (bypasses creator check)
testTdmRouter.post("/set-room-details/:match_id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { match_id } = req.params;
    const { 
      room_id = `TDM_${match_id}_${Date.now().toString().slice(-6)}`,
      room_password = Math.random().toString(36).slice(-8).toUpperCase(),
      user_id = 20 // Default to user 20 as creator
    } = req.body;
    
    await client.query("BEGIN");
    
    // Check if match exists
    const matchCheck = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );
    
    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchCheck.rows[0];
    
    // Check if match is in "confirmed" status (should be after populate)
    if (match.status !== "confirmed") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Match must be in 'confirmed' status to set room details. Current status: ${match.status}`
      });
    }
    
    // Update match with room details
    await client.query(
      `UPDATE tdm_matches
       SET room_id = $1, room_password = $2
       WHERE id = $3`,
      [room_id, room_password, match_id]
    );
    
    await client.query("COMMIT");
    
    res.status(200).json({
      success: true,
      message: "Room details set successfully",
      data: {
        match_id: match_id,
        room_id: room_id,
        room_password: room_password,
        game_name: match.game_name,
        status: match.status,
        created_by: match.created_by
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting room details:", error);
    res.status(500).json({
      success: false,
      message: "Failed to set room details",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test route to start a match (bypasses captain check)
testTdmRouter.post("/start-match/:match_id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { match_id } = req.params;
    const { user_id = 20 } = req.body; // Default to user 20
    
    await client.query("BEGIN");
    
    // Check if match exists and has room details
    const matchCheck = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );
    
    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchCheck.rows[0];
    
    // Check if match is in "confirmed" status
    if (match.status !== "confirmed") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `Match must be in 'confirmed' status to start. Current status: ${match.status}`
      });
    }
    
    // Check if room details exist
    if (!match.room_id || !match.room_password) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Room details must be set before starting the match"
      });
    }
    
    // Update match status to in_progress
    await client.query(
      `UPDATE tdm_matches 
       SET status = 'in_progress', start_time = NOW() 
       WHERE id = $1`,
      [match_id]
    );
    
    await client.query("COMMIT");
    
    res.status(200).json({
      success: true,
      message: "Match started successfully",
      data: {
        match_id: match_id,
        status: "in_progress",
        room_id: match.room_id,
        room_password: match.room_password,
        game_name: match.game_name,
        start_time: new Date().toISOString()
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error starting match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to start match",
      error: error.message
    });
  } finally {
    client.release();
  }
});

export default testTdmRouter;
