import { pool } from "../../db/db.js";

// Get all users with their leaderboard stats
export const getAllUsersLeaderboardStats = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const sortBy = req.query.sortBy || 'total_kills';
    const sortOrder = req.query.sortOrder || 'DESC';
    const offset = (page - 1) * limit;

    let searchCondition = '';
    let searchParams = [];
    
    if (search) {
      searchCondition = `WHERE (u.username ILIKE $1 OR u.name ILIKE $1 OR u.id::text = $1)`;
      searchParams = [`%${search}%`];
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*)
      FROM users u
      LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
      ${searchCondition}
    `;
    
    const countResult = await pool.query(countQuery, searchParams);
    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    // Get users with stats
    const usersQuery = `
      SELECT 
        u.id,
        u.username,
        u.name,
        u.email,
        u.profile,
        u.total_games_played,
        u.total_wins,
        uls.total_kills,
        uls.total_deaths,
        uls.kill_death_ratio,
        uls.headshots,
        uls.assists,
        uls.damage_dealt,
        uls.accuracy_percentage,
        uls.mvp_count,
        uls.longest_killstreak,
        uls.favorite_weapon,
        uls.playtime_hours,
        uls.rank_points,
        uls.season_rank,
        uls.updated_at
      FROM users u
      LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
      ${searchCondition}
      ORDER BY 
        CASE WHEN $${searchParams.length + 1} = 'username' THEN u.username END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'name' THEN u.name END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'total_kills' THEN COALESCE(uls.total_kills, 0) END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'total_deaths' THEN COALESCE(uls.total_deaths, 0) END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'kill_death_ratio' THEN COALESCE(uls.kill_death_ratio, 0) END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'rank_points' THEN COALESCE(uls.rank_points, 0) END ${sortOrder},
        CASE WHEN $${searchParams.length + 1} = 'total_wins' THEN COALESCE(u.total_wins, 0) END ${sortOrder}
      LIMIT $${searchParams.length + 2} OFFSET $${searchParams.length + 3}
    `;

    const params = [...searchParams, sortBy, limit, offset];
    const result = await pool.query(usersQuery, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching users leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard stats",
      error: error.message,
    });
  }
};

// Get specific user's leaderboard stats
export const getUserLeaderboardStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      SELECT 
        u.id,
        u.username,
        u.name,
        u.email,
        u.profile,
        u.total_games_played,
        u.total_wins,
        uls.total_kills,
        uls.total_deaths,
        uls.kill_death_ratio,
        uls.headshots,
        uls.assists,
        uls.damage_dealt,
        uls.accuracy_percentage,
        uls.mvp_count,
        uls.longest_killstreak,
        uls.favorite_weapon,
        uls.playtime_hours,
        uls.rank_points,
        uls.season_rank,
        uls.created_at,
        uls.updated_at
      FROM users u
      LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
      WHERE u.id = $1
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching user leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user stats",
      error: error.message,
    });
  }
};

// Update user's leaderboard stats
export const updateUserLeaderboardStats = async (req, res) => {
  try {
    const { userId } = req.params;
    const {
      total_kills,
      total_deaths,
      headshots,
      assists,
      damage_dealt,
      accuracy_percentage,
      mvp_count,
      longest_killstreak,
      favorite_weapon,
      playtime_hours,
      rank_points,
      season_rank,
    } = req.body;

    // Validate input ranges
    const validationErrors = [];
    
    if (accuracy_percentage !== undefined && (accuracy_percentage < 0 || accuracy_percentage > 100)) {
      validationErrors.push("Accuracy percentage must be between 0 and 100");
    }
    
    if (total_kills !== undefined && (total_kills < 0 || total_kills > 1000000)) {
      validationErrors.push("Total kills must be between 0 and 1,000,000");
    }
    
    if (total_deaths !== undefined && (total_deaths < 0 || total_deaths > 1000000)) {
      validationErrors.push("Total deaths must be between 0 and 1,000,000");
    }
    
    if (playtime_hours !== undefined && (playtime_hours < 0 || playtime_hours > 100000)) {
      validationErrors.push("Playtime hours must be between 0 and 100,000");
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation errors",
        errors: validationErrors,
      });
    }

    // First, check if the user exists
    const userCheck = await pool.query("SELECT id FROM users WHERE id = $1", [userId]);
    if (userCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Insert or update leaderboard stats
    const upsertQuery = `
      INSERT INTO user_leaderboard_stats (
        user_id, total_kills, total_deaths, headshots, assists, 
        damage_dealt, accuracy_percentage, mvp_count, longest_killstreak,
        favorite_weapon, playtime_hours, rank_points, season_rank
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      ON CONFLICT (user_id) 
      DO UPDATE SET
        total_kills = EXCLUDED.total_kills,
        total_deaths = EXCLUDED.total_deaths,
        headshots = EXCLUDED.headshots,
        assists = EXCLUDED.assists,
        damage_dealt = EXCLUDED.damage_dealt,
        accuracy_percentage = EXCLUDED.accuracy_percentage,
        mvp_count = EXCLUDED.mvp_count,
        longest_killstreak = EXCLUDED.longest_killstreak,
        favorite_weapon = EXCLUDED.favorite_weapon,
        playtime_hours = EXCLUDED.playtime_hours,
        rank_points = EXCLUDED.rank_points,
        season_rank = EXCLUDED.season_rank,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `;

    const values = [
      userId,
      total_kills || 0,
      total_deaths || 0,
      headshots || 0,
      assists || 0,
      damage_dealt || 0,
      accuracy_percentage || 0,
      mvp_count || 0,
      longest_killstreak || 0,
      favorite_weapon || null,
      playtime_hours || 0,
      rank_points || 0,
      season_rank || 'Unranked',
    ];

    const result = await pool.query(upsertQuery, values);

    return res.status(200).json({
      success: true,
      message: "User leaderboard stats updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating user leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update leaderboard stats",
      error: error.message,
    });
  }
};

// Bulk update multiple users' stats
export const bulkUpdateLeaderboardStats = async (req, res) => {
  try {
    const { users } = req.body; // Array of user updates

    if (!Array.isArray(users) || users.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid input: users array is required",
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const results = [];
      
      for (const userData of users) {
        const {
          user_id,
          total_kills,
          total_deaths,
          headshots,
          assists,
          damage_dealt,
          accuracy_percentage,
          mvp_count,
          longest_killstreak,
          favorite_weapon,
          playtime_hours,
          rank_points,
          season_rank,
        } = userData;

        const upsertQuery = `
          INSERT INTO user_leaderboard_stats (
            user_id, total_kills, total_deaths, headshots, assists, 
            damage_dealt, accuracy_percentage, mvp_count, longest_killstreak,
            favorite_weapon, playtime_hours, rank_points, season_rank
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (user_id) 
          DO UPDATE SET
            total_kills = EXCLUDED.total_kills,
            total_deaths = EXCLUDED.total_deaths,
            headshots = EXCLUDED.headshots,
            assists = EXCLUDED.assists,
            damage_dealt = EXCLUDED.damage_dealt,
            accuracy_percentage = EXCLUDED.accuracy_percentage,
            mvp_count = EXCLUDED.mvp_count,
            longest_killstreak = EXCLUDED.longest_killstreak,
            favorite_weapon = EXCLUDED.favorite_weapon,
            playtime_hours = EXCLUDED.playtime_hours,
            rank_points = EXCLUDED.rank_points,
            season_rank = EXCLUDED.season_rank,
            updated_at = CURRENT_TIMESTAMP
          RETURNING *
        `;

        const values = [
          user_id,
          total_kills || 0,
          total_deaths || 0,
          headshots || 0,
          assists || 0,
          damage_dealt || 0,
          accuracy_percentage || 0,
          mvp_count || 0,
          longest_killstreak || 0,
          favorite_weapon || null,
          playtime_hours || 0,
          rank_points || 0,
          season_rank || 'Unranked',
        ];

        const result = await client.query(upsertQuery, values);
        results.push(result.rows[0]);
      }

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: `Successfully updated ${results.length} users' leaderboard stats`,
        data: results,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error bulk updating leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to bulk update leaderboard stats",
      error: error.message,
    });
  }
};

