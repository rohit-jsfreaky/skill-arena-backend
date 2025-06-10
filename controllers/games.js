import { pool } from "../db/db.js";

// Get all active games
export const getAllGames = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    // Get all active games
    const result = await pool.query(
      `SELECT id, name, description, image, platform, genre
       FROM games
       WHERE status = 'active'
       ORDER BY name ASC`
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching games:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch games",
      error: error.message,
    });
  }
};

// Get a specific game by ID
export const getGameById = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { id } = req.params;
    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Game ID is required",
      });
    }

    const result = await pool.query(
      `SELECT id, name, description, image, platform, genre 
       FROM games 
       WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Game not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching game:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch game",
      error: error.message,
    });
  }
};

export const getGamesBasedOnUser = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.body;

    // Check if the user has an active membership
    const membershipQuery = `
      SELECT m.id 
      FROM users u
      JOIN memberships m ON u.membership_id = m.id
      WHERE u.id = $1 AND (u.membership_expiry IS NULL OR u.membership_expiry > NOW())
    `;
    const membershipResult = await pool.query(membershipQuery, [user_id]);
    const hasMembership = membershipResult.rows.length > 0;

    // Query to get games based on access type
    let gamesQuery;
    if (hasMembership) {
      // If user has membership, get all active games
      gamesQuery = `
        SELECT id, name, description, image, platform, genre, access_type
        FROM games
        WHERE status = 'active'
        ORDER BY name ASC
      `;
    } else {
      // If user doesn't have membership, only get free games
      gamesQuery = `
        SELECT id, name, description, image, platform, genre, access_type
        FROM games
        WHERE status = 'active' AND access_type = 'free'
        ORDER BY name ASC
      `;
    }

    const result = await pool.query(gamesQuery);

    return res.status(200).json({
      success: true,
      data: result.rows,
      membership_status: hasMembership,
    });
  } catch (error) {
    console.error("Error fetching games:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch games",
      error: error.message,
    });
  }
};
