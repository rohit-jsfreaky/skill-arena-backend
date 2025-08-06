import { pool } from "../../db/db.js";
import { sendUserNotification } from "../../utils/sendNotifications.js";
import {
  determineWinLossStatus,
  processScreenshotWithOCR,
} from "../tournamentResults.js";

// Create a new TDM Match (Option 2: Host a Private Match)
export const createTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;

    if (!userId)
      return res.status(404).json({ message: "User not authenticated" });

    const { creatorId } = req.body;

    // Get match details from request
    const {
      match_type, // public or private
      game_name,
      entry_fee,
      team_name,
      team_members, // Array of user IDs including the team captain
      team_size = 4, // Default to 4 if not provided
    } = req.body;

    // Validate team size
    if (![4, 6, 8].includes(team_size)) {
      return res.status(400).json({
        success: false,
        message: "Team size must be 4, 6, or 8",
      });
    }

    if (
      !match_type ||
      !game_name ||
      !entry_fee ||
      !team_name ||
      !team_members ||
      team_members.length < 1 || // Changed from 4 to 1 to require at least creator
      team_members.length > team_size // Use team_size instead of hardcoded 4
    ) {
      return res.status(400).json({
        success: false,
        message: `Missing required fields or invalid team size. Team must have between 1-${team_size} players.`,
      });
    }

    await client.query("BEGIN");

    const marginQuery = await pool.query(
      `SELECT margin FROM prize_margin ORDER BY created_at DESC LIMIT 1`
    );

    const marginResult = marginQuery.rows[0].margin;

    // Calculate prize pool based on team size
    const totalEntryFees = entry_fee * team_size * 2; // Both teams
    const platformFee = totalEntryFees * (marginResult / 100);
    const prize_pool = Math.round(totalEntryFees - platformFee);

    // Create the match with team_size using timezone-aware timestamp
    const matchResult = await client.query(
      `
      INSERT INTO tdm_matches 
      (match_type, status, game_name, entry_fee, prize_pool, created_by, team_size, created_at)
      VALUES ($1, 'waiting', $2, $3, $4, $5, $6, NOW() AT TIME ZONE 'Asia/Kolkata')
      RETURNING *
    `,
      [match_type, game_name, entry_fee, prize_pool, creatorId, team_size]
    );

    const match = matchResult.rows[0];

    // Create Team A
    const teamAResult = await client.query(
      `
      INSERT INTO tdm_teams
      (match_id, team_type, team_name, is_ready, payment_completed)
      VALUES ($1, 'team_a', $2, false, false)
      RETURNING *
    `,
      [match.id, team_name]
    );

    const teamA = teamAResult.rows[0];

    // Add team members to Team A with the first one as captain
    for (let i = 0; i < team_members.length; i++) {
      const userId = team_members[i];
      const isCaptain = userId === creatorId || i === 0;

      // Check if user exists
      const userExistsResult = await client.query(
        "SELECT * FROM users WHERE id = $1",
        [userId]
      );

      if (userExistsResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: `User with ID ${userId} not found`,
        });
      }

      // Add team member
      await client.query(
        `
        INSERT INTO tdm_team_members
        (team_id, user_id, is_captain, payment_amount, payment_status)
        VALUES ($1, $2, $3, $4, 'pending')
      `,
        [teamA.id, userId, isCaptain, entry_fee]
      );
    }

    // Create an empty Team B slot
    await client.query(
      `
      INSERT INTO tdm_teams
      (match_id, team_type, team_name, is_ready, payment_completed)
      VALUES ($1, 'team_b', NULL, false, false)
    `,
      [match.id]
    );

    await client.query("COMMIT");

    return res.status(201).json({
      success: true,
      message: "TDM match created successfully",
      data: {
        match_id: match.id,
        match_type: match.match_type,
        entry_fee: match.entry_fee,
        prize_pool: match.prize_pool,
        team_a: teamA,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating TDM match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create TDM match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Join a public TDM match as Team B (Option 1)
// Join a public TDM match (can join as Team A or Team B)
export const joinPublicTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    if (!userId)
      return res.status(404).json({ message: "User not authenticated" });
    const { match_id, team_name, team_members, captainId, preferred_team } = req.body;

    if (
      !match_id ||
      !team_name ||
      !team_members ||
      team_members.length < 1 ||
      team_members.length > 4 ||
      !captainId
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields or invalid team size. Team must have between 1-4 players.",
      });
    }

    await client.query("BEGIN");

    // Check if match exists and is public and waiting
    const matchResult = await client.query(
      `SELECT * FROM tdm_matches WHERE id = $1 AND match_type = 'public' AND status = 'waiting'`,
      [match_id]
    );

    if (matchResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "TDM match not found or not available for joining",
      });
    }

    const match = matchResult.rows[0];

    // Get both teams to see which slots are available
    const teamsResult = await client.query(
      `SELECT * FROM tdm_teams WHERE match_id = $1 ORDER BY team_type`,
      [match_id]
    );

    const teams = teamsResult.rows;
    const teamA = teams.find(t => t.team_type === 'team_a');
    const teamB = teams.find(t => t.team_type === 'team_b');

    // Determine which team to join
    let targetTeam = null;
    let teamType = null;

    if (preferred_team === 'team_a' && teamA && !teamA.team_name) {
      targetTeam = teamA;
      teamType = 'team_a';
    } else if (preferred_team === 'team_b' && teamB && !teamB.team_name) {
      targetTeam = teamB;
      teamType = 'team_b';
    } else {
      // Auto-assign to first available team
      if (teamA && !teamA.team_name) {
        targetTeam = teamA;
        teamType = 'team_a';
      } else if (teamB && !teamB.team_name) {
        targetTeam = teamB;
        teamType = 'team_b';
      }
    }

    if (!targetTeam) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "No available team slots in this match",
      });
    }

    // Update the team with the new team name
    const updatedTeamResult = await client.query(
      `UPDATE tdm_teams SET team_name = $1 WHERE id = $2 RETURNING *`,
      [team_name, targetTeam.id]
    );

    const updatedTeam = updatedTeamResult.rows[0];

    // Add team members
    for (let i = 0; i < team_members.length; i++) {
      const memberId = team_members[i];
      const isCaptain = memberId === captainId || i === 0;

      // Check if user exists
      const userExistsResult = await client.query(
        "SELECT * FROM users WHERE id = $1",
        [memberId]
      );

      if (userExistsResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: `User with ID ${memberId} not found`,
        });
      }

      // Add team member
      await client.query(
        `INSERT INTO tdm_team_members
        (team_id, user_id, is_captain, payment_amount, payment_status)
        VALUES ($1, $2, $3, $4, 'pending')`,
        [targetTeam.id, memberId, isCaptain, match.entry_fee]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Successfully joined as ${teamType.replace('_', ' ').toUpperCase()}`,
      data: {
        match_id: match.id,
        team: updatedTeam,
        team_type: teamType,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error joining public TDM match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to join TDM match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Join a private TDM match with match ID (Option 2 - for opponent team)
export const joinPrivateTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    if (!userId)
      return res.status(404).json({ message: "User not authenticated" });
    const { match_id, team_name, team_members, captainId } = req.body;

    if (!match_id || !team_name || !team_members || team_members.length !== 4) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields or invalid team size. Team must have exactly 4 players.",
      });
    }

    // Validate match_id format (should be a valid number)
    if (isNaN(match_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID format",
      });
    }

    await client.query("BEGIN");

    // First, check if match exists at all
    const matchExistsResult = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );

    if (matchExistsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "This match does not exist",
      });
    }

    const match = matchExistsResult.rows[0];

    // Check if match is private
    if (match.match_type !== 'private') {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "This match is not a private match",
      });
    }

    // Check if match is available for joining
    if (match.status !== 'waiting') {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `This match is not available for joining. Current status: ${match.status}`,
      });
    }

    // Check if Team B slot is empty
    const teamBResult = await client.query(
      `
      SELECT * FROM tdm_teams WHERE match_id = $1 AND team_type = 'team_b'
    `,
      [match_id]
    );

    if (
      teamBResult.rows.length === 0 ||
      teamBResult.rows[0].team_name !== null
    ) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Team B is already taken for this match",
      });
    }

    // Update Team B with the new team name
    const updatedTeamBResult = await client.query(
      `
      UPDATE tdm_teams
      SET team_name = $1
      WHERE match_id = $2 AND team_type = 'team_b'
      RETURNING *
    `,
      [team_name, match_id]
    );

    const teamB = updatedTeamBResult.rows[0];

    // Add team members to Team B with the requester as captain
    for (let i = 0; i < team_members.length; i++) {
      const userId = team_members[i];
      const isCaptain = userId === captainId || i === 0;

      // Check if user exists
      const userExistsResult = await client.query(
        "SELECT * FROM users WHERE id = $1",
        [userId]
      );

      if (userExistsResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: `User with ID ${userId} not found`,
        });
      }

      // Add team member
      await client.query(
        `
        INSERT INTO tdm_team_members
        (team_id, user_id, is_captain, payment_amount, payment_status)
        VALUES ($1, $2, $3, $4, 'pending')
      `,
        [teamB.id, userId, isCaptain, match.entry_fee]
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Successfully joined private TDM match as Team B",
      data: {
        match_id: match.id,
        entry_fee: match.entry_fee,
        prize_pool: match.prize_pool,
        team_b: teamB,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error joining private TDM match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to join private TDM match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Join a private TDM match using shareable link
export const joinPrivateMatchByLink = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    if (!userId) {
      return res.status(401).json({ 
        success: false, 
        message: "User not authenticated" 
      });
    }

    const { match_id } = req.params;
    const { team_name, team_members, captainId } = req.body;

    // Validate match_id format (should be a valid number)
    if (!match_id || isNaN(match_id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid match ID format",
      });
    }

    await client.query("BEGIN");

    // First, check if match exists at all
    const matchExistsResult = await client.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );

    if (matchExistsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "This match does not exist",
      });
    }

    const match = matchExistsResult.rows[0];

    // Check if match is private and validate access
    if (match.match_type !== 'private') {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "This match is not a private match",
      });
    }

    // Check if match is available for joining
    if (match.status !== 'waiting') {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: `This match is not available for joining. Current status: ${match.status}`,
      });
    }

    // Get available teams
    const teamsResult = await client.query(
      `SELECT t.*, COUNT(tm.id) as member_count 
       FROM tdm_teams t 
       LEFT JOIN tdm_team_members tm ON t.id = tm.team_id 
       WHERE t.match_id = $1 
       GROUP BY t.id, t.team_type
       ORDER BY t.team_type`,
      [match_id]
    );

    const teams = teamsResult.rows;
    let targetTeam = null;

    // Find first available team slot (no team name or no members)
    for (const team of teams) {
      if (!team.team_name || team.member_count === 0) {
        targetTeam = team;
        break;
      }
    }

    if (!targetTeam) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "No available team slots in this match",
      });
    }

    // Update team with team name if not set
    if (!targetTeam.team_name && team_name) {
      await client.query(
        `UPDATE tdm_teams SET team_name = $1 WHERE id = $2`,
        [team_name, targetTeam.id]
      );
    }

    // Add team members if provided
    if (team_members && team_members.length > 0) {
      for (let i = 0; i < team_members.length; i++) {
        const memberId = team_members[i];
        const isCaptain = memberId === captainId || i === 0;

        // Check if user exists
        const userExistsResult = await client.query(
          "SELECT * FROM users WHERE id = $1",
          [memberId]
        );

        if (userExistsResult.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(404).json({
            success: false,
            message: `User with ID ${memberId} not found`,
          });
        }

        // Check if user is already in this match
        const existingMemberResult = await client.query(
          `SELECT tm.* FROM tdm_team_members tm 
           JOIN tdm_teams t ON tm.team_id = t.id 
           WHERE t.match_id = $1 AND tm.user_id = $2`,
          [match_id, memberId]
        );

        if (existingMemberResult.rows.length > 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({
            success: false,
            message: `User ${memberId} is already in this match`,
          });
        }

        // Add team member
        await client.query(
          `INSERT INTO tdm_team_members (team_id, user_id, is_captain, payment_amount, payment_status)
           VALUES ($1, $2, $3, $4, 'pending')`,
          [targetTeam.id, memberId, isCaptain, match.entry_fee]
        );
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Successfully joined the match as ${targetTeam.team_type.replace('_', ' ').toUpperCase()}`,
      data: {
        match_id: match.id,
        team: targetTeam,
        team_type: targetTeam.team_type,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error joining private match by link:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to join match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Get all available public TDM matches
export const getPublicTdmMatches = async (req, res) => {
  try {
    const { userId } = req.auth; // Clerk user ID for auth only
    const { user_id } = req.query; // Database user ID from frontend

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    if (!user_id) {
      return res.status(400).json({
        success: false,
        message: "Database user ID is required.",
      });
    }

    // Get all public matches that are waiting for teams to join
    // Admin creates matches without any teams initially
    // Exclude matches where the user has already joined
    const result = await pool.query(`
      SELECT m.*, 
        ta.id as team_a_id, 
        ta.team_name as team_a_name,
        ta.is_ready as team_a_ready,
        tb.id as team_b_id,
        tb.team_name as team_b_name,
        tb.is_ready as team_b_ready,
        (SELECT COUNT(*) FROM tdm_team_members WHERE team_id = ta.id) as team_a_members,
        (SELECT COUNT(*) FROM tdm_team_members WHERE team_id = tb.id) as team_b_members
      FROM tdm_matches m
      LEFT JOIN tdm_teams ta ON m.id = ta.match_id AND ta.team_type = 'team_a'
      LEFT JOIN tdm_teams tb ON m.id = tb.match_id AND tb.team_type = 'team_b'
      WHERE m.match_type = 'public' 
      AND m.status = 'waiting'
      AND (ta.team_name IS NULL OR tb.team_name IS NULL)
      AND m.id NOT IN (
        SELECT DISTINCT t.match_id 
        FROM tdm_teams t 
        JOIN tdm_team_members tm ON t.id = tm.team_id 
        WHERE tm.user_id = $1
      )
      ORDER BY m.created_at DESC
    `, [user_id]);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching public TDM matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch public TDM matches",
      error: error.message,
    });
  }
};

