import express from "express";
import {
  joinPublicTdmMatch,
  joinPrivateTdmMatch,
  joinPrivateMatchByLink,
  getPublicTdmMatches,
  getTdmMatchById,
  processTdmTeamPayment,
  uploadTdmMatchScreenshot,
  completeTdmMatch,
  reportTdmDispute,
  getUserTdmMatchHistory,
  getUserTdmMatches,
  startTdmMatch,
  getUserTdmFinancials,
  cancelTdmMatch,
  joinExistingTeam,
  checkMatchReadiness,
  setRoomDetails,
} from "../../controllers/tdm/tdmMatch.js";
import { authMiddleware } from "../../middlewares/authMiddleware.js";
import { verifyAdmin } from "../../middlewares/adminAuthMiddleware.js";
import { pool } from "../../db/db.js";

const tdmRouter = express.Router();

// Public endpoints (require authentication) - USERS CAN ONLY JOIN MATCHES
// NOTE: Match creation is now ADMIN-ONLY via /api/admin/tdm routes
tdmRouter.get("/public", authMiddleware, getPublicTdmMatches);
tdmRouter.get("/user-matches", authMiddleware, getUserTdmMatches);
tdmRouter.get("/:match_id", authMiddleware, getTdmMatchById);
tdmRouter.post("/join-public", authMiddleware, joinPublicTdmMatch);
tdmRouter.post("/join-private", authMiddleware, joinPrivateTdmMatch);
tdmRouter.post("/join-match/:match_id", authMiddleware, joinPrivateMatchByLink); // NEW: Join private match by link
tdmRouter.post(
  "/:match_id/team/:team_id/payment",
  authMiddleware,
  processTdmTeamPayment
);
tdmRouter.post(
  "/:match_id/screenshot",
  authMiddleware,
  uploadTdmMatchScreenshot
);
tdmRouter.post("/:match_id/start", authMiddleware, startTdmMatch);
tdmRouter.post("/:match_id/complete", authMiddleware, completeTdmMatch);
tdmRouter.post("/:match_id/dispute", authMiddleware, reportTdmDispute);
tdmRouter.post("/history", authMiddleware, getUserTdmMatchHistory);
tdmRouter.post("/financials", authMiddleware, getUserTdmFinancials);
tdmRouter.post("/:match_id/cancel", authMiddleware, cancelTdmMatch);
tdmRouter.post("/join-team", authMiddleware, joinExistingTeam);
tdmRouter.get("/:match_id/readiness", authMiddleware, checkMatchReadiness);
tdmRouter.post("/:match_id/room-details", authMiddleware, setRoomDetails);

tdmRouter.post("/dummy", async (req, res) => {
  const { team_id, user_id ,match_id} = req.query;

  const status = "team_b_ready";

  const response = await pool.query(
    `
    SELECT * FROM tdm_team_members
    WHERE team_id = $1
    `,
    [team_id]
  );

  await pool.query(
    `
    UPDATE tdm_team_members
    SET payment_status = 'completed' 
    WHERE team_id = $1 AND user_id != $2
  `,
    [team_id, user_id]
  );

  await pool.query(`
    UPDATE tdm_matches 
      SET status = $1
      WHERE id = $2
    `,[status,match_id])

  return res.status(200).json({
    message: "Payment status updated successfully",
    data: response.rows,
  });
});

