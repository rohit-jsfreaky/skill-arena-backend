import { pool } from "../../db/db.js";

/**
 * Get all users with pagination
 * @route GET /api/admin/users
 * @access Admin only
 */
export const getAllUsers = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const filter = req.query.filter || "all";
  
  const offset = (page - 1) * limit;
  
  let client;
  
  try {
    client = await pool.connect();
    
    let filterCondition = "";
    const queryParams = [limit, offset];
    
    // Apply filter condition based on the filter parameter
    if (filter === "active") {
      filterCondition = "WHERE is_banned = FALSE OR is_banned IS NULL";
    } else if (filter === "banned") {
      filterCondition = "WHERE is_banned = TRUE";
    }
    
    // Get total count of users
    const countQuery = `
      SELECT COUNT(*) FROM users ${filterCondition}
    `;
    
    const countResult = await client.query(countQuery);
    const totalUsers = parseInt(countResult.rows[0].count);
    
    // Calculate pagination values
    const totalPages = Math.ceil(totalUsers / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    // Get users with pagination
    const query = `
      SELECT id, username, email, profile, created_at, name, is_banned
      FROM users
      ${filterCondition}
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `;
    
    const result = await client.query(query, queryParams);
    
    return res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: result.rows,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage,
        hasPrevPage
      }
    });
    
  } catch (error) {
    console.error("Error fetching users:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch users",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Get user details by ID
 * @route GET /api/admin/users/:id
 * @access Admin only
 */
export const getUserById = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "User ID is required"
    });
  }
  
  let client;
  
  try {
    client = await pool.connect();
    
    const query = `
      SELECT u.id, u.username, u.email, u.profile, u.created_at, 
       u.name, u.wallet, u.total_games_played, u.total_wins, 
       u.referral_code, u.applied_referral, u.membership_expiry, 
       u.membership_id, u.is_banned, u.banned_until, u.ban_reason
      FROM users u
      WHERE u.id = $1
    `;
    
    const result = await client.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    return res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: result.rows[0]
    });
    
  } catch (error) {
    console.error("Error fetching user:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Search users by username, name, or user ID
 * @route GET /api/admin/users/search
 * @access Admin only
 */
export const searchUsers = async (req, res) => {
  const { term, limit = 5 } = req.query;
  
  if (!term) {
    return res.status(400).json({
      success: false,
      message: "Search term is required"
    });
  }
  
  let client;
  
  try {
    client = await pool.connect();
    
    // Check if the search term is a number (potential user ID)
    const isNumeric = /^\d+$/.test(term.toString().trim());
    
    let query;
    let queryParams;
    
    if (isNumeric) {
      // If search term is numeric, prioritize exact ID match, then include name/username matches
      query = `
        SELECT id, username, name
        FROM users
        WHERE id = $1 
           OR username ILIKE $2 
           OR name ILIKE $2
        ORDER BY 
          CASE 
            WHEN id = $1 THEN 0
            WHEN username ILIKE $3 THEN 1
            WHEN username ILIKE $4 THEN 2
            WHEN name ILIKE $3 THEN 3
            ELSE 4
          END
        LIMIT $5
      `;
      
      queryParams = [
        parseInt(term), // Exact ID match
        `%${term}%`,    // Pattern for anywhere in username/name
        `${term}%`,     // Pattern for starts with (higher priority)
        `%${term}`,     // Pattern for ends with (medium priority)
        limit
      ];
    } else {
      // If search term is not numeric, search only by username and name
      query = `
        SELECT id, username, name
        FROM users
        WHERE username ILIKE $1 OR name ILIKE $1
        ORDER BY 
          CASE 
            WHEN username ILIKE $2 THEN 0
            WHEN username ILIKE $3 THEN 1
            WHEN name ILIKE $2 THEN 2
            ELSE 3
          END
        LIMIT $4
      `;
      
      queryParams = [
        `%${term}%`, // Pattern for anywhere in the string
        `${term}%`,  // Pattern for starts with (higher priority)
        `%${term}`,  // Pattern for ends with (medium priority)
        limit
      ];
    }
    
    const result = await client.query(query, queryParams);
    
    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      data: result.rows
    });
    
  } catch (error) {
    console.error("Error searching users:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search users",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Delete user by ID
 * @route DELETE /api/admin/users/:id
 * @access Admin only
 */
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "User ID is required"
    });
  }
  
  let client;
  
  try {
    client = await pool.connect();
    
    // Check if user exists
    const checkQuery = `SELECT id FROM users WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Delete the user
    const deleteQuery = `DELETE FROM users WHERE id = $1`;
    await client.query(deleteQuery, [id]);
    
    return res.status(200).json({
      success: true,
      message: "User deleted successfully"
    });
    
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete user",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Ban a user
 * @route POST /api/admin/users/:id/ban
 * @access Admin only
 */
export const banUser = async (req, res) => {
  const { id } = req.params;
  const { duration, reason } = req.body;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "User ID is required"
    });
  }
  
  let client;
  let bannedUntil = null;
  
  // Calculate ban end date based on duration
  if (duration && duration !== "permanent") {
    const now = new Date();
    
    switch (duration) {
      case "24h":
        bannedUntil = new Date(now.setHours(now.getHours() + 24));
        break;
      case "3d":
        bannedUntil = new Date(now.setDate(now.getDate() + 3));
        break;
      case "1w":
        bannedUntil = new Date(now.setDate(now.getDate() + 7));
        break;
      case "1m":
        bannedUntil = new Date(now.setMonth(now.getMonth() + 1));
        break;
      default:
        // Default to 24 hours if invalid duration
        bannedUntil = new Date(now.setHours(now.getHours() + 24));
    }
  }
  
  try {
    client = await pool.connect();
    
    // Check if user exists
    const checkQuery = `SELECT id FROM users WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    // Ban the user
    const banQuery = `
      UPDATE users 
      SET is_banned = TRUE, 
          banned_until = $1, 
          ban_reason = $2
      WHERE id = $3
    `;
    
    await client.query(banQuery, [bannedUntil, reason, id]);
    
    return res.status(200).json({
      success: true,
      message: "User banned successfully",
      data: {
        is_banned: true,
        banned_until: bannedUntil,
        ban_reason: reason
      }
    });
    
  } catch (error) {
    console.error("Error banning user:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to ban user",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};

/**
 * Unban a user
 * @route POST /api/admin/users/:id/unban
 * @access Admin only
 */
export const unbanUser = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    return res.status(400).json({
      success: false,
      message: "User ID is required"
    });
  }
  
  let client;
  
  try {
    client = await pool.connect();
    
    // Check if user exists
    const checkQuery = `SELECT id, is_banned FROM users WHERE id = $1`;
    const checkResult = await client.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found"
      });
    }
    
    if (!checkResult.rows[0].is_banned) {
      return res.status(400).json({
        success: false,
        message: "User is not banned"
      });
    }
    
    // Unban the user
    const unbanQuery = `
      UPDATE users 
      SET is_banned = FALSE, 
          banned_until = NULL, 
          ban_reason = NULL
      WHERE id = $1
    `;
    
    await client.query(unbanQuery, [id]);
    
    return res.status(200).json({
      success: true,
      message: "User unbanned successfully"
    });
    
  } catch (error) {
    console.error("Error unbanning user:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to unban user",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};