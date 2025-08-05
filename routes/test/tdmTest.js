import express from "express";
import { pool } from "../../db/db.js";

const testTdmRouter = express.Router();

// Helper function to generate random user data
const generateRandomUser = (index) => ({
  name: `TestPlayer${index}`,
  email: `testplayer${index}@test.com`,
  referral_code: `TEST${Date.now()}${index}`,
  wallet: 1000.00, // Give everyone enough wallet balance
});

// Helper function to get or create test users
const getOrCreateTestUsers = async (client, count) => {
  const users = [];
  
  for (let i = 1; i <= count; i++) {
    const userData = generateRandomUser(i);
    
    // Check if user exists
    const existingUser = await client.query(
      "SELECT * FROM users WHERE email = $1",
      [userData.email]
    );
    
    if (existingUser.rows.length > 0) {
      users.push(existingUser.rows[0]);
    } else {
      // Create new test user
      const newUser = await client.query(
        `INSERT INTO users (name, email, referral_code, wallet) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [userData.name, userData.email, userData.referral_code, userData.wallet]
      );
      users.push(newUser.rows[0]);
    }
  }
  
  return users;
};

// Test Route 1: Create a TDM match and populate with random players
testTdmRouter.post("/populate-match/:match_id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { match_id } = req.params;
    const captainUserId = 20; // Your user ID
    
    await client.query("BEGIN");
    
    // Check if match exists
    const matchResult = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );
    
    if (matchResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchResult.rows[0];
    const teamSize = match.team_size || 4;
    
    // Get or create test users (total needed: teamSize * 2)
    const totalUsersNeeded = teamSize * 2;
    const testUsers = await getOrCreateTestUsers(client, totalUsersNeeded);
    
    // Ensure captain user exists and has enough wallet balance
    const captainResult = await client.query(
      "SELECT * FROM users WHERE id = $1",
      [captainUserId]
    );
    
    if (captainResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Captain user not found"
      });
    }
    
    // Update captain's wallet if needed
    await client.query(
      "UPDATE users SET wallet = GREATEST(wallet, $1) WHERE id = $2",
      [1000.00, captainUserId]
    );
    
    // Get existing teams for this match
    const teamsResult = await client.query(
      "SELECT * FROM tdm_teams WHERE match_id = $1 ORDER BY team_type",
      [match_id]
    );
    
    let teamA, teamB;
    
    if (teamsResult.rows.length === 0) {
      // Create both teams
      const teamAResult = await client.query(
        `INSERT INTO tdm_teams (match_id, team_type, team_name) 
         VALUES ($1, 'team_a', 'Test Team A') RETURNING *`,
        [match_id]
      );
      teamA = teamAResult.rows[0];
      
      const teamBResult = await client.query(
        `INSERT INTO tdm_teams (match_id, team_type, team_name) 
         VALUES ($1, 'team_b', 'Test Team B') RETURNING *`,
        [match_id]
      );
      teamB = teamBResult.rows[0];
    } else {
      teamA = teamsResult.rows.find(t => t.team_type === 'team_a');
      teamB = teamsResult.rows.find(t => t.team_type === 'team_b');
    }
    
    // Clear existing team members
    await client.query(
      "DELETE FROM tdm_team_members WHERE team_id IN ($1, $2)",
      [teamA.id, teamB.id]
    );
    
    // Add captain to Team A
    await client.query(
      `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
       VALUES ($1, $2, true, $3, 'completed')`,
      [teamA.id, captainUserId, match.entry_fee]
    );
    
    // Add remaining players to Team A
    for (let i = 0; i < teamSize - 1; i++) {
      const user = testUsers[i];
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, false, $3, 'completed')`,
        [teamA.id, user.id, match.entry_fee]
      );
    }
    
    // Add players to Team B
    for (let i = teamSize; i < teamSize * 2; i++) {
      const user = testUsers[i - 1];
      const isCaptain = i === teamSize; // First player in Team B is captain
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [teamB.id, user.id, isCaptain, match.entry_fee]
      );
    }
    
    // Mark teams as payment completed
    await client.query(
      "UPDATE tdm_teams SET payment_completed = true WHERE id IN ($1, $2)",
      [teamA.id, teamB.id]
    );
    
    // Deduct entry fee from all players' wallets
    const allMembers = await client.query(
      `SELECT tm.user_id, tm.payment_amount 
       FROM tdm_team_members tm 
       WHERE tm.team_id IN ($1, $2)`,
      [teamA.id, teamB.id]
    );
    
    for (const member of allMembers.rows) {
      await client.query(
        "UPDATE users SET wallet = wallet - $1 WHERE id = $2",
        [member.payment_amount, member.user_id]
      );
    }
    
    await client.query("COMMIT");
    
    return res.status(200).json({
      success: true,
      message: `Successfully populated match ${match_id} with ${teamSize * 2} players`,
      data: {
        match_id: match.id,
        team_a: teamA,
        team_b: teamB,
        team_size: teamSize,
        captain_user_id: captainUserId
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error populating match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to populate match",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test Route 2: Create a new TDM match with random players
testTdmRouter.post("/create-and-populate", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const captainUserId = 20; // Your user ID
    const { team_size = 4, match_type = 'private', game_name = 'Test Game' } = req.body;
    
    await client.query("BEGIN");
    
    // Ensure captain user exists
    const captainResult = await client.query(
      "SELECT * FROM users WHERE id = $1",
      [captainUserId]
    );
    
    if (captainResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Captain user not found"
      });
    }
    
    // Create new TDM match
    const matchResult = await client.query(
      `INSERT INTO tdm_matches (match_type, status, game_name, entry_fee, prize_pool, created_by, team_size)
       VALUES ($1, 'waiting', $2, 100.00, 180.00, $3, $4) RETURNING *`,
      [match_type, game_name, captainUserId, team_size]
    );
    
    const match = matchResult.rows[0];
    
    // Now populate this match using the same logic
    const totalUsersNeeded = team_size * 2;
    const testUsers = await getOrCreateTestUsers(client, totalUsersNeeded);
    
    // Update captain's wallet if needed
    await client.query(
      "UPDATE users SET wallet = GREATEST(wallet, $1) WHERE id = $2",
      [1000.00, captainUserId]
    );
    
    // Create both teams
    const teamAResult = await client.query(
      `INSERT INTO tdm_teams (match_id, team_type, team_name) 
       VALUES ($1, 'team_a', 'Test Team A') RETURNING *`,
      [match.id]
    );
    const teamA = teamAResult.rows[0];
    
    const teamBResult = await client.query(
      `INSERT INTO tdm_teams (match_id, team_type, team_name) 
       VALUES ($1, 'team_b', 'Test Team B') RETURNING *`,
      [match.id]
    );
    const teamB = teamBResult.rows[0];
    
    // Add captain to Team A
    await client.query(
      `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
       VALUES ($1, $2, true, $3, 'completed')`,
      [teamA.id, captainUserId, match.entry_fee]
    );
    
    // Add remaining players to Team A
    for (let i = 0; i < team_size - 1; i++) {
      const user = testUsers[i];
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, false, $3, 'completed')`,
        [teamA.id, user.id, match.entry_fee]
      );
    }
    
    // Add players to Team B
    for (let i = team_size; i < team_size * 2; i++) {
      const user = testUsers[i - 1];
      const isCaptain = i === team_size; // First player in Team B is captain
      await client.query(
        `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
         VALUES ($1, $2, $3, $4, 'completed')`,
        [teamB.id, user.id, isCaptain, match.entry_fee]
      );
    }
    
    // Mark teams as payment completed
    await client.query(
      "UPDATE tdm_teams SET payment_completed = true WHERE id IN ($1, $2)",
      [teamA.id, teamB.id]
    );
    
    // Deduct entry fee from all players' wallets
    const allMembers = await client.query(
      `SELECT tm.user_id, tm.payment_amount 
       FROM tdm_team_members tm 
       WHERE tm.team_id IN ($1, $2)`,
      [teamA.id, teamB.id]
    );
    
    for (const member of allMembers.rows) {
      await client.query(
        "UPDATE users SET wallet = wallet - $1 WHERE id = $2",
        [member.payment_amount, member.user_id]
      );
    }
    
    await client.query("COMMIT");
    
    return res.status(200).json({
      success: true,
      message: `Successfully created and populated match with ${team_size * 2} players`,
      data: {
        match: match,
        team_a: teamA,
        team_b: teamB,
        captain_user_id: captainUserId
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating and populating match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create and populate match",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test Route 3: Get match details with team info
testTdmRouter.get("/match-details/:match_id", async (req, res) => {
  try {
    const { match_id } = req.params;
    
    // Get match details
    const matchResult = await pool.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );
    
    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    const match = matchResult.rows[0];
    
    // Get teams with members
    const teamsResult = await pool.query(
      `SELECT 
        t.*,
        json_agg(
          json_build_object(
            'user_id', tm.user_id,
            'user_name', u.name,
            'is_captain', tm.is_captain,
            'payment_status', tm.payment_status,
            'payment_amount', tm.payment_amount
          )
        ) as members
       FROM tdm_teams t
       LEFT JOIN tdm_team_members tm ON t.id = tm.team_id
       LEFT JOIN users u ON tm.user_id = u.id
       WHERE t.match_id = $1
       GROUP BY t.id, t.match_id, t.team_type, t.team_name, t.is_ready, t.payment_completed, t.created_at
       ORDER BY t.team_type`,
      [match_id]
    );
    
    return res.status(200).json({
      success: true,
      data: {
        match: match,
        teams: teamsResult.rows
      }
    });
    
  } catch (error) {
    console.error("Error getting match details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get match details",
      error: error.message
    });
  }
});

// Test Route 4: Clear all test users and data
testTdmRouter.delete("/clear-test-data", async (req, res) => {
  const client = await pool.connect();
  
  try {
    await client.query("BEGIN");
    
    // Delete test users (those with email containing 'test')
    const deleteResult = await client.query(
      "DELETE FROM users WHERE email LIKE '%@test.com' RETURNING id, name, email"
    );
    
    await client.query("COMMIT");
    
    return res.status(200).json({
      success: true,
      message: `Deleted ${deleteResult.rows.length} test users`,
      deleted_users: deleteResult.rows
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error clearing test data:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to clear test data",
      error: error.message
    });
  } finally {
    client.release();
  }
});

export default testTdmRouter;
