import { pool } from "../../db/db.js";
import {
  sendGlobalNotificationUtil,
  sendUserNotification,
} from "../../utils/sendNotifications.js";

export const getAllTournaments = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const filter = req.query.filter || "all";
  const offset = (page - 1) * limit;

  try {
    // Build the where clause based on the filter
    let whereClause = "";
    if (filter === "upcoming") {
      whereClause = "WHERE t.status = 'upcoming'";
    } else if (filter === "ongoing") {
      whereClause = "WHERE t.status = 'ongoing'";
    } else if (filter === "completed") {
      whereClause = "WHERE t.status = 'completed'";
    } else {
      // For "all", show all except completed by default
      whereClause = "WHERE 1=1";
    }

    // Get total count of tournaments
    const countQuery = `
      SELECT COUNT(*) 
      FROM tournaments t
      ${whereClause}
    `;

    const countResult = await pool.query(countQuery);
    const totalTournaments = parseInt(countResult.rows[0].count);

    // Calculate pagination values
    const totalPages = Math.ceil(totalTournaments / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    // Get tournaments with pagination
    const tournamentsQuery = `
      SELECT t.*, 
      (SELECT COUNT(*) FROM user_tournaments ut WHERE ut.tournament_id = t.id) as current_participants 
      FROM tournaments t
      ${whereClause}
      ORDER BY 
        CASE 
          WHEN t.status = 'upcoming' THEN 1
          WHEN t.status = 'ongoing' THEN 2
          ELSE 3
        END,
        t.start_time ASC
      LIMIT $1 OFFSET $2
    `;

    const tournaments = await pool.query(tournamentsQuery, [limit, offset]);

    return res.status(200).json({
      success: true,
      message: "Tournaments fetched successfully",
      data: tournaments.rows,
      pagination: {
        totalTournaments,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
};

export const createTournament = async (req, res) => {
  let {
    name,
    game_name,
    description,
    image, // Now this is just a URL
    entry_fee_normal,
    entry_fee_pro,
    prize_pool,
    team_mode,
    max_participants,
    start_time,
    end_time,
    rules,
  } = req.body;

  if (
    !name ||
    !game_name ||
    !description ||
    !team_mode ||
    !max_participants ||
    !start_time ||
    !end_time ||
    !rules ||
    !image
  ) {
    return res.status(400).json({ error: "All fields are required." });
  }

  console.log(team_mode);

  // Convert time to proper format
  const startTime = new Date(start_time);
  const endTime = new Date(end_time);
  const currentTime = new Date();

  if (startTime < currentTime) {
    return res.status(400).json({ error: "Start time cannot be in the past." });
  }

  if (endTime < startTime) {
    return res
      .status(400)
      .json({ error: "End time cannot be before start time." });
  }

  // Simple URL validation
  const isUrl =
    image && (image.startsWith("http://") || image.startsWith("https://"));
  if (!isUrl) {
    return res.status(400).json({ error: "Image must be a valid URL." });
  }

  let client;
  try {
    client = await pool.connect();

    const tournamentStatus = "upcoming";
    const query = `
        INSERT INTO tournaments 
        (name, game_name, description, image, entry_fee_normal, entry_fee_pro, prize_pool, team_mode, max_participants, start_time, end_time, rules,status) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,$13) 
        RETURNING *;
      `;

    const values = [
      name,
      game_name,
      description,
      image,
      entry_fee_normal,
      entry_fee_pro,
      prize_pool,
      team_mode,
      max_participants,
      startTime,
      endTime,
      rules,
      tournamentStatus,
    ];

    const result = await client.query(query, values);

    await sendGlobalNotificationUtil(
      `🚀 ${name} Just Dropped`,
      "Don’t miss out on the action! 🔥 Register now and battle to the top! 🏁",
      null,
      {
        route: "tournaments/" + result.rows[0].id,
      }
    );

    return res.status(201).json({
      message: "Tournament created successfully",
      tournament: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating tournament:", error.message);
    return res.status(500).json({ error: "Internal server error." });
  } finally {
    if (client) client.release();
  }
};

export const updateTournament = async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: "Tournament ID is required." });
  }

  let {
    name,
    game_name,
    description,
    image,
    team_mode,
    entry_fee_normal,
    entry_fee_pro,
    prize_pool,
    max_participants,
    start_time,
    end_time,
    rules,
    status,
    room_id,
    room_password,
  } = req.body;

  // Simple URL validation if image is provided
  if (image) {
    const isUrl =
      image && (image.startsWith("http://") || image.startsWith("https://"));
    if (!isUrl) {
      return res.status(400).json({ error: "Image must be a valid URL." });
    }
  }

  let client;
  try {
    client = await pool.connect();

    // Check if tournament exists and get its original details
    const checkQuery = "SELECT * FROM tournaments WHERE id = $1";
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rowCount === 0) {
      return res.status(404).json({ error: "Tournament not found." });
    }

    // Store original tournament details for comparison
    const originalTournament = checkResult.rows[0];
    const isRoomDetailsUpdated =
      (room_id && room_id !== originalTournament.room_id) ||
      (room_password && room_password !== originalTournament.room_password);

    // Update tournament
    const updateQuery = `
      UPDATE tournaments 
      SET 
        name = COALESCE($1, name),
        game_name = COALESCE($2, game_name),
        description = COALESCE($3, description),
        image = COALESCE($4, image),
        team_mode = COALESCE($5, team_mode),
        entry_fee_normal = COALESCE($6, entry_fee_normal),
        entry_fee_pro = COALESCE($7, entry_fee_pro),
        prize_pool = COALESCE($8, prize_pool),
        max_participants = COALESCE($9, max_participants),
        start_time = COALESCE($10, start_time),
        end_time = COALESCE($11, end_time),
        rules = COALESCE($12, rules),
        status = COALESCE($13, status),
        room_id = COALESCE($14, room_id),
        room_password = COALESCE($15, room_password)
      WHERE id = $16
      RETURNING *;
    `;

    const values = [
      name,
      game_name,
      description,
      image,
      team_mode,
      entry_fee_normal,
      entry_fee_pro,
      prize_pool,
      max_participants,
      start_time,
      end_time,
      rules,
      status,
      room_id,
      room_password,
      id,
    ];

    const result = await client.query(updateQuery, values);
    const updatedTournament = result.rows[0];

    // Get all participants for this tournament
    const participantsQuery = `
      SELECT ut.user_id, u.name as user_name
      FROM user_tournaments ut 
      JOIN users u ON ut.user_id = u.id
      WHERE ut.tournament_id = $1
    `;
    const participantsResult = await client.query(participantsQuery, [id]);
    const participants = participantsResult.rows;

    // Send notifications to participants based on what was updated
    if (participants.length > 0) {
      let notificationTitle, notificationBody;

      if (isRoomDetailsUpdated) {
        notificationTitle = `Room Details Updated: ${updatedTournament.name}`;
        notificationBody = `Room ID and password are now available for the tournament. Check tournament details.`;
      } else {
        notificationTitle = `Tournament Updated: ${updatedTournament.name}`;
        notificationBody = `The tournament details have been updated. Check for the latest information.`;
      }

      // Send notifications to each participant
      for (const participant of participants) {
        console.log(participant);
        // return
        await sendUserNotification(
          participant.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: isRoomDetailsUpdated
              ? "tournament_room_updated"
              : "tournament_updated",
            tournament_id: id,
            route: "tournaments/" + id,
          }
        );
      }
    }

    return res.status(200).json({
      message: "Tournament updated successfully",
      tournament: updatedTournament,
      notificationsSent: participants.length > 0,
    });
  } catch (error) {
    console.error("Error updating tournament:", error.message);
    return res.status(500).json({ error: "Internal server error." });
  } finally {
    if (client) client.release();
  }
};