// Get TDM match details by ID
export const getTdmMatchById = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { match_id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    // Get match details with teams
    const matchResult = await pool.query(
      `
      SELECT m.*,
        (SELECT row_to_json(ta) FROM (
          SELECT t.*, 
            (SELECT json_agg(tm) FROM (
              SELECT tm.*, u.username, u.name, u.profile
              FROM tdm_team_members tm
              JOIN users u ON tm.user_id = u.id
              WHERE tm.team_id = t.id
            ) tm) as members,
            (SELECT row_to_json(ss) FROM (
              SELECT s.* FROM tdm_match_screenshots s
              WHERE s.team_id = t.id 
              ORDER BY s.upload_timestamp DESC 
              LIMIT 1
            ) ss) as screenshot
          FROM tdm_teams t
          WHERE t.match_id = m.id AND t.team_type = 'team_a'
        ) ta) as team_a,
        (SELECT row_to_json(tb) FROM (
          SELECT t.*, 
            (SELECT json_agg(tm) FROM (
              SELECT tm.*, u.username, u.name, u.profile
              FROM tdm_team_members tm
              JOIN users u ON tm.user_id = u.id
              WHERE tm.team_id = t.id
            ) tm) as members,
            (SELECT row_to_json(ss) FROM (
              SELECT s.* FROM tdm_match_screenshots s
              WHERE s.team_id = t.id 
              ORDER BY s.upload_timestamp DESC 
              LIMIT 1
            ) ss) as screenshot
          FROM tdm_teams t
          WHERE t.match_id = m.id AND t.team_type = 'team_b'
        ) tb) as team_b
      FROM tdm_matches m
      WHERE m.id = $1
    `,
      [match_id]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: matchResult.rows[0],
    });
  } catch (error) {
    console.error("Error fetching TDM match details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM match details",
      error: error.message,
    });
  }
};

