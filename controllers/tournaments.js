import { pool } from "../db/db.js";

// Modify the getAllTournaments function
export const getAllTournaments = async (req, res) => {
  try {
    const { userId } = req.auth;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 9;
    const offset = (page - 1) * limit;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    // Get the user_id from query params to check membership
    const user_id = req.query.user_id;

    // Check if user has an active membership
    const membershipQuery = `
      SELECT m.id 
      FROM users u
      JOIN memberships m ON u.membership_id = m.id
      WHERE u.id = $1 AND (u.membership_expiry IS NULL OR u.membership_expiry > NOW())
    `;
    const membershipResult = await pool.query(membershipQuery, [user_id]);
    const hasMembership = membershipResult.rows.length > 0;

    // Base count and tournament queries
    let countQuery, tournamentQuery;

    if (hasMembership) {
      // Member can see all tournaments
      countQuery = `
        SELECT COUNT(*) 
        FROM tournaments t
        WHERE t.status != 'completed'
      `;

      tournamentQuery = `
        SELECT t.*, 
        (SELECT COUNT(*) FROM user_tournaments ut WHERE ut.tournament_id = t.id) as current_participants,
        g.access_type
        FROM tournaments t
        JOIN games g ON t.game_name = g.name
        WHERE t.status != 'completed'
        ORDER BY t.start_time ASC
        LIMIT $1 OFFSET $2
      `;
    } else {
      // Non-member can only see tournaments for free games
      countQuery = `
        SELECT COUNT(*) 
        FROM tournaments t
        JOIN games g ON t.game_name = g.name
        WHERE t.status != 'completed' AND g.access_type = 'free'
      `;

      tournamentQuery = `
        SELECT t.*, 
        (SELECT COUNT(*) FROM user_tournaments ut WHERE ut.tournament_id = t.id) as current_participants,
        g.access_type
        FROM tournaments t
        JOIN games g ON t.game_name = g.name
        WHERE t.status != 'completed' AND g.access_type = 'free'
        ORDER BY t.start_time ASC
        LIMIT $1 OFFSET $2
      `;
    }

    // Get total count
    const countResult = await pool.query(countQuery);
    const totalItems = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalItems / limit);

    // Get paginated tournaments
    const tournaments = await pool.query(tournamentQuery, [limit, offset]);

    return res.json({
      data: tournaments.rows,
      pagination: {
        totalItems,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      membership_status: hasMembership,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getUserTournaments = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.body;
    const tournaments = await pool.query(
      `
        SELECT 
  t.*, 
  ut.joined_at,
  (
    SELECT COUNT(*) 
    FROM user_tournaments ut2 
    WHERE ut2.tournament_id = t.id
  ) AS current_participants
FROM tournaments t
JOIN user_tournaments ut ON t.id = ut.tournament_id
WHERE ut.user_id = $1
ORDER BY t.start_time ASC;

      `,
      [user_id]
    );

    return res.json(tournaments.rows);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getTournamentHistory = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const tournaments = await pool.query(`
        SELECT t.*, 
        (SELECT COUNT(*) FROM user_tournaments ut WHERE ut.tournament_id = t.id) as participants 
        FROM tournaments t
        WHERE t.status = 'completed'
        ORDER BY t.end_time DESC
      `);

    return res.json(tournaments.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getTournamentById = async (req, res) => {
  try {
    if (!req.isAdmin) {
      // Not an admin request, so check user auth
      console.log("checking user auth");
      const { userId } = req.auth;

      console.log("userId", userId);

      if (!userId) {
        return res
          .status(401)
          .json({ message: "Unauthorized: You need to log in." });
      }
    } else {
      console.log("Admin request - bypassing user auth check");
    }

    const tournament = await pool.query(
      `
        SELECT t.*, 
        (SELECT COUNT(*) FROM user_tournaments ut WHERE ut.tournament_id = t.id) as current_participants 
        FROM tournaments t
        WHERE t.id = $1
      `,
      [req.params.id]
    );

    if (tournament.rows.length === 0) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    return res.json(tournament.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const createTournament = async (req, res) => {
  // Add admin check here

  const { userId } = req.auth;

  if (!userId) {
    return res
      .status(401)
      .json({ message: "Unauthorized: You need to log in." });
  }

  try {
    const {
      title,
      description,
      image_url,
      team_mode,
      entry_fee_normal,
      entry_fee_pro,
      max_participants,
      start_time,
      end_time,
    } = req.body;

    const newTournament = await pool.query(
      `
        INSERT INTO tournaments (
          title, description, image_url, team_mode, 
          entry_fee_normal, entry_fee_pro, max_participants, 
          start_time, end_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `,
      [
        title,
        description,
        image_url,
        team_mode,
        entry_fee_normal,
        entry_fee_pro,
        max_participants,
        start_time,
        end_time,
      ]
    );

    return res.status(201).json(newTournament.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const joinTournament = async (req, res) => {
  try {
    const { userId: user_id } = req.auth;

    if (!user_id) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }
    // Get tournament details
    console.log(req.params);
    console.log(req.body);
    const tournamentId = req.params.id;
    const userId = req.body.user.id;

    // Start a transaction
    await pool.query("BEGIN");

    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ message: "Tournament not found" });
    }

    const tournament = tournamentResult.rows[0];

    // Check if tournament is full
    const participantsResult = await pool.query(
      "SELECT COUNT(*) FROM user_tournaments WHERE tournament_id = $1",
      [tournamentId]
    );

    const currentParticipants = parseInt(participantsResult.rows[0].count);

    if (currentParticipants >= tournament.max_participants) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ message: "Tournament is full" });
    }

    // Check if user already joined
    const userJoinedResult = await pool.query(
      "SELECT * FROM user_tournaments WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId]
    );

    if (userJoinedResult.rows.length > 0) {
      await pool.query("ROLLBACK");
      return res
        .status(400)
        .json({ message: "You have already joined this tournament" });
    }

    // Get user details
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);

    const user = userResult.rows[0];

    // Determine entry fee based on membership
    const entryFee = user.membership_id
      ? tournament.entry_fee_pro
      : tournament.entry_fee_normal;

    // Check if user has enough funds
    if (user.wallet < entryFee) {
      await pool.query("ROLLBACK");
      return res.status(400).json({ message: "Insufficient funds" });
    }

    // Update user wallet and total_games_played
    await pool.query(
      `
      UPDATE users 
      SET 
      wallet = wallet - $1,
      total_games_played = COALESCE(total_games_played, 0) + 1
      WHERE id = $2
    `,
      [entryFee, userId]
    );

    // Add user to tournament
    const joinResult = await pool.query(
      "INSERT INTO user_tournaments (user_id, tournament_id, payment_amount) VALUES ($1, $2, $3) RETURNING *",
      [userId, tournamentId, entryFee]
    );

    await pool.query("COMMIT");

    return res.status(201).json({
      message: "Successfully joined tournament",
      data: joinResult.rows[0],
      newBalance: user.wallet - entryFee,
    });
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getTournamentParticipants = async (req, res) => {
  try {
    if (!req.isAdmin) {
      console.log("checking user auth");
      const { userId } = req.auth;

      console.log("userId", userId);

      if (!userId) {
        return res
          .status(401)
          .json({ message: "Unauthorized: You need to log in." });
      }
    } else {
      console.log("Admin request - bypassing user auth check");
    }

    const participants = await pool.query(
      `
      SELECT u.id, u.username, u.profile, ut.joined_at
      FROM user_tournaments ut
      JOIN users u ON ut.user_id = u.id
      WHERE ut.tournament_id = $1
      ORDER BY ut.joined_at ASC
    `,
      [req.params.id]
    );
    return res.json(participants.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: "Server error" });
  }
};

export const getUserTournamentHistory = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.body;

    // Get tournaments the user has participated in with results
    const tournamentHistory = await pool.query(
      `
      SELECT 
        t.id, 
        t.name,
        t.image,
        t.start_time,
        t.end_time,
        t.status,
        ut.payment_amount AS entry_fee,
        tr.prize_amount AS winnings,
        (tr.winner_id = $1) AS is_winner
      FROM tournaments t
      JOIN user_tournaments ut ON t.id = ut.tournament_id
      LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
      WHERE ut.user_id = $1
      ORDER BY t.end_time DESC
    `,
      [user_id]
    );

    return res.json({
      success: true,
      data: tournamentHistory.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

export const getUserTournamentFinancials = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.body;

    // Get entry fees spent
    const feesQuery = await pool.query(
      `
      SELECT 
        t.id,
        t.name,
        ut.payment_amount AS amount,
        ut.joined_at AS transaction_date,
        'entry_fee' AS transaction_type
      FROM user_tournaments ut
      JOIN tournaments t ON ut.tournament_id = t.id
      WHERE ut.user_id = $1
    `,
      [user_id]
    );

    // Get winnings received
    const winningsQuery = await pool.query(
      `
      SELECT 
        t.id,
        t.name,
        tr.prize_amount AS amount,
        tr.resolved_at AS transaction_date,
        'winnings' AS transaction_type
      FROM tournament_results tr
      JOIN tournaments t ON tr.tournament_id = t.id
      WHERE tr.winner_id = $1 AND tr.prize_awarded = true
    `,
      [user_id]
    );

    // Combine both types of transactions and sort by date
    const financials = [...feesQuery.rows, ...winningsQuery.rows].sort(
      (a, b) => new Date(b.transaction_date) - new Date(a.transaction_date)
    );

    return res.json({
      success: true,
      data: financials,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