// Reset user's leaderboard stats
export const resetUserLeaderboardStats = async (req, res) => {
  try {
    const { userId } = req.params;

    const query = `
      UPDATE user_leaderboard_stats 
      SET 
        total_kills = 0,
        total_deaths = 0,
        kill_death_ratio = 0,
        headshots = 0,
        assists = 0,
        damage_dealt = 0,
        accuracy_percentage = 0,
        mvp_count = 0,
        longest_killstreak = 0,
        favorite_weapon = NULL,
        playtime_hours = 0,
        rank_points = 0,
        season_rank = 'Unranked',
        updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $1
      RETURNING *
    `;

    const result = await pool.query(query, [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User leaderboard stats not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "User leaderboard stats reset successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error resetting user leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to reset leaderboard stats",
      error: error.message,
    });
  }
};

// Get leaderboard rankings
export const getLeaderboardRankings = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const sortBy = req.query.sortBy || 'rank_points';
    const offset = (page - 1) * limit;

    const query = `
      WITH ranked_users AS (
        SELECT 
          u.id,
          u.username,
          u.name,
          u.profile,
          u.total_games_played,
          u.total_wins,
          uls.total_kills,
          uls.total_deaths,
          uls.kill_death_ratio,
          uls.headshots,
          uls.assists,
          uls.damage_dealt,
          uls.accuracy_percentage,
          uls.mvp_count,
          uls.longest_killstreak,
          uls.favorite_weapon,
          uls.playtime_hours,
          uls.rank_points,
          uls.season_rank,
          ROW_NUMBER() OVER (
            ORDER BY 
              CASE WHEN $1 = 'rank_points' THEN uls.rank_points END DESC,
              CASE WHEN $1 = 'total_kills' THEN uls.total_kills END DESC,
              CASE WHEN $1 = 'kill_death_ratio' THEN uls.kill_death_ratio END DESC,
              CASE WHEN $1 = 'total_wins' THEN u.total_wins END DESC,
              u.id
          ) as rank
        FROM users u
        LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
        WHERE uls.user_id IS NOT NULL
      )
      SELECT * FROM ranked_users
      ORDER BY rank
      LIMIT $2 OFFSET $3
    `;

    const result = await pool.query(query, [sortBy, limit, offset]);

    // Get total count
    const countQuery = `
      SELECT COUNT(*) 
      FROM users u
      LEFT JOIN user_leaderboard_stats uls ON u.id = uls.user_id
      WHERE uls.user_id IS NOT NULL
    `;
    const countResult = await pool.query(countQuery);
    const totalUsers = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalUsers / limit);

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Error fetching leaderboard rankings:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard rankings",
      error: error.message,
    });
  }
};