// Process team payment
export const processTdmTeamPayment = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;

    const { match_id, team_id } = req.params;

    const { user_id } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    await client.query("BEGIN");

    // Check if the user is a member of the team (instead of captain check)
    const memberCheck = await client.query(
      `
      SELECT * FROM tdm_team_members
      WHERE team_id = $1 AND user_id = $2
    `,
      [team_id, user_id]
    );

    if (memberCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "You are not a member of this team",
      });
    }

    // Get match and team details
    const matchResult = await client.query(
      `
      SELECT m.*, t.team_type
      FROM tdm_matches m
      JOIN tdm_teams t ON m.id = t.match_id
      WHERE m.id = $1 AND t.id = $2
    `,
      [match_id, team_id]
    );

    if (matchResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match or team not found",
      });
    }

    const match = matchResult.rows[0];
    const teamType = match.team_type;

    // Check if user has already paid
    const memberPaymentCheck = await client.query(
      `
      SELECT * FROM tdm_team_members
      WHERE team_id = $1 AND user_id = $2 AND payment_status = 'completed'
    `,
      [team_id, user_id]
    );

    if (memberPaymentCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "You have already paid for this match",
      });
    }

    // Get user details
    const userResult = await client.query(
      `
      SELECT * FROM users WHERE id = $1
    `,
      [user_id]
    );

    if (userResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const user = userResult.rows[0];

    console.log(user);
    console.log(user.wallet);

    console.log(match.entry_fee);

    console.log(user.wallet < match.entry_fee);

    // Check if user has enough funds
    if (parseFloat(user.wallet) < parseFloat(match.entry_fee)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "You don't have enough funds to pay the entry fee",
      });
    }

    // Deduct entry fee from user wallet
    await client.query(
      `
      UPDATE users
      SET wallet = wallet - $1, total_games_played = total_games_played + 1
      WHERE id = $2
    `,
      [match.entry_fee, user_id]
    );

    // Update payment status for the team member
    await client.query(
      `
      UPDATE tdm_team_members
      SET payment_status = 'completed'
      WHERE team_id = $1 AND user_id = $2
    `,
      [team_id, user_id]
    );

    // Check if all team members have paid
    const teamPaymentCheck = await client.query(
      `
      SELECT COUNT(*) as total, SUM(CASE WHEN payment_status = 'completed' THEN 1 ELSE 0 END) as paid
      FROM tdm_team_members
      WHERE team_id = $1
    `,
      [team_id]
    );

    const { total, paid } = teamPaymentCheck.rows[0];

    // If all present members have paid, mark the team as ready
    if (parseInt(paid) === parseInt(total)) {
      // Mark the team as payment completed
      await client.query(
        `
        UPDATE tdm_teams
        SET payment_completed = true, is_ready = true
        WHERE id = $1
      `,
        [team_id]
      );

      // Update match status based on which team completed payment
      let newStatus;
      if (teamType === "team_a") {
        newStatus = "team_a_ready";
      } else {
        newStatus = "team_b_ready";
      }

      // NEW: Check for total number of players in the match
      const totalPlayersCheck = await client.query(
        `
        SELECT 
          COUNT(*) as total_players,
          SUM(CASE WHEN tm.payment_status = 'completed' THEN 1 ELSE 0 END) as total_paid
        FROM tdm_team_members tm
        JOIN tdm_teams t ON tm.team_id = t.id
        WHERE t.match_id = $1
      `,
        [match_id]
      );

      const { total_players, total_paid } = totalPlayersCheck.rows[0];

      // Check if both teams are ready
      const teamsReadyCheck = await client.query(
        `
        SELECT COUNT(*) as ready_teams
        FROM tdm_teams
        WHERE match_id = $1 AND is_ready = true
      `,
        [match_id]
      );

      // Changed condition: Only confirm match if ALL players have paid AND we have the correct total player count
      if (
        parseInt(teamsReadyCheck.rows[0].ready_teams) === 2 &&
        parseInt(total_paid) === match.team_size * 2 && // Dynamic based on team_size
        parseInt(total_players) === match.team_size * 2 // Dynamic based on team_size
      ) {
        newStatus = "confirmed";

        // Just update match status to confirmed without room details
        await client.query(
          `
          UPDATE tdm_matches
          SET status = $1
          WHERE id = $2
        `,
          [newStatus, match_id]
        );
      } else {
        // Otherwise just update the status to indicate which team is ready
        await client.query(
          `
          UPDATE tdm_matches
          SET status = $1
          WHERE id = $2
        `,
          [newStatus, match_id]
        );
      }
    }

    await client.query("COMMIT");

    // Get updated match
    const updatedMatchResult = await client.query(
      `
      SELECT * FROM tdm_matches WHERE id = $1
    `,
      [match_id]
    );

    return res.status(200).json({
      success: true,
      message: "Payment processed successfully",
      data: updatedMatchResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error processing payment:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to process payment",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Upload match screenshot for result verification
export const uploadTdmMatchScreenshot = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { match_id } = req.params;
    const { screenshot_path, team_id, user_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    if (!user_id || !match_id || !screenshot_path || !team_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      });
    }

    // Check if user is a captain of the team
    const captainCheck = await pool.query(
      `
      SELECT * FROM tdm_team_members
      WHERE team_id = $1 AND user_id = $2 AND is_captain = true
    `,
      [team_id, user_id]
    );

    if (captainCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Only team captains can upload match screenshots",
      });
    }

    // Check if match is in progress
    const matchCheck = await pool.query(
      `
      SELECT * FROM tdm_matches
      WHERE id = $1 AND status = 'in_progress'
    `,
      [match_id]
    );

    if (matchCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Match is not in progress",
      });
    }

    const ocrResult = await processScreenshotWithOCR(screenshot_path);
    const verificationStatus = determineWinLossStatus(ocrResult);

    // Check if a screenshot already exists for this team
    const existingScreenshot = await pool.query(
      `
      SELECT * FROM tdm_match_screenshots
      WHERE match_id = $1 AND team_id = $2
    `,
      [match_id, team_id]
    );

    // If a screenshot exists, update it
    if (existingScreenshot.rows.length > 0) {
      await pool.query(
        `
        UPDATE tdm_match_screenshots 
        SET screenshot_path = $1, upload_timestamp = CURRENT_TIMESTAMP, verification_status = $2, ocr_result = $3
        WHERE match_id = $4 AND team_id = $5
        `,
        [screenshot_path, verificationStatus, ocrResult, match_id, team_id]
      );
    } else {
      // Insert screenshot
      await pool.query(
        `
        INSERT INTO tdm_match_screenshots
        (match_id, team_id, user_id, screenshot_path, upload_timestamp, verification_status, ocr_result)
        VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, $5, $6)
        `,
        [
          match_id,
          team_id,
          user_id,
          screenshot_path,
          verificationStatus,
          ocrResult,
        ]
      );
    }

    // Check if we can automatically determine a winner
    const processResult = await checkAndProcessTdmMatchResults(match_id);

    return res.status(200).json({
      success: true,
      message: processResult
        ? "Screenshot uploaded and match results processed successfully"
        : "Screenshot uploaded successfully",
      data: {
        screenshot_path,
        verification_status: verificationStatus,
        auto_processed: processResult,
      },
    });
  } catch (error) {
    console.log("Error uploading match screenshot:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to upload screenshot",
      error: error.message,
    });
  }
};
// Complete the checkAndProcessTournamentResults function
// Complete the checkAndProcessTournamentResults function
// Complete the checkAndProcessTournamentResults function
const checkAndProcessTdmMatchResults = async (match_id) => {
  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Check if match is in progress
      const matchCheck = await client.query(
        `SELECT * FROM tdm_matches WHERE id = $1 AND status = 'in_progress'`,
        [match_id]
      );

      if (matchCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return false; // Match not in progress
      }

      const match = matchCheck.rows[0];

      // Get both teams
      const teamsResult = await client.query(
        `SELECT * FROM tdm_teams WHERE match_id = $1`,
        [match_id]
      );

      if (teamsResult.rows.length !== 2) {
        await client.query("ROLLBACK");
        return false; // Not enough teams
      }

      const teams = teamsResult.rows;

      // Get screenshots for both teams
      const screenshotsResult = await client.query(
        `SELECT ts.*, t.team_type, t.id as team_id
         FROM tdm_match_screenshots ts
         JOIN tdm_teams t ON ts.team_id = t.id
         WHERE t.match_id = $1`,
        [match_id]
      );

      // If we don't have screenshots from both teams yet, we can't verify
      if (screenshotsResult.rows.length < 2) {
        await client.query("ROLLBACK");
        console.log("returning because not 2 screenshots");
        return false;
      }

      // Group screenshots by team
      const screenshotsByTeam = {};
      screenshotsResult.rows.forEach((screenshot) => {
        if (!screenshotsByTeam[screenshot.team_id]) {
          screenshotsByTeam[screenshot.team_id] = [];
        }
        screenshotsByTeam[screenshot.team_id].push(screenshot);
      });

      // Look for verified wins and losses
      const winningTeamScreenshots = screenshotsResult.rows.filter(
        (screenshot) => screenshot.verification_status === "verified_win"
      );

      const losingTeamScreenshots = screenshotsResult.rows.filter(
        (screenshot) => screenshot.verification_status === "verified_loss"
      );

      console.log("Winning team screenshots:", winningTeamScreenshots);
      console.log("Losing team screenshots:", losingTeamScreenshots);

      // Case 1: If one team has verified win and other team has verified loss
      if (
        winningTeamScreenshots.length === 1 &&
        losingTeamScreenshots.length === 1
      ) {
        const winnerTeam = teams.find(
          (team) => team.id === winningTeamScreenshots[0].team_id
        );
        const loserTeam = teams.find(
          (team) => team.id === losingTeamScreenshots[0].team_id
        );

        // Make sure we have one from each team
        if (winnerTeam && loserTeam && winnerTeam.id !== loserTeam.id) {
          const winnerTeamId = winnerTeam.id;

          // Get winner team members
          const winnerTeamMembersResult = await client.query(
            `SELECT tm.*, u.username
             FROM tdm_team_members tm
             JOIN users u ON tm.user_id = u.id
             WHERE tm.team_id = $1`,
            [winnerTeamId]
          );

          const winnerTeamMembers = winnerTeamMembersResult.rows;
          const prizePerMember = match.prize_pool / winnerTeamMembers.length;

          // Update match status to completed and set winner team with IST timestamp
          await client.query(
            `UPDATE tdm_matches
             SET status = 'completed', winner_team_id = $1, end_time = NOW() AT TIME ZONE 'Asia/Kolkata'
             WHERE id = $2`,
            [winnerTeamId, match_id]
          );

          // Create match result record
          await client.query(
            `INSERT INTO tdm_match_results
             (match_id, winner_team_id, prize_awarded, prize_amount, resolution_method, resolved_at)
             VALUES ($1, $2, true, $3, 'automatic', NOW())`,
            [match_id, winnerTeamId, match.prize_pool]
          );

          // Award prize to each winner team member
          for (const member of winnerTeamMembers) {
            await client.query(
              `UPDATE users
               SET wallet = wallet + $1, total_wins = total_wins + 1
               WHERE id = $2`,
              [prizePerMember, member.user_id]
            );
          }

          // After awarding prizes, notify all participants
          // Get match details for notification
          const matchDetailsResult = await client.query(
            `SELECT m.game_name, t.team_name 
             FROM tdm_matches m
             JOIN tdm_teams t ON t.id = $1
             WHERE m.id = $2`,
            [winnerTeamId, match_id]
          );

          const matchDetails = matchDetailsResult.rows[0];

          // Get all participants from both teams
          const allParticipantsResult = await client.query(
            `SELECT tm.user_id 
             FROM tdm_team_members tm
             JOIN tdm_teams t ON tm.team_id = t.id
             WHERE t.match_id = $1`,
            [match_id]
          );

          const notificationTitle = `Match Results: ${matchDetails.game_name}`;
          const notificationBody = `Team "${matchDetails.team_name}" has won the match and received ₹${match.prize_pool} prize money!`;

          // Send notifications to all participants
          for (const participant of allParticipantsResult.rows) {
            await sendUserNotification(
              participant.user_id,
              notificationTitle,
              notificationBody,
              null,
              {
                type: "tdm_match_completed",
                match_id: match_id.toString(),
                route: "tdm/match/" + match_id,
                winner_team_id: winnerTeamId.toString(),
              }
            );
          }

          await client.query("COMMIT");
          return true;
        }
      }

      // Case 2: If there is exactly one team with a verified win and no conflicting wins
      else if (
        winningTeamScreenshots.length === 1 &&
        losingTeamScreenshots.length === 0
      ) {
        // Check if screenshots from other team are pending or failed
        const winnerTeamId = winningTeamScreenshots[0].team_id;
        const otherTeamId = teams.find((team) => team.id !== winnerTeamId)?.id;

        if (!otherTeamId) {
          await client.query("ROLLBACK");
          return false;
        }

        const otherTeamScreenshots = screenshotsByTeam[otherTeamId] || [];

        // If other team has no screenshots or screenshots are pending, don't decide yet
        if (
          otherTeamScreenshots.length === 0 ||
          otherTeamScreenshots.every(
            (ss) => ss.verification_status === "pending"
          )
        ) {
          await client.query("ROLLBACK");
          return false;
        }

        // Get winner team members
        const winnerTeamMembersResult = await client.query(
          `SELECT tm.*, u.username
           FROM tdm_team_members tm
           JOIN users u ON tm.user_id = u.id
           WHERE tm.team_id = $1`,
          [winnerTeamId]
        );

        const winnerTeamMembers = winnerTeamMembersResult.rows;
        const prizePerMember = match.prize_pool / winnerTeamMembers.length;

        // Update match status to completed and set winner team with IST timestamp
        await client.query(
          `UPDATE tdm_matches
           SET status = 'completed', winner_team_id = $1, end_time = NOW() AT TIME ZONE 'Asia/Kolkata'
           WHERE id = $2`,
          [winnerTeamId, match_id]
        );

        // Create match result record
        await client.query(
          `INSERT INTO tdm_match_results
           (match_id, winner_team_id, prize_awarded, prize_amount, resolution_method, resolved_at)
           VALUES ($1, $2, true, $3, 'automatic', NOW())`,
          [match_id, winnerTeamId, match.prize_pool]
        );

        // Award prize to each winner team member
        for (const member of winnerTeamMembers) {
          await client.query(
            `UPDATE users
             SET wallet = wallet + $1, total_wins = total_wins + 1
             WHERE id = $2`,
            [prizePerMember, member.user_id]
          );
        }

        // After awarding prizes, notify all participants
        // Get match details for notification
        const matchDetailsResult = await client.query(
          `SELECT m.game_name, t.team_name 
           FROM tdm_matches m
           JOIN tdm_teams t ON t.id = $1
           WHERE m.id = $2`,
          [winnerTeamId, match_id]
        );

        const matchDetails = matchDetailsResult.rows[0];

        // Get all participants from both teams
        const allParticipantsResult = await client.query(
          `SELECT tm.user_id 
           FROM tdm_team_members tm
           JOIN tdm_teams t ON tm.team_id = t.id
           WHERE t.match_id = $1`,
          [match_id]
        );

        const notificationTitle = `Match Results: ${matchDetails.game_name}`;
        const notificationBody = `Team "${matchDetails.team_name}" has won the match and received ₹${match.prize_pool} prize money!`;

        // Send notifications to all participants
        for (const participant of allParticipantsResult.rows) {
          await sendUserNotification(
            participant.user_id,
            notificationTitle,
            notificationBody,
            null,
            {
              type: "tdm_match_completed",
              match_id: match_id.toString(),
              route: "tdm/match/" + match_id,
              winner_team_id: winnerTeamId.toString(),
            }
          );
        }

        await client.query("COMMIT");
        return true;
      }

      // Case 3: If multiple teams claim victory, create dispute but keep status as 'in_progress'
      else if (winningTeamScreenshots.length > 1) {
        // Don't change the match status - leave it as 'in_progress'
        // Instead, just mark screenshots as disputed
        await client.query(
          `UPDATE tdm_match_screenshots
           SET verification_status = 'disputed'
           WHERE match_id = $1 AND verification_status = 'verified_win'`,
          [match_id]
        );

        // Find an admin user (or use the match creator as the reporter)
        const adminUserResult = await client.query(
          `SELECT created_by FROM tdm_matches WHERE id = $1`,
          [match_id]
        );
        const reportedBy = adminUserResult.rows[0].created_by;

        // Use the first team with a win screenshot as the reported team
        const reportedTeamId = winningTeamScreenshots[0].team_id;

        // Create a dispute record automatically
        await client.query(
          `INSERT INTO tdm_disputes
           (match_id, reported_by, reported_team_id, reason, status)
           VALUES ($1, $2, $3, 'Automatic: Conflicting victory screenshots detected', 'pending')`,
          [match_id, reportedBy, reportedTeamId]
        );

        await client.query("COMMIT");
        return true;
      }
      // No clear outcome yet, wait for more screenshots
      else {
        await client.query("ROLLBACK");
        return false;
      }
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Error processing TDM match results:", error);
      return false;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error in checkAndProcessTdmMatchResults:", error);
    return false;
  }
};
// Complete a match and determine the winner
export const completeTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    const { match_id } = req.params;
    const { winner_team_id, user_id } = req.body;

    if (!userId)
      return res.status(404).json({ message: "User not authenticated" });

    if (!user_id || !match_id || !winner_team_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    await client.query("BEGIN");

    // Check if user is an admin or a team captain
    const captainCheck = await client.query(
      `
      SELECT tm.* FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      WHERE t.match_id = $1 AND tm.user_id = $2 AND tm.is_captain = true
    `,
      [match_id, user_id]
    );

    const isAdmin = req.isAdmin || false;

    if (captainCheck.rows.length === 0 && !isAdmin) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Only team captains or admins can complete a match",
      });
    }

    // Check if match exists and is in progress
    const matchCheck = await client.query(
      `
      SELECT * FROM tdm_matches
      WHERE id = $1 AND status = 'in_progress'
    `,
      [match_id]
    );

    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Match not found or not in progress",
      });
    }

    const match = matchCheck.rows[0];

    // Check if winner team is part of this match
    const winnerTeamCheck = await client.query(
      `
      SELECT * FROM tdm_teams
      WHERE id = $1 AND match_id = $2
    `,
      [winner_team_id, match_id]
    );

    if (winnerTeamCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Winner team is not part of this match",
      });
    }

    // Get winner team members
    const winnerTeamMembersResult = await client.query(
      `
      SELECT tm.*, u.username
      FROM tdm_team_members tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = $1
    `,
      [winner_team_id]
    );

    const winnerTeamMembers = winnerTeamMembersResult.rows;
    // Divide prize evenly by team size, not hardcoded 4
    const prizePerMember = match.prize_pool / winnerTeamMembers.length;

    await client.query(
      `
      UPDATE tdm_matches
      SET status = 'completed', winner_team_id = $1, end_time = NOW() AT TIME ZONE 'Asia/Kolkata'
      WHERE id = $2
    `,
      [winner_team_id, match_id]
    );

    // Create match result record
    await client.query(
      `
      INSERT INTO tdm_match_results
      (match_id, winner_team_id, prize_awarded, prize_amount, resolution_method, resolved_at)
      VALUES ($1, $2, true, $3, $4, NOW())
    `,
      [
        match_id,
        winner_team_id,
        match.prize_pool,
        isAdmin ? "admin_decision" : "automatic",
      ]
    );

    // Award prize to each winner team member
    for (const member of winnerTeamMembers) {
      await client.query(
        `
        UPDATE users
        SET wallet = wallet + $1, total_wins = total_wins + 1
        WHERE id = $2
      `,
        [prizePerMember, member.user_id]
      );
    }

    // After awarding prizes, before committing the transaction:

    // Get winner team details
    const winnerTeamDetails = await client.query(
      `SELECT team_name FROM tdm_teams WHERE id = $1`,
      [winner_team_id]
    );

    const teamName = winnerTeamDetails.rows[0]?.team_name || "The winning team";

    // Get all participants from both teams
    const allParticipantsResult = await client.query(
      `SELECT tm.user_id 
       FROM tdm_team_members tm
       JOIN tdm_teams t ON tm.team_id = t.id
       WHERE t.match_id = $1`,
      [match_id]
    );

    const notificationTitle = `Match Results: ${match.game_name}`;
    const notificationBody = `Team "${teamName}" has won the match and received ₹${match.prize_pool} prize money!`;

    // Send notifications to all participants
    for (const participant of allParticipantsResult.rows) {
      await sendUserNotification(
        participant.user_id,
        notificationTitle,
        notificationBody,
        null,
        {
          type: "tdm_match_completed",
          match_id: match_id.toString(),
          route: "tdm/match/" + match_id,
          winner_team_id: winner_team_id.toString(),
        }
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Match completed successfully",
      data: {
        match_id: match_id,
        winner_team_id: winner_team_id,
        prize_pool: match.prize_pool,
        prize_per_member: prizePerMember,
        winner_team_members: winnerTeamMembers.map((m) => ({
          user_id: m.user_id,
          username: m.username,
        })),
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error completing match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to complete match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Report a dispute for a match
export const reportTdmDispute = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { match_id } = req.params;
    const { reported_team_id, reason, evidence_path, user_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    if (!userId || !match_id || !reported_team_id || !reason) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // Check if user is part of the match
    const userMatchCheck = await pool.query(
      `
      SELECT tm.* FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      WHERE t.match_id = $1 AND tm.user_id = $2
    `,
      [match_id, user_id]
    );

    if (userMatchCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "You are not a participant in this match",
      });
    }

    // Check if reported team is part of this match
    const reportedTeamCheck = await pool.query(
      `
      SELECT * FROM tdm_teams
      WHERE id = $1 AND match_id = $2
    `,
      [reported_team_id, match_id]
    );

    if (reportedTeamCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Reported team is not part of this match",
      });
    }

    // Create dispute record
    const result = await pool.query(
      `
      INSERT INTO tdm_disputes
      (match_id, reported_by, reported_team_id, reason, evidence_path, status)
      VALUES ($1, $2, $3, $4, $5, 'pending')
      RETURNING *
    `,
      [match_id, user_id, reported_team_id, reason, evidence_path]
    );

    // Get match and team details
    const matchDetails = await pool.query(
      `SELECT m.game_name, t.team_name
       FROM tdm_matches m
       JOIN tdm_teams t ON t.id = $1 AND t.match_id = m.id
       WHERE m.id = $2`,
      [reported_team_id, match_id]
    );

    const matchName = matchDetails.rows[0]?.game_name || "TDM Match";
    const teamName = matchDetails.rows[0]?.team_name || "opponent team";

    // Get captains of both teams (for targeted notifications)
    const captainsResult = await pool.query(
      `SELECT tm.user_id, t.id as team_id
       FROM tdm_team_members tm
       JOIN tdm_teams t ON tm.team_id = t.id
       WHERE t.match_id = $1 AND tm.is_captain = true`,
      [match_id]
    );

    const notificationTitle = `Dispute Filed: ${matchName}`;
    const notificationBody = `A dispute has been filed against ${teamName}. Results will be reviewed by admins.`;

    for (const captain of captainsResult.rows) {
      // Only notify the reported team's captain and the other team's captain
      // Skip if it's the user who reported the dispute
      if (captain.user_id !== user_id) {
        const isReported = captain.team_id === reported_team_id;
        await sendUserNotification(
          captain.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: "tdm_dispute_filed",
            match_id: match_id.toString(),
            route: "tdm/match/" + match_id,
            is_reported_team: isReported.toString(),
          }
        );
      }
    }

    return res.status(201).json({
      success: true,
      message: "Dispute reported successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error reporting dispute:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to report dispute",
      error: error.message,
    });
  }
};

