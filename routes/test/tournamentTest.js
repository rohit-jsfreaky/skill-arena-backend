import express from "express";
import { pool } from "../../db/db.js";

const testTournamentRouter = express.Router();

// Helper function to generate random user data
const generateRandomUser = (index) => ({
  name: `TournamentPlayer${index}`,
  email: `tournamentplayer${index}@test.com`,
  referral_code: `TOURN${Date.now()}${index}`,
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

// Test Route 1: Populate existing tournament with random players
testTournamentRouter.post("/populate-tournament/:tournament_id", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const { tournament_id } = req.params;
    const captainUserId = 20; // Your user ID
    
    await client.query("BEGIN");
    
    // Check if tournament exists
    const tournamentResult = await client.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournament_id]
    );
    
    if (tournamentResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }
    
    const tournament = tournamentResult.rows[0];
    const maxParticipants = tournament.max_participants;
    const teamMode = tournament.team_mode;
    const entryFee = tournament.entry_fee_normal; // Using normal fee
    
    // Calculate team size based on team_mode
    let teamSize;
    switch (teamMode) {
      case 'solo': teamSize = 1; break;
      case 'duo': teamSize = 2; break;
      case '4v4': teamSize = 4; break;
      case '6v6': teamSize = 6; break;
      case '8v8': teamSize = 8; break;
      default: teamSize = 1;
    }
    
    // Calculate number of teams needed
    const numberOfTeams = Math.floor(maxParticipants / teamSize);
    const totalPlayersToCreate = numberOfTeams * teamSize;
    
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
    
    // Clear existing tournament participants
    await client.query(
      "DELETE FROM user_tournaments WHERE tournament_id = $1",
      [tournament_id]
    );
    
    await client.query(
      "DELETE FROM team_members WHERE team_id IN (SELECT id FROM teams WHERE tournament_id = $1)",
      [tournament_id]
    );
    
    await client.query(
      "DELETE FROM teams WHERE tournament_id = $1",
      [tournament_id]
    );
    
    // Get or create test users (excluding the captain)
    const testUsers = await getOrCreateTestUsers(client, totalPlayersToCreate - 1);
    
    // Add captain to user_tournaments first
    await client.query(
      `INSERT INTO user_tournaments (user_id, tournament_id, payment_amount) 
       VALUES ($1, $2, $3)`,
      [captainUserId, tournament_id, entryFee]
    );
    
    // Add all test users to user_tournaments
    for (const user of testUsers) {
      await client.query(
        `INSERT INTO user_tournaments (user_id, tournament_id, payment_amount) 
         VALUES ($1, $2, $3)`,
        [user.id, tournament_id, entryFee]
      );
    }
    
    // Create teams and assign players
    const createdTeams = [];
    let userIndex = 0;
    
    for (let teamNum = 1; teamNum <= numberOfTeams; teamNum++) {
      // Create team
      const teamResult = await client.query(
        `INSERT INTO teams (name, tournament_id) 
         VALUES ($1, $2) RETURNING *`,
        [`Test Team ${teamNum}`, tournament_id]
      );
      
      const team = teamResult.rows[0];
      createdTeams.push(team);
      
      // Add team members
      for (let memberIndex = 0; memberIndex < teamSize; memberIndex++) {
        let userId;
        let isCaptain = false;
        
        // First team gets the captain user as team captain
        if (teamNum === 1 && memberIndex === 0) {
          userId = captainUserId;
          isCaptain = true;
        } else {
          userId = testUsers[userIndex].id;
          userIndex++;
          isCaptain = memberIndex === 0; // First member of each team is captain
        }
        
        await client.query(
          `INSERT INTO team_members (team_id, user_id, is_captain) 
           VALUES ($1, $2, $3)`,
          [team.id, userId, isCaptain]
        );
      }
    }
    
    // Deduct entry fee from all players' wallets
    const allParticipants = await client.query(
      `SELECT user_id, payment_amount 
       FROM user_tournaments 
       WHERE tournament_id = $1`,
      [tournament_id]
    );
    
    for (const participant of allParticipants.rows) {
      await client.query(
        "UPDATE users SET wallet = wallet - $1 WHERE id = $2",
        [participant.payment_amount, participant.user_id]
      );
    }
    
    await client.query("COMMIT");
    
    return res.status(200).json({
      success: true,
      message: `Successfully populated tournament ${tournament_id} with ${totalPlayersToCreate} players in ${numberOfTeams} teams`,
      data: {
        tournament: tournament,
        teams_created: numberOfTeams,
        players_added: totalPlayersToCreate,
        team_size: teamSize,
        captain_user_id: captainUserId,
        teams: createdTeams
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error populating tournament:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to populate tournament",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test Route 2: Create a new tournament with random players
testTournamentRouter.post("/create-and-populate", async (req, res) => {
  const client = await pool.connect();
  
  try {
    const captainUserId = 20; // Your user ID
    const {
      name = 'Test Tournament',
      game_name = 'Test Game',
      team_mode = 'solo',
      max_participants = 20,
      entry_fee_normal = 100,
      prize_pool = 1800
    } = req.body;
    
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
    
    // Create new tournament
    const startTime = new Date();
    startTime.setHours(startTime.getHours() + 1); // Start 1 hour from now
    
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 2); // End 2 hours after start
    
    const tournamentResult = await client.query(
      `INSERT INTO tournaments (
        name, game_name, description, entry_fee_normal, entry_fee_pro, 
        prize_pool, team_mode, max_participants, start_time, end_time, 
        rules, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [
        name,
        game_name,
        'This is a test tournament created for testing purposes',
        entry_fee_normal,
        entry_fee_normal + 50, // Pro fee slightly higher
        prize_pool,
        team_mode,
        max_participants,
        startTime,
        endTime,
        'Standard tournament rules apply. No cheating allowed.',
        'upcoming'
      ]
    );
    
    const tournament = tournamentResult.rows[0];
    
    // Calculate team size based on team_mode
    let teamSize;
    switch (team_mode) {
      case 'solo': teamSize = 1; break;
      case 'duo': teamSize = 2; break;
      case '4v4': teamSize = 4; break;
      case '6v6': teamSize = 6; break;
      case '8v8': teamSize = 8; break;
      default: teamSize = 1;
    }
    
    // Calculate number of teams needed
    const numberOfTeams = Math.floor(max_participants / teamSize);
    const totalPlayersToCreate = numberOfTeams * teamSize;
    
    // Update captain's wallet if needed
    await client.query(
      "UPDATE users SET wallet = GREATEST(wallet, $1) WHERE id = $2",
      [1000.00, captainUserId]
    );
    
    // Get or create test users (excluding the captain)
    const testUsers = await getOrCreateTestUsers(client, totalPlayersToCreate - 1);
    
    // Add captain to user_tournaments first
    await client.query(
      `INSERT INTO user_tournaments (user_id, tournament_id, payment_amount) 
       VALUES ($1, $2, $3)`,
      [captainUserId, tournament.id, entry_fee_normal]
    );
    
    // Add all test users to user_tournaments
    for (const user of testUsers) {
      await client.query(
        `INSERT INTO user_tournaments (user_id, tournament_id, payment_amount) 
         VALUES ($1, $2, $3)`,
        [user.id, tournament.id, entry_fee_normal]
      );
    }
    
    // Create teams and assign players
    const createdTeams = [];
    let userIndex = 0;
    
    for (let teamNum = 1; teamNum <= numberOfTeams; teamNum++) {
      // Create team
      const teamResult = await client.query(
        `INSERT INTO teams (name, tournament_id) 
         VALUES ($1, $2) RETURNING *`,
        [`Test Team ${teamNum}`, tournament.id]
      );
      
      const team = teamResult.rows[0];
      createdTeams.push(team);
      
      // Add team members
      for (let memberIndex = 0; memberIndex < teamSize; memberIndex++) {
        let userId;
        let isCaptain = false;
        
        // First team gets the captain user as team captain
        if (teamNum === 1 && memberIndex === 0) {
          userId = captainUserId;
          isCaptain = true;
        } else {
          userId = testUsers[userIndex].id;
          userIndex++;
          isCaptain = memberIndex === 0; // First member of each team is captain
        }
        
        await client.query(
          `INSERT INTO team_members (team_id, user_id, is_captain) 
           VALUES ($1, $2, $3)`,
          [team.id, userId, isCaptain]
        );
      }
    }
    
    // Deduct entry fee from all players' wallets
    const allParticipants = await client.query(
      `SELECT user_id, payment_amount 
       FROM user_tournaments 
       WHERE tournament_id = $1`,
      [tournament.id]
    );
    
    for (const participant of allParticipants.rows) {
      await client.query(
        "UPDATE users SET wallet = wallet - $1 WHERE id = $2",
        [participant.payment_amount, participant.user_id]
      );
    }
    
    await client.query("COMMIT");
    
    return res.status(200).json({
      success: true,
      message: `Successfully created and populated tournament with ${totalPlayersToCreate} players in ${numberOfTeams} teams`,
      data: {
        tournament: tournament,
        teams_created: numberOfTeams,
        players_added: totalPlayersToCreate,
        team_size: teamSize,
        captain_user_id: captainUserId,
        teams: createdTeams
      }
    });
    
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating and populating tournament:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create and populate tournament",
      error: error.message
    });
  } finally {
    client.release();
  }
});

// Test Route 3: Get tournament details with team info
testTournamentRouter.get("/tournament-details/:tournament_id", async (req, res) => {
  try {
    const { tournament_id } = req.params;
    
    // Get tournament details
    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournament_id]
    );
    
    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Tournament not found"
      });
    }
    
    const tournament = tournamentResult.rows[0];
    
    // Get teams with members
    const teamsResult = await pool.query(
      `SELECT 
        t.*,
        json_agg(
          json_build_object(
            'user_id', tm.user_id,
            'user_name', u.name,
            'is_captain', tm.is_captain
          )
        ) as members
       FROM teams t
       LEFT JOIN team_members tm ON t.id = tm.team_id
       LEFT JOIN users u ON tm.user_id = u.id
       WHERE t.tournament_id = $1
       GROUP BY t.id, t.name, t.tournament_id, t.created_at
       ORDER BY t.id`,
      [tournament_id]
    );
    
    // Get user tournaments (payment info)
    const participantsResult = await pool.query(
      `SELECT ut.*, u.name, u.email, u.wallet 
       FROM user_tournaments ut
       JOIN users u ON ut.user_id = u.id
       WHERE ut.tournament_id = $1
       ORDER BY ut.joined_at`,
      [tournament_id]
    );
    
    return res.status(200).json({
      success: true,
      data: {
        tournament: tournament,
        teams: teamsResult.rows,
        participants: participantsResult.rows
      }
    });
    
  } catch (error) {
    console.error("Error getting tournament details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to get tournament details",
      error: error.message
    });
  }
});

// Test Route 4: Clear all test tournament data
testTournamentRouter.delete("/clear-test-data", async (req, res) => {
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
      message: `Deleted ${deleteResult.rows.length} test users and related data`,
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

export default testTournamentRouter;
