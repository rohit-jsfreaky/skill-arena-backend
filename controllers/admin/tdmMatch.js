import { pool } from "../../db/db.js";

// Admin: Create a new TDM Match
export const createTdmMatch = async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      match_type,
      game_name,
      entry_fee,
      team_size = 4,
    } = req.body;

    // Validation
    if (!match_type || !game_name || entry_fee === undefined) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: match_type, game_name, entry_fee",
      });
    }

    if (!["public", "private"].includes(match_type)) {
      return res.status(400).json({
        success: false,
        message: "match_type must be either 'public' or 'private'",
      });
    }

    if (![4, 6, 8].includes(team_size)) {
      return res.status(400).json({
        success: false,
        message: "team_size must be 4, 6, or 8",
      });
    }

    // Calculate prize pool (assuming admin sets this)
    const prize_pool = entry_fee * 2 * team_size; // Total entry fees from both teams

    // Get admin ID from request (set by admin middleware)
    const adminId = req.admin?.id || 1; // Default to 1 if not found

    await client.query("BEGIN");

    // Create the match
    const matchQuery = `
      INSERT INTO tdm_matches (
        match_type, status, game_name, entry_fee, prize_pool, 
        created_by, team_size
      ) 
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `;

    const matchResult = await client.query(matchQuery, [
      match_type,
      "waiting",
      game_name,
      entry_fee,
      prize_pool,
      adminId,
      team_size,
    ]);

    const match = matchResult.rows[0];

    // Create empty team slots for users to join
    // This ensures the public matches query will work properly
    const teamAQuery = `
      INSERT INTO tdm_teams (
        match_id, team_type, team_name, is_ready, payment_completed
      ) 
      VALUES ($1, 'team_a', NULL, false, false)
      RETURNING *
    `;

    const teamBQuery = `
      INSERT INTO tdm_teams (
        match_id, team_type, team_name, is_ready, payment_completed
      ) 
      VALUES ($1, 'team_b', NULL, false, false)
      RETURNING *
    `;

    await client.query(teamAQuery, [match.id]);
    await client.query(teamBQuery, [match.id]);

    await client.query("COMMIT");

    res.status(201).json({
      success: true,
      message: "TDM match created successfully",
      data: {
        match_id: match.id,
        match,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error creating TDM match:", error);
    res.status(500).json({
      success: false,
      message: "Failed to create TDM match",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Admin: Generate shareable link for private matches
export const generatePrivateMatchLink = async (req, res) => {
  try {
    const { match_id } = req.params;

    if (!match_id) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required",
      });
    }

    // Verify match exists and is private
    const matchQuery = await pool.query(
      "SELECT * FROM tdm_matches WHERE id = $1",
      [match_id]
    );

    if (matchQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Match not found",
      });
    }

    const match = matchQuery.rows[0];

    if (match.match_type !== "private") {
      return res.status(400).json({
        success: false,
        message: "Only private matches can have shareable links",
      });
    }

    // Generate the frontend URL for joining the match
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const shareableLink = `${frontendUrl}/tdm/join-match/${match_id}`;

    res.status(200).json({
      success: true,
      message: "Shareable link generated successfully",
      data: {
        match_id: match.id,
        shareable_link: shareableLink,
        match_details: match,
      },
    });
  } catch (error) {
    console.error("Error generating private match link:", error);
    res.status(500).json({
      success: false,
      message: "Failed to generate shareable link",
      error: error.message,
    });
  }
};

// Get all TDM matches with pagination and filtering
export const getAllTdmMatches = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || "all";
    const offset = (page - 1) * limit;

    // Build the where clause based on status filter
    let whereClause = "";
    const params = [];

    if (status !== "all") {
      whereClause = "WHERE m.status = $1";
      params.push(status);
    }

    // Get total count of matches
    const countQuery = `
      SELECT COUNT(*) FROM tdm_matches m ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const totalMatches = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalMatches / limit);

    // Get matches with team information
    const matchesQuery = `
      SELECT 
        m.*,
        ta.team_name AS team_a_name,
        tb.team_name AS team_b_name,
        (SELECT COUNT(*) FROM tdm_team_members WHERE team_id = ta.id) AS team_a_size,
        (SELECT COUNT(*) FROM tdm_team_members WHERE team_id = tb.id) AS team_b_size
      FROM tdm_matches m
      LEFT JOIN tdm_teams ta ON m.id = ta.match_id AND ta.team_type = 'team_a'
      LEFT JOIN tdm_teams tb ON m.id = tb.match_id AND tb.team_type = 'team_b'
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN m.status = 'waiting' THEN 1
          WHEN m.status = 'team_a_ready' THEN 2
          WHEN m.status = 'team_b_ready' THEN 3
          WHEN m.status = 'confirmed' THEN 4
          WHEN m.status = 'in_progress' THEN 5
          WHEN m.status = 'completed' THEN 6
          ELSE 7
        END,
        m.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const paginationParams = [...params, limit, offset];
    const matchesResult = await pool.query(matchesQuery, paginationParams);

    return res.status(200).json({
      success: true,
      data: matchesResult.rows,
      pagination: {
        totalMatches,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching TDM matches:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM matches",
      error: error.message,
    });
  }
};