// Get user's TDM match history
export const getUserTdmMatchHistory = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { user_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    const targetUserId = user_id;

    // Get all matches the user participated in
    const result = await pool.query(
      `
      SELECT 
        m.*,
        t.team_type, t.team_name,
        (m.winner_team_id = t.id) as is_winner,
        tm.payment_amount as entry_fee,
        CASE 
          WHEN m.winner_team_id = t.id THEN mr.prize_amount / 4
          ELSE 0
        END as winnings
      FROM tdm_matches m
      JOIN tdm_teams t ON m.id = t.match_id
      JOIN tdm_team_members tm ON t.id = tm.team_id
      LEFT JOIN tdm_match_results mr ON m.id = mr.match_id
      WHERE tm.user_id = $1
      ORDER BY m.created_at DESC
    `,
      [targetUserId]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching user's TDM match history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM match history",
      error: error.message,
    });
  }
};

// Admin: Get all pending disputes
export const getAdminPendingDisputes = async (req, res) => {
  try {
    // Get all pending disputes with detailed information
    const disputesResult = await pool.query(`
      SELECT d.*,
        u.username as reporter_username,
        t.team_name as reported_team_name,
        m.game_name
      FROM tdm_disputes d
      JOIN users u ON d.reported_by = u.id
      JOIN tdm_teams t ON d.reported_team_id = t.id
      JOIN tdm_matches m ON d.match_id = m.id
      WHERE d.status = 'pending'
      ORDER BY d.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      data: disputesResult.rows,
    });
  } catch (error) {
    console.error("Error fetching pending disputes:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pending disputes",
      error: error.message,
    });
  }
};

// Admin: Resolve a dispute
export const adminResolveDispute = async (req, res) => {
  const client = await pool.connect();

  try {
    const { dispute_id } = req.params;
    const { resolution, admin_notes, winner_team_id } = req.body;

    if (
      !dispute_id ||
      !resolution ||
      (resolution === "resolved" && !winner_team_id)
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    await client.query("BEGIN");

    // Get dispute details
    const disputeResult = await client.query(
      `
      SELECT d.*, m.id as match_id, m.prize_pool
      FROM tdm_disputes d
      JOIN tdm_matches m ON d.match_id = m.id
      WHERE d.id = $1
    `,
      [dispute_id]
    );

    if (disputeResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Dispute not found",
      });
    }

    const dispute = disputeResult.rows[0];
    const matchId = dispute.match_id;

    // Update dispute status
    await client.query(
      `
      UPDATE tdm_disputes
      SET status = $1, admin_notes = $2, resolved_at = NOW()
      WHERE id = $3
    `,
      [
        resolution === "resolved" ? "resolved" : "rejected",
        admin_notes,
        dispute_id,
      ]
    );

    if (resolution === "resolved" && winner_team_id) {
      // Check if winner team is part of this match
      const winnerTeamCheck = await client.query(
        `
        SELECT * FROM tdm_teams
        WHERE id = $1 AND match_id = $2
      `,
        [winner_team_id, matchId]
      );

      if (winnerTeamCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          success: false,
          message: "Winner team is not part of this match",
        });
      }

      // Update match winner and status with IST timestamp
      await client.query(
        `
        UPDATE tdm_matches
        SET winner_team_id = $1, status = 'completed', end_time = NOW() AT TIME ZONE 'Asia/Kolkata'
        WHERE id = $2
      `,
        [winner_team_id, matchId]
      );

      // Create or update match result
      await client.query(
        `
        INSERT INTO tdm_match_results
        (match_id, winner_team_id, prize_awarded, prize_amount, resolution_method, resolved_at)
        VALUES ($1, $2, true, $3, 'admin_decision', NOW())
        ON CONFLICT (match_id) 
        DO UPDATE SET
          winner_team_id = EXCLUDED.winner_team_id,
          prize_awarded = EXCLUDED.prize_awarded,
          prize_amount = EXCLUDED.prize_amount,
          resolution_method = EXCLUDED.resolution_method,
          resolved_at = EXCLUDED.resolved_at
      `,
        [matchId, winner_team_id, dispute.prize_pool]
      );

      // Get winner team members
      const winnerTeamMembersResult = await client.query(
        `
        SELECT tm.user_id
        FROM tdm_team_members tm
        WHERE tm.team_id = $1
      `,
        [winner_team_id]
      );

      const winnerTeamMembers = winnerTeamMembersResult.rows;
      const prizePerMember = dispute.prize_pool / winnerTeamMembers.length;

      // Award prize to each winner team member
      for (const member of winnerTeamMembers) {
        await client.query(
          `
          UPDATE users
          SET wallet = wallet + $1, total_wins = total_wins + 1
          WHERE id = $2
        `,
          [prizePerMember, member.user_id]
        );
      }

      // Get winner team details
      const winnerTeamDetails = await client.query(
        `SELECT t.team_name, m.game_name 
         FROM tdm_teams t
         JOIN tdm_matches m ON t.match_id = m.id
         WHERE t.id = $1`,
        [winner_team_id]
      );

      const teamName =
        winnerTeamDetails.rows[0]?.team_name || "The winning team";
      const gameName = winnerTeamDetails.rows[0]?.game_name || "TDM Match";

      // Get all participants from both teams
      const allParticipantsResult = await client.query(
        `SELECT tm.user_id 
         FROM tdm_team_members tm
         JOIN tdm_teams t ON tm.team_id = t.id
         WHERE t.match_id = $1`,
        [matchId]
      );

      const notificationTitle = `Dispute Resolved: ${gameName}`;
      const notificationBody = `Team "${teamName}" has been declared the winner by admin decision and received ₹${dispute.prize_pool} prize money.`;

      // Send notifications to all participants
      for (const participant of allParticipantsResult.rows) {
        await sendUserNotification(
          participant.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: "tdm_dispute_resolved",
            match_id: matchId.toString(),
            route: "tdm/match/" + matchId,
            winner_team_id: winner_team_id.toString(),
          }
        );
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Dispute ${
        resolution === "resolved" ? "resolved" : "rejected"
      } successfully`,
      data: {
        dispute_id: dispute_id,
        resolution: resolution,
        admin_notes: admin_notes,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error resolving dispute:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to resolve dispute",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Get available/ongoing TDM matches for a user
export const getUserTdmMatches = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    const { user_id } = req.query;

    // Get all matches where the user is a participant and match is not completed
    const result = await pool.query(
      `
      SELECT m.*, t.team_type, t.team_name
      FROM tdm_matches m
      JOIN tdm_teams t ON m.id = t.match_id
      JOIN tdm_team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1 AND m.status != 'completed' AND m.status != 'cancelled'
      ORDER BY 
        CASE 
          WHEN m.status = 'confirmed' THEN 1
          WHEN m.status = 'in_progress' THEN 2
          ELSE 3
        END,
        m.created_at DESC
    `,
      [user_id]
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching user's TDM matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM matches",
      error: error.message,
    });
  }
};

// Start a confirmed match (change status to in_progress)
export const startTdmMatch = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { match_id } = req.params;
    const { user_id } = req.query;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    // Check if user is the match creator
    const matchCheck = await pool.query(
      `
      SELECT * FROM tdm_matches WHERE id = $1 AND status = 'confirmed'
    `,
      [match_id]
    );

    if (matchCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found or not in confirmed status",
      });
    }

    const match = matchCheck.rows[0];

    // Check if user is captain of Team A (match creator's team)
    const captainCheck = await pool.query(
      `
      SELECT tm.* FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      WHERE t.match_id = $1 AND t.team_type = 'team_a'
      AND tm.user_id = $2 AND tm.is_captain = true
    `,
      [match_id, user_id]
    );

    if (captainCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        message: "Only the team captain can start the match",
      });
    }

    // Check if room details exist
    if (!match.room_id || !match.room_password) {
      return res.status(400).json({
        success: false,
        message: "Room details must be set before starting the match",
      });
    }

    // Update match status to in_progress with IST timestamp
    await pool.query(
      `
      UPDATE tdm_matches SET status = 'in_progress', start_time = NOW() AT TIME ZONE 'Asia/Kolkata' WHERE id = $1
    `,
      [match_id]
    );

    // Get match details for notification
    const matchResult = await pool.query(
      `SELECT game_name FROM tdm_matches WHERE id = $1`,
      [match_id]
    );

    const matchName = matchResult.rows[0]?.game_name || "TDM Match";

    // Get all participants from both teams
    const allParticipantsResult = await pool.query(
      `SELECT tm.user_id 
       FROM tdm_team_members tm
       JOIN tdm_teams t ON tm.team_id = t.id
       WHERE t.match_id = $1`,
      [match_id]
    );

    const notificationTitle = `Match Started: ${matchName}`;
    const notificationBody = `Your match has started. Join the game room now!`;

    // Send notifications to all participants
    for (const participant of allParticipantsResult.rows) {
      // Skip sending to the captain who started the match
      if (participant.user_id !== parseInt(user_id)) {
        await sendUserNotification(
          participant.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: "tdm_match_started",
            match_id: match_id.toString(),
            route: "tdm/match/" + match_id,
          }
        );
      }
    }

    return res.status(200).json({
      success: true,
      message: "Match started successfully",
      data: {
        match_id,
        status: "in_progress",
        notifications_sent: allParticipantsResult.rowCount - 1, // Subtract 1 for the captain
      },
    });
  } catch (error) {
    console.error("Error starting TDM match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to start TDM match",
      error: error.message,
    });
  }
};