export const deleteTournament = async (req, res) => {
  const { id } = req.params;

  if (!id) {
    return res.status(400).json({ error: "Tournament ID is required." });
  }

  let client;
  try {
    client = await pool.connect();

    // Start a transaction
    await client.query("BEGIN");

    // Check if tournament exists and get its details
    const checkQuery = "SELECT * FROM tournaments WHERE id = $1";
    const checkResult = await client.query(checkQuery, [id]);

    if (checkResult.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Tournament not found." });
    }

    const tournament = checkResult.rows[0];
    const { status, name, entry_fee_normal, entry_fee_pro } = tournament;

    // If tournament is not completed, process refunds for participants
    if (status === "upcoming" || status === "ongoing") {
      // Get all participants for this tournament
      const participantsQuery = `
        SELECT ut.user_id, ut.payment_amount, u.membership_expiry, u.name as user_name
        FROM user_tournaments ut 
        JOIN users u ON ut.user_id = u.id
        WHERE ut.tournament_id = $1
      `;
      const participantsResult = await client.query(participantsQuery, [id]);
      const participants = participantsResult.rows;

      // Process refunds for each participant
      for (const participant of participants) {
        const { user_id, membership_expiry, user_name } = participant;

        // Determine refund amount based on membership status
        const hasMembership =
          membership_expiry && new Date(membership_expiry) > new Date();
        const refundAmount = hasMembership ? entry_fee_pro : entry_fee_normal;

        // Update user's wallet with refund
        const updateWalletQuery = `
          UPDATE users 
          SET wallet = wallet + $1 
          WHERE id = $2
          RETURNING wallet
        `;
        await client.query(updateWalletQuery, [refundAmount, user_id]);

        // Send notification only to this participant
        const notificationTitle = `Tournament Cancelled: ${name}`;
        const notificationBody = `The tournament has been cancelled. A refund of ₹${refundAmount} has been added to your wallet.`;

        await sendUserNotification(
          user_id,
          notificationTitle,
          notificationBody,
          null,
          { type: "tournament_cancelled", tournament_id: id }
        );
      }
    }

    // Delete the tournament
    const deleteQuery = "DELETE FROM tournaments WHERE id = $1 RETURNING *";
    const deleteResult = await client.query(deleteQuery, [id]);

    // Commit the transaction
    await client.query("COMMIT");

    return res.status(200).json({
      message: "Tournament deleted successfully",
      deletedTournament: deleteResult.rows[0],
      refundsProcessed: status !== "completed" ? true : false,
    });
  } catch (error) {
    // Rollback in case of error
    if (client) await client.query("ROLLBACK");
    console.error("Error deleting tournament:", error.message);
    return res.status(500).json({ error: "Internal server error." });
  } finally {
    if (client) client.release();
  }
};
/**
 * Search tournaments by name or game name
 * @route GET /api/admin/tournaments/search
 * @access Admin only
 */
export const searchTournaments = async (req, res) => {
  const { term, limit = 5 } = req.query;

  if (!term) {
    return res.status(400).json({
      success: false,
      message: "Search term is required",
    });
  }

  try {
    // Search tournaments by name or game name with priority ordering
    const query = `
      SELECT id, name, game_name, image, status
      FROM tournaments
      WHERE name ILIKE $1 OR game_name ILIKE $1
      ORDER BY 
        CASE 
          WHEN name ILIKE $2 THEN 0
          WHEN name ILIKE $3 THEN 1
          WHEN game_name ILIKE $2 THEN 2
          WHEN game_name ILIKE $3 THEN 3
          ELSE 4
        END
      LIMIT $4
    `;

    const result = await pool.query(query, [
      `%${term}%`, // Pattern for anywhere in the string
      `${term}%`, // Pattern for starts with (higher priority)
      `%${term}`, // Pattern for ends with (medium priority)
      limit,
    ]);

    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error searching tournaments:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search tournaments",
      error: error.message,
    });
  }
};