// Get detailed information about a specific TDM match
export const getTdmMatchDetails = async (req, res) => {
  try {
    const { match_id } = req.params;

    // Get match details with teams and team members
    const matchResult = await pool.query(
      `
      SELECT m.*,
        (
          SELECT row_to_json(ta) FROM (
            SELECT t.*, 
              (
                SELECT json_agg(tm) FROM (
                  SELECT tm.*, u.username, u.name, u.profile
                  FROM tdm_team_members tm
                  JOIN users u ON tm.user_id = u.id
                  WHERE tm.team_id = t.id
                ) tm
              ) as members
            FROM tdm_teams t
            WHERE t.match_id = m.id AND t.team_type = 'team_a'
          ) ta
        ) as team_a,
        (
          SELECT row_to_json(tb) FROM (
            SELECT t.*, 
              (
                SELECT json_agg(tm) FROM (
                  SELECT tm.*, u.username, u.name, u.profile
                  FROM tdm_team_members tm
                  JOIN users u ON tm.user_id = u.id
                  WHERE tm.team_id = t.id
                ) tm
              ) as members
            FROM tdm_teams t
            WHERE t.match_id = m.id AND t.team_type = 'team_b'
          ) tb
        ) as team_b,
        (
          SELECT json_agg(s) FROM (
            SELECT s.*, u.username
            FROM tdm_match_screenshots s
            JOIN users u ON s.user_id = u.id
            WHERE s.match_id = m.id
          ) s
        ) as screenshots,
        (
          SELECT json_agg(d) FROM (
            SELECT d.*, u.username as reporter_username
            FROM tdm_disputes d
            JOIN users u ON d.reported_by = u.id
            WHERE d.match_id = m.id
          ) d
        ) as disputes,
        (
          SELECT row_to_json(r) FROM (
            SELECT r.* FROM tdm_match_results r
            WHERE r.match_id = m.id
          ) r
        ) as result
      FROM tdm_matches m
      WHERE m.id = $1
    `,
      [match_id]
    );

    if (matchResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "TDM match not found",
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

// Get all pending disputes
export const getAllTdmDisputes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const status = req.query.status || "pending";
    const offset = (page - 1) * limit;

    // Build the where clause based on status filter
    let whereClause = "WHERE d.status = $1";
    const params = [status];

    if (status === "all") {
      whereClause = "";
      params.pop();
    }

    // Get total count of disputes
    const countQuery = `
      SELECT COUNT(*) FROM tdm_disputes d ${whereClause}
    `;

    const countResult = await pool.query(countQuery, params);
    const totalDisputes = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalDisputes / limit);

    // Get disputes with related information
    const disputesQuery = `
      SELECT d.*,
        u.username as reporter_username,
        t.team_name as reported_team_name,
        m.game_name, m.status as match_status
      FROM tdm_disputes d
      JOIN users u ON d.reported_by = u.id
      JOIN tdm_teams t ON d.reported_team_id = t.id
      JOIN tdm_matches m ON d.match_id = m.id
      ${whereClause}
      ORDER BY d.created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;

    const paginationParams = [...params, limit, offset];
    const disputesResult = await pool.query(disputesQuery, paginationParams);

    return res.status(200).json({
      success: true,
      data: disputesResult.rows,
      pagination: {
        totalDisputes,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching TDM disputes:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM disputes",
      error: error.message,
    });
  }
};

// Resolve a dispute as admin
export const resolveTdmDispute = async (req, res) => {
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

      // Update match winner and status
      await client.query(
        `
        UPDATE tdm_matches
        SET winner_team_id = $1, status = 'completed', end_time = NOW()
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

// Cancel a TDM match as admin
export const cancelTdmMatchAdmin = async (req, res) => {
  const client = await pool.connect();

  try {
    const { match_id } = req.params;
    const { reason } = req.body;

    if (!match_id) {
      return res.status(400).json({
        success: false,
        message: "Match ID is required",
      });
    }

    await client.query("BEGIN");

    // Check if match exists
    const matchCheck = await client.query(
      `
      SELECT * FROM tdm_matches WHERE id = $1
    `,
      [match_id]
    );

    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "TDM match not found",
      });
    }

    const match = matchCheck.rows[0];

    // Check if match can be cancelled
    if (["completed", "cancelled"].includes(match.status)) {
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

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Match cancelled successfully and payments refunded",
      data: {
        match_id: match_id,
        refunded_members: paidMembersResult.rows.length,
        reason: reason,
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

// Get TDM statistics for admin dashboard
export const getTdmStatistics = async (req, res) => {
  try {
    // Get counts by match status
    const statusCountsQuery = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM tdm_matches
      GROUP BY status
    `);

    // Get dispute statistics
    const disputeStatsQuery = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM tdm_disputes
      GROUP BY status
    `);

    // Get total prize pool awarded
    const prizePoolQuery = await pool.query(`
      SELECT SUM(prize_amount) as total_prize_pool
      FROM tdm_match_results
      WHERE prize_awarded = true
    `);

    // Get recent matches
    const recentMatchesQuery = await pool.query(`
      SELECT m.id, m.game_name, m.status, m.created_at,
        ta.team_name as team_a_name,
        tb.team_name as team_b_name
      FROM tdm_matches m
      LEFT JOIN tdm_teams ta ON m.id = ta.match_id AND ta.team_type = 'team_a'
      LEFT JOIN tdm_teams tb ON m.id = tb.match_id AND tb.team_type = 'team_b'
      ORDER BY m.created_at DESC
      LIMIT 5
    `);

    // Format status counts
    const statusCounts = {
      waiting: 0,
      team_a_ready: 0,
      team_b_ready: 0,
      confirmed: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    };

    statusCountsQuery.rows.forEach((row) => {
      statusCounts[row.status] = parseInt(row.count);
    });

    // Format dispute counts
    const disputeCounts = {
      pending: 0,
      under_review: 0,
      resolved: 0,
      rejected: 0,
    };

    disputeStatsQuery.rows.forEach((row) => {
      disputeCounts[row.status] = parseInt(row.count);
    });

    return res.status(200).json({
      success: true,
      data: {
        match_stats: {
          total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
          by_status: statusCounts,
        },
        dispute_stats: {
          total: Object.values(disputeCounts).reduce((a, b) => a + b, 0),
          by_status: disputeCounts,
        },
        total_prize_pool_awarded: parseFloat(
          prizePoolQuery.rows[0]?.total_prize_pool || 0
        ),
        recent_matches: recentMatchesQuery.rows,
      },
    });
  } catch (error) {
    console.error("Error fetching TDM statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch TDM statistics",
      error: error.message,
    });
  }
};

// Admin: Set TDM match winner manually
export const setTdmMatchWinner = async (req, res) => {
  const client = await pool.connect();

  try {
    const { match_id } = req.params;
    const { winner_team_id, admin_notes } = req.body;

    if (!match_id || !winner_team_id) {
      return res.status(400).json({
        success: false,
        message: "Match ID and winner team ID are required",
      });
    }

    await client.query("BEGIN");

    // Check if match exists
    const matchCheck = await client.query(
      `
      SELECT * FROM tdm_matches WHERE id = $1
    `,
      [match_id]
    );

    if (matchCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        message: "TDM match not found",
      });
    }

    const match = matchCheck.rows[0];

    // Check if match is in a state that can be completed
    if (!["confirmed", "in_progress"].includes(match.status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        message: "Match must be confirmed or in progress to set a winner",
      });
    }

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
      SELECT tm.user_id
      FROM tdm_team_members tm
      WHERE tm.team_id = $1
    `,
      [winner_team_id]
    );

    const winnerTeamMembers = winnerTeamMembersResult.rows;
    const prizePerMember = match.prize_pool / winnerTeamMembers.length;

    // Update match status to completed and set winner team
    await client.query(
      `
      UPDATE tdm_matches
      SET status = 'completed', winner_team_id = $1, end_time = NOW()
      WHERE id = $2
    `,
      [winner_team_id, match_id]
    );

    // Create match result record
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
      [match_id, winner_team_id, match.prize_pool]
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

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Match winner set successfully",
      data: {
        match_id: match_id,
        winner_team_id: winner_team_id,
        prize_pool: match.prize_pool,
        prize_per_member: prizePerMember,
        admin_notes: admin_notes,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error setting TDM match winner:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to set TDM match winner",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

export const getDisputedTdmMatches = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT d.*, m.game_name, m.status as match_status
      FROM tdm_disputes d
      JOIN tdm_matches m ON d.match_id = m.id
      WHERE d.status = 'pending'
      ORDER BY d.created_at DESC
    `);

    res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error retrieving disputed TDM matches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve disputed TDM matches",
      error: error.message,
    });
  }
};