// Get financial summary for TDM matches for a user
export const getUserTdmFinancials = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { user_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    const targetUserId = user_id || userId;

    // Get entry fees spent
    const feesQuery = await pool.query(
      `
      SELECT 
        m.id,
        m.game_name as name,
        tm.payment_amount AS amount,
        tm.joined_at AS transaction_date,
        'entry_fee' AS transaction_type
      FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      JOIN tdm_matches m ON t.match_id = m.id
      WHERE tm.user_id = $1 AND tm.payment_status = 'completed'
    `,
      [targetUserId]
    );

    // Get winnings received
    const winningsQuery = await pool.query(
      `
      SELECT 
        m.id,
        m.game_name as name,
        (mr.prize_amount / 4) AS amount,
        mr.resolved_at AS transaction_date,
        'winnings' AS transaction_type
      FROM tdm_match_results mr
      JOIN tdm_matches m ON mr.match_id = m.id
      JOIN tdm_teams t ON m.winner_team_id = t.id
      JOIN tdm_team_members tm ON t.id = tm.team_id
      WHERE tm.user_id = $1 AND mr.prize_awarded = true
    `,
      [targetUserId]
    );

    // Combine and sort by date
    const financials = [...feesQuery.rows, ...winningsQuery.rows].sort(
      (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
    );

    return res.status(200).json({
      success: true,
      data: financials,
    });
  } catch (error) {
    console.error("Error fetching TDM financials:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM financials",
      error: error.message,
    });
  }
};