// DUMMY ENDPOINT 1: Process payment for entire team
tdmRouter.post("/dummy/team-payment", async (req, res) => {
  try {
    const { team_id } = req.query;
    
    if (!team_id) {
      return res.status(400).json({
        success: false,
        message: "Team ID is required"
      });
    }
    
    // First get team details to ensure it exists
    const teamQuery = await pool.query(
      `SELECT t.*, m.entry_fee, m.id as match_id 
       FROM tdm_teams t 
       JOIN tdm_matches m ON t.match_id = m.id 
       WHERE t.id = $1`,
      [team_id]
    );
    
    if (teamQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Team not found"
      });
    }
    
    const team = teamQuery.rows[0];
    const entryFee = team.entry_fee;
    const matchId = team.match_id;
    
    // Get all team members
    const membersQuery = await pool.query(
      `SELECT tm.*, u.wallet
       FROM tdm_team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = $1`,
      [team_id]
    );
    
    const members = membersQuery.rows;
    
    // Update all members to paid status and deduct fees
    for (const member of members) {
      // Update payment status to completed
      await pool.query(
        `UPDATE tdm_team_members
         SET payment_status = 'completed'
         WHERE id = $1`,
        [member.id]
      );
      
     
    }
    
    // Mark team as ready and payment completed
    await pool.query(
      `UPDATE tdm_teams
       SET is_ready = true, payment_completed = true
       WHERE id = $1`,
      [team_id]
    );
    
    // Check if this is team_a or team_b
    const teamType = team.team_type;
    let newStatus = teamType === 'team_a' ? 'team_a_ready' : 'team_b_ready';
    
    // Check if both teams are ready
    const teamsReadyCheck = await pool.query(
      `SELECT COUNT(*) as ready_teams
       FROM tdm_teams
       WHERE match_id = $1 AND is_ready = true`,
      [matchId]
    );
    
    if (parseInt(teamsReadyCheck.rows[0].ready_teams) === 2) {
      newStatus = 'confirmed';
    }
    
    // Update match status
    await pool.query(
      `UPDATE tdm_matches
       SET status = $1
       WHERE id = $2`,
      [newStatus, matchId]
    );
    
    return res.status(200).json({
      success: true,
      message: `Team payment processed. All ${members.length} members marked as paid. Match status: ${newStatus}`,
      data: {
        match_id: matchId,
        team_id: team_id,
        status: newStatus,
        members_paid: members.length
      }
    });
  } catch (error) {
    console.error("Error in dummy team payment endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// DUMMY ENDPOINT 2: Set match status to confirmed
tdmRouter.post("/dummy/confirm-match", async (req, res) => {
  try {
    const { match_id } = req.query;
    
    if (!match_id) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required"
      });
    }
    
    // Check if match exists
    const matchCheck = await pool.query(
      `SELECT * FROM tdm_matches WHERE id = $1`,
      [match_id]
    );
    
    if (matchCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found"
      });
    }
    
    // Generate room details for confirmed match
    const roomId = `TDM_${match_id}_${Date.now().toString().slice(-6)}`;
    const roomPassword = Math.random().toString(36).slice(-8).toUpperCase();
    
    // Set match status to confirmed with room details
    await pool.query(
      `UPDATE tdm_matches
       SET status = 'confirmed', 
           room_id = $1, 
           room_password = $2
       WHERE id = $3`,
      [roomId, roomPassword, match_id]
    );
    
    // Also mark both teams as ready and payment completed for consistency
    await pool.query(
      `UPDATE tdm_teams
       SET is_ready = true, payment_completed = true
       WHERE match_id = $1`,
      [match_id]
    );
    
    return res.status(200).json({
      success: true,
      message: "Match status set to confirmed with generated room details",
      data: {
        match_id: match_id,
        status: "confirmed",
        room_id: roomId,
        room_password: roomPassword
      }
    });
  } catch (error) {
    console.error("Error in dummy confirm match endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

// Add a utility endpoint to check the current status of a match
tdmRouter.get("/dummy/match-status", async (req, res) => {
  try {
    const { match_id } = req.query;
    
    if (!match_id) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required"
      });
    }
    
    // Get detailed match info including teams and members
    const matchData = await pool.query(
      `SELECT m.*,
        (SELECT json_build_object(
          'id', t.id,
          'team_name', t.team_name,
          'is_ready', t.is_ready,
          'payment_completed', t.payment_completed,
          'members', (
            SELECT json_agg(json_build_object(
              'user_id', tm.user_id,
              'is_captain', tm.is_captain,
              'payment_status', tm.payment_status,
              'username', u.username
            ))
            FROM tdm_team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = t.id
          )
        ) FROM tdm_teams t WHERE t.match_id = m.id AND t.team_type = 'team_a') AS team_a,
        (SELECT json_build_object(
          'id', t.id,
          'team_name', t.team_name,
          'is_ready', t.is_ready,
          'payment_completed', t.payment_completed,
          'members', (
            SELECT json_agg(json_build_object(
              'user_id', tm.user_id,
              'is_captain', tm.is_captain,
              'payment_status', tm.payment_status,
              'username', u.username
            ))
            FROM tdm_team_members tm
            JOIN users u ON tm.user_id = u.id
            WHERE tm.team_id = t.id
          )
        ) FROM tdm_teams t WHERE t.match_id = m.id AND t.team_type = 'team_b') AS team_b
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
    
    return res.status(200).json({
      success: true,
      message: "Match data retrieved",
      data: matchData.rows[0]
    });
  } catch (error) {
    console.error("Error in dummy match status endpoint:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message
    });
  }
});

export default tdmRouter;