// Cancel a match that hasn't started yet
export const cancelTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    const { match_id } = req.params;

    const { user_id } = req.body;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    await client.query("BEGIN");

    // Check if user is the creator of the match or an admin
    const matchCheck = await client.query(
      `
      SELECT * FROM tdm_matches
      WHERE id = $1 AND (created_by = $2 OR $3 = true)
    `,
      [match_id, user_id, req.isAdmin || false]
    );

    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Only the match creator or an admin can cancel the match",
      });
    }

    const match = matchCheck.rows[0];

    // Check if match can be cancelled (waiting, team_a_ready, or team_b_ready)
    if (!["waiting", "team_a_ready", "team_b_ready"].includes(match.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Match cannot be cancelled in its current status",
      });
    }

    // Get all team members who paid
    const paidMembersResult = await client.query(
      `
      SELECT tm.user_id, tm.payment_amount
      FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      WHERE t.match_id = $1 AND tm.payment_status = 'completed'
    `,
      [match_id]
    );

    // Refund each member who paid
    for (const member of paidMembersResult.rows) {
      await client.query(
        `
        UPDATE users
        SET wallet = wallet + $1, total_games_played = total_games_played - 1
        WHERE id = $2
      `,
        [member.payment_amount, member.user_id]
      );
    }

    // Update match status to cancelled
    await client.query(
      `
      UPDATE tdm_matches
      SET status = 'cancelled'
      WHERE id = $1
    `,
      [match_id]
    );

    // Get match details for notification
    const matchDetails = await client.query(
      `SELECT game_name FROM tdm_matches WHERE id = $1`,
      [match_id]
    );

    const matchName = matchDetails.rows[0]?.game_name || "TDM Match";

    // Get all participants from both teams
    const allParticipantsResult = await client.query(
      `SELECT tm.user_id, tm.payment_amount
       FROM tdm_team_members tm
       JOIN tdm_teams t ON tm.team_id = t.id
       WHERE t.match_id = $1`,
      [match_id]
    );

    const notificationTitle = `Match Cancelled: ${matchName}`;

    // Send notifications to all participants
    for (const participant of allParticipantsResult.rows) {
      const hasRefund = participant.payment_amount > 0;
      const notificationBody = hasRefund
        ? `The match has been cancelled. ₹${participant.payment_amount} has been refunded to your wallet.`
        : `The match has been cancelled.`;

      console.log({
        user_id: participant.user_id,
        type: "tdm_match_cancelled",
        match_id: match_id,
        route: "tdm/match/" + match_id,
        refunded: hasRefund.toString(),
      });

      await sendUserNotification(
        participant.user_id,
        notificationTitle,
        notificationBody,
        null,
        {
          type: "tdm_match_cancelled",
          match_id: match_id.toString(),
          route: "tdm/match/" + match_id,
          refunded: hasRefund.toString(),
        }
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Match cancelled successfully and payments refunded",
      data: {
        match_id: match_id,
        refunded_members: paidMembersResult.rows.length,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error cancelling TDM match:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel TDM match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// New endpoint: Join an existing team (either Team A or Team B)
export const joinExistingTeam = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    const { match_id, team_id, user_id } = req.body;

    if (!match_id || !team_id || !user_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    await client.query("BEGIN");

    // Check if match exists and is in waiting state or team ready state
    const matchResult = await client.query(
      `
      SELECT * FROM tdm_matches 
      WHERE id = $1 
      AND status IN ('waiting', 'team_a_ready', 'team_b_ready')
    `,
      [match_id]
    );

    if (matchResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Match not found or not available for joining",
      });
    }

    const match = matchResult.rows[0];

    // Check if team exists
    const teamResult = await client.query(
      `
      SELECT t.*, 
      (SELECT COUNT(*) FROM tdm_team_members WHERE team_id = t.id) as member_count
      FROM tdm_teams t
      WHERE t.id = $1 AND t.match_id = $2
    `,
      [team_id, match_id]
    );

    if (teamResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "Team not found",
      });
    }

    const team = teamResult.rows[0];

    // Check if team is already full
    if (team.member_count >= 4) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Team is already full (4 members)",
      });
    }

    // Check if user is already a member of any team in this match
    const userTeamCheck = await client.query(
      `
      SELECT tm.* FROM tdm_team_members tm
      JOIN tdm_teams t ON tm.team_id = t.id
      WHERE t.match_id = $1 AND tm.user_id = $2
    `,
      [match_id, user_id]
    );

    if (userTeamCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "User is already a member of a team in this match",
      });
    }

    // Check if user exists
    const userExistsResult = await client.query(
      "SELECT * FROM users WHERE id = $1",
      [user_id]
    );

    if (userExistsResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: `User with ID ${user_id} not found`,
      });
    }

    // Add user to the team (not as captain)
    await client.query(
      `
      INSERT INTO tdm_team_members
      (team_id, user_id, is_captain, payment_amount, payment_status)
      VALUES ($1, $2, false, $3, 'pending')
    `,
      [team_id, user_id, match.entry_fee]
    );

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Successfully joined the team",
      data: {
        match_id: match.id,
        team_id: team.id,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error joining team:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to join team",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Check if a match is ready to be confirmed
export const checkMatchReadiness = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { match_id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    // Get match details
    const matchResult = await pool.query(
      `
      SELECT * FROM tdm_matches WHERE id = $1
    `,
      [match_id]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    const match = matchResult.rows[0];

    // If match is already confirmed or beyond, no need to check
    if (!["waiting", "team_a_ready", "team_b_ready"].includes(match.status)) {
      return res.status(200).json({
        success: true,
        data: {
          match_id: match_id,
          status: match.status,
          can_be_confirmed: false,
          reason: `Match is already ${match.status}`,
        },
      });
    }

    // Check team payments and player counts
    const teamStatsResult = await pool.query(
      `
      SELECT 
        t.team_type,
        COUNT(tm.id) AS player_count,
        SUM(CASE WHEN tm.payment_status = 'completed' THEN 1 ELSE 0 END) AS paid_count
      FROM tdm_teams t
      LEFT JOIN tdm_team_members tm ON t.id = tm.team_id
      WHERE t.match_id = $1
      GROUP BY t.team_type
    `,
      [match_id]
    );

    const teamStats = {};
    let totalPlayers = 0;
    let totalPaid = 0;

    teamStatsResult.rows.forEach((row) => {
      teamStats[row.team_type] = {
        player_count: parseInt(row.player_count),
        paid_count: parseInt(row.paid_count),
      };
      totalPlayers += parseInt(row.player_count);
      totalPaid += parseInt(row.paid_count);
    });

    // Check if the match is ready to be confirmed
    const canBeConfirmed =
      totalPlayers === match.team_size * 2 &&
      totalPaid === match.team_size * 2 &&
      teamStats["team_a"]?.player_count === match.team_size &&
      teamStats["team_b"]?.player_count === match.team_size &&
      teamStats["team_a"]?.paid_count === match.team_size &&
      teamStats["team_b"]?.paid_count === match.team_size;

    // Determine reason if not ready
    let reason = "";
    if (totalPlayers < match.team_size * 2) {
      reason = `Not enough players (${totalPlayers}/${match.team_size * 2})`;
    } else if (totalPaid < match.team_size * 2) {
      reason = `Not all players have paid (${totalPaid}/${
        match.team_size * 2
      })`;
    } else if (teamStats["team_a"]?.player_count < match.team_size) {
      reason = `Team A does not have enough players (${teamStats["team_a"]?.player_count}/${match.team_size})`;
    } else if (teamStats["team_b"]?.player_count < match.team_size) {
      reason = `Team B does not have enough players (${teamStats["team_b"]?.player_count}/${match.team_size})`;
    }

    return res.status(200).json({
      success: true,
      data: {
        match_id: match_id,
        status: match.status,
        team_a_players: teamStats["team_a"]?.player_count || 0,
        team_a_paid: teamStats["team_a"]?.paid_count || 0,
        team_b_players: teamStats["team_b"]?.player_count || 0,
        team_b_paid: teamStats["team_b"]?.paid_count || 0,
        total_players: totalPlayers,
        total_paid: totalPaid,
        can_be_confirmed: canBeConfirmed,
        reason: canBeConfirmed ? "Ready to be confirmed" : reason,
      },
    });
  } catch (error) {
    console.error("Error checking match readiness:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check match readiness",
      error: error.message,
    });
  }
};

// New endpoint: Set room details by match creator
export const setRoomDetails = async (req, res) => {
  const client = await pool.connect();

  try {
    const { userId } = req.auth;
    const { match_id } = req.params;
    const { room_id, room_password, user_id } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized: You need to log in.",
      });
    }

    if (!room_id || !room_password) {
      return res.status(400).json({
        success: false,
        message: "Room ID and password are required",
      });
    }

    await client.query("BEGIN");

    // Check if the user is the match creator
    const matchCheck = await client.query(
      `SELECT * FROM tdm_matches WHERE id = $1 AND created_by = $2`,
      [match_id, user_id]
    );

    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        success: false,
        message: "Only the match creator can set room details",
      });
    }

    // Check if match is in "confirmed" status
    if (matchCheck.rows[0].status !== "confirmed") {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Room details can only be set for confirmed matches",
      });
    }

    // Update match with room details
    await client.query(
      `UPDATE tdm_matches
       SET room_id = $1, room_password = $2
       WHERE id = $3`,
      [room_id, room_password, match_id]
    );

    // Get match details for notification
    const matchResult = await client.query(
      `SELECT m.game_name FROM tdm_matches m WHERE m.id = $1`,
      [match_id]
    );

    const matchName = matchResult.rows[0]?.game_name || "TDM Match";

    // Get all participants from both teams
    const allParticipantsResult = await client.query(
      `SELECT tm.user_id 
       FROM tdm_team_members tm
       JOIN tdm_teams t ON tm.team_id = t.id
       WHERE t.match_id = $1`,
      [match_id]
    );

    const notificationTitle = `Room Details Available: ${matchName}`;
    const notificationBody = `Room ID and password are now available for your match. Check match details to join.`;

    // Send notifications to all participants
    for (const participant of allParticipantsResult.rows) {
      await sendUserNotification(
        participant.user_id,
        notificationTitle,
        notificationBody,
        null,
        {
          type: "tdm_room_details",
          match_id: match_id.toString(),
          route: "tdm/match/" + match_id,
        }
      );
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Room details set successfully",
      data: {
        match_id,
        room_id,
        room_password,
        notifications_sent: allParticipantsResult.rowCount,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting room details:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to set room details",
      error: error.message,
    });
  } finally {
    client.release();
  }
};
