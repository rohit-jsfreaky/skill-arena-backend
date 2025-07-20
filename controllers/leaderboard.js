import { pool } from "../db/db.js";

// Helper function to check if a user has an active membership
const checkUserMembership = async (userId) => {
  try {
    const query = `
      SELECT u.membership_id, u.membership_expiry, m.name as plan_name 
      FROM users u 
      LEFT JOIN memberships m ON u.membership_id = m.id 
      WHERE u.id = $1
    `;
    const result = await pool.query(query, [userId]);

    if (!result.rows.length || !result.rows[0].membership_id) {
      return { active: false };
    }

    // Check if membership is active
    const isActive = new Date(result.rows[0].membership_expiry) > new Date();

    return {
      active: isActive,
      expiresAt: result.rows[0].membership_expiry,
      plan: {
        id: result.rows[0].membership_id,
        name: result.rows[0].plan_name,
      },
    };
  } catch (error) {
    console.error("Error checking membership:", error);
    return { active: false };
  }
};

// Get global leaderboard
export const getGlobalLeaderboard = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.query;
    
    // Validate and parse user_id
    let userIdInt = null;
    if (user_id && user_id !== 'undefined' && user_id !== 'null' && !isNaN(parseInt(user_id))) {
      userIdInt = parseInt(user_id);
    }

    // Check if user has active membership
    const membershipStatus = userIdInt ? await checkUserMembership(userIdInt) : { active: false };
    const isPro = membershipStatus.active;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const timeframe = req.query.timeframe || "all"; // 'week', 'month', 'all'

    // Create separate time constraints for tournaments and matches
    let tournamentTimeConstraint = "";
    let matchTimeConstraint = "";
    
    if (timeframe === "week") {
      tournamentTimeConstraint = "AND t.end_time >= NOW() - INTERVAL '7 days'";
      matchTimeConstraint = "AND m.end_time >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === "month") {
      tournamentTimeConstraint = "AND t.end_time >= NOW() - INTERVAL '30 days'";
      matchTimeConstraint = "AND m.end_time >= NOW() - INTERVAL '30 days'";
    }

    // Get total count for pagination
    const countQuery = `
      SELECT COUNT(DISTINCT u.id) as total
      FROM users u
      WHERE u.total_wins > 0
    `;

    const countResult = await pool.query(countQuery);
    const totalUsers = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalUsers / limit);

    // Adjust query and parameters based on membership status
    let leaderboardQuery;
    let params;

    if (isPro) {
      // Pro users get full details
      params = [limit, offset];
      leaderboardQuery = `
        WITH tournament_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
            COUNT(DISTINCT ut.tournament_id) as tournaments_joined
          FROM users u
          LEFT JOIN user_tournaments ut ON u.id = ut.user_id
          LEFT JOIN tournaments t ON ut.tournament_id = t.id
          LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
          WHERE t.status = 'completed' ${tournamentTimeConstraint}
          GROUP BY u.id
        ),
        tdm_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
            COUNT(DISTINCT m.id) as tdm_matches_joined
          FROM users u
          LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
          LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
          LEFT JOIN tdm_matches m ON tm.match_id = m.id
          WHERE m.status = 'completed' ${matchTimeConstraint}
          GROUP BY u.id
        ),
        combined_data AS (
          SELECT 
            u.id, 
            u.username, 
            u.name,
            u.profile,
            COALESCE(u.total_wins, 0) as total_wins,
            COALESCE(u.total_games_played, 0) as total_games_played,
            COALESCE(td.tournament_wins, 0) as tournament_wins,
            COALESCE(td.tournaments_joined, 0) as tournaments_joined,
            COALESCE(tdd.tdm_wins, 0) as tdm_wins,
            COALESCE(tdd.tdm_matches_joined, 0) as tdm_matches_joined,
            (
              COALESCE(td.tournament_wins, 0) * 100 + 
              COALESCE(tdd.tdm_wins, 0) * 25 +
              COALESCE(u.total_wins, 0) * 5
            ) as score
          FROM users u
          LEFT JOIN tournament_data td ON u.id = td.id
          LEFT JOIN tdm_data tdd ON u.id = tdd.id
          WHERE 
            COALESCE(td.tournament_wins, 0) > 0 OR 
            COALESCE(tdd.tdm_wins, 0) > 0 OR
            COALESCE(u.total_wins, 0) > 0
        )
        SELECT 
          cd.*,
          ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM combined_data cd
        ORDER BY score DESC
        LIMIT $1 OFFSET $2
      `;
    } else {
      // Free users get limited details - only show data if userIdInt is valid
      if (!userIdInt) {
        // If no valid user ID, show basic leaderboard without personal details
        params = [limit, offset];
        leaderboardQuery = `
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' ${matchTimeConstraint}
            GROUP BY u.id
          ),
          combined_data AS (
            SELECT 
              u.id, 
              u.username, 
              u.name,
              NULL as profile,
              NULL as total_wins,
              NULL as total_games_played,
              NULL as tournament_wins,
              NULL as tournaments_joined,
              NULL as tdm_wins,
              NULL as tdm_matches_joined,
              (
                COALESCE(td.tournament_wins, 0) * 100 + 
                COALESCE(tdd.tdm_wins, 0) * 25 +
                COALESCE(u.total_wins, 0) * 5
              ) as score
            FROM users u
            LEFT JOIN tournament_data td ON u.id = td.id
            LEFT JOIN tdm_data tdd ON u.id = tdd.id
            WHERE 
              COALESCE(td.tournament_wins, 0) > 0 OR 
              COALESCE(tdd.tdm_wins, 0) > 0 OR
              COALESCE(u.total_wins, 0) > 0
          )
          SELECT 
            cd.*,
            ROW_NUMBER() OVER (ORDER BY score DESC) as rank
          FROM combined_data cd
          ORDER BY score DESC 
          LIMIT $1 OFFSET $2
        `;
      } else {
        params = [userIdInt, limit, offset];
        leaderboardQuery = `
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' ${matchTimeConstraint}
            GROUP BY u.id
          ),
          combined_data AS (
            SELECT 
              u.id, 
              u.username, 
              u.name,
              CASE WHEN u.id = $1 THEN u.profile ELSE NULL END as profile,
              CASE WHEN u.id = $1 THEN COALESCE(u.total_wins, 0) ELSE NULL END as total_wins,
              CASE WHEN u.id = $1 THEN COALESCE(u.total_games_played, 0) ELSE NULL END as total_games_played,
              CASE WHEN u.id = $1 THEN COALESCE(td.tournament_wins, 0) ELSE NULL END as tournament_wins,
              CASE WHEN u.id = $1 THEN COALESCE(td.tournaments_joined, 0) ELSE NULL END as tournaments_joined,
              CASE WHEN u.id = $1 THEN COALESCE(tdd.tdm_wins, 0) ELSE NULL END as tdm_wins,
              CASE WHEN u.id = $1 THEN COALESCE(tdd.tdm_matches_joined, 0) ELSE NULL END as tdm_matches_joined,
              (
                COALESCE(td.tournament_wins, 0) * 100 + 
                COALESCE(tdd.tdm_wins, 0) * 25 +
                COALESCE(u.total_wins, 0) * 5
              ) as score
            FROM users u
            LEFT JOIN tournament_data td ON u.id = td.id
            LEFT JOIN tdm_data tdd ON u.id = tdd.id
            WHERE 
              COALESCE(td.tournament_wins, 0) > 0 OR 
              COALESCE(tdd.tdm_wins, 0) > 0 OR
              COALESCE(u.total_wins, 0) > 0
          )
          SELECT 
            cd.*,
            ROW_NUMBER() OVER (ORDER BY score DESC) as rank
          FROM combined_data cd
          ORDER BY score DESC
          LIMIT $2 OFFSET $3
        `;
      }
    }

    const result = await pool.query(leaderboardQuery, params);

    // Get user rank if valid user ID is provided
    let userRank = null;
    if (userIdInt) {
      const userRankResult = await pool.query(
        `
        WITH combined_data AS (
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' ${matchTimeConstraint}
            GROUP BY u.id
          )
          SELECT 
            u.id, 
            (
              COALESCE(td.tournament_wins, 0) * 100 + 
              COALESCE(tdd.tdm_wins, 0) * 25 +
              COALESCE(u.total_wins, 0) * 5
            ) as score
          FROM users u
          LEFT JOIN tournament_data td ON u.id = td.id
          LEFT JOIN tdm_data tdd ON u.id = tdd.id
          WHERE 
            COALESCE(td.tournament_wins, 0) > 0 OR 
            COALESCE(tdd.tdm_wins, 0) > 0 OR
            COALESCE(u.total_wins, 0) > 0
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM combined_data
        WHERE id = $1
      `,
        [userIdInt]
      );

      if (userRankResult.rows.length > 0) {
        userRank = userRankResult.rows[0].rank;
      }
    }

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
      user_rank: userRank,
      isPro: isPro
    });
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch leaderboard data",
      error: error.message,
    });
  }
};

// Apply the same fix to getGameLeaderboard function
export const getGameLeaderboard = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { gameId } = req.params;
    const { user_id } = req.query;

    // Validate and parse user_id
    let userIdInt = null;
    if (user_id && user_id !== 'undefined' && user_id !== 'null' && !isNaN(parseInt(user_id))) {
      userIdInt = parseInt(user_id);
    }

    const membershipStatus = userIdInt ? await checkUserMembership(userIdInt) : { active: false };
    const isPro = membershipStatus.active;

    if (!gameId) {
      return res.status(400).json({ message: "Game ID is required" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const timeframe = req.query.timeframe || "all";

    // Create separate time constraints for tournaments and matches
    let tournamentTimeConstraint = "";
    let matchTimeConstraint = "";
    
    if (timeframe === "week") {
      tournamentTimeConstraint = "AND t.end_time >= NOW() - INTERVAL '7 days'";
      matchTimeConstraint = "AND m.end_time >= NOW() - INTERVAL '7 days'";
    } else if (timeframe === "month") {
      tournamentTimeConstraint = "AND t.end_time >= NOW() - INTERVAL '30 days'";
      matchTimeConstraint = "AND m.end_time >= NOW() - INTERVAL '30 days'";
    }

    // Get game name
    const gameResult = await pool.query(
      `SELECT name FROM games WHERE id = $1`,
      [gameId]
    );

    if (gameResult.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    const gameName = gameResult.rows[0].name;

    // Get total count for pagination
    const countQuery = `
      WITH tournament_players AS (
        SELECT DISTINCT u.id
        FROM users u
        JOIN user_tournaments ut ON u.id = ut.user_id
        JOIN tournaments t ON ut.tournament_id = t.id
        WHERE t.game_name = $1
      ),
      tdm_players AS (
        SELECT DISTINCT u.id
        FROM users u
        JOIN tdm_team_members ttm ON u.id = ttm.user_id
        JOIN tdm_teams tm ON ttm.team_id = tm.id
        JOIN tdm_matches m ON tm.match_id = m.id
        WHERE m.game_name = $1
      )
      SELECT COUNT(DISTINCT id) as total
      FROM (
        SELECT id FROM tournament_players
        UNION
        SELECT id FROM tdm_players
      ) as combined_players
    `;

    const countResult = await pool.query(countQuery, [gameName]);
    const totalUsers = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(totalUsers / limit);

    // Adjust query and parameters based on membership status
    let leaderboardQuery;
    let params;

    if (isPro) {
      params = [gameName, limit, offset];
      // Pro query remains the same...
      leaderboardQuery = `
        WITH tournament_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
            COUNT(DISTINCT ut.tournament_id) as tournaments_joined
          FROM users u
          LEFT JOIN user_tournaments ut ON u.id = ut.user_id
          LEFT JOIN tournaments t ON ut.tournament_id = t.id
          LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
          WHERE t.status = 'completed' AND t.game_name = $1 ${tournamentTimeConstraint}
          GROUP BY u.id
        ),
        tdm_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
            COUNT(DISTINCT m.id) as tdm_matches_joined
          FROM users u
          LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
          LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
          LEFT JOIN tdm_matches m ON tm.match_id = m.id
          WHERE m.status = 'completed' AND m.game_name = $1 ${matchTimeConstraint}
          GROUP BY u.id
        ),
        combined_data AS (
          SELECT 
            u.id, 
            u.username, 
            u.name,
            u.profile,
            COALESCE(td.tournament_wins, 0) as tournament_wins,
            COALESCE(td.tournaments_joined, 0) as tournaments_joined,
            COALESCE(tdd.tdm_wins, 0) as tdm_wins,
            COALESCE(tdd.tdm_matches_joined, 0) as tdm_matches_joined,
            (
              COALESCE(td.tournament_wins, 0) * 100 + 
              COALESCE(tdd.tdm_wins, 0) * 25
            ) as score
          FROM users u
          LEFT JOIN tournament_data td ON u.id = td.id
          LEFT JOIN tdm_data tdd ON u.id = tdd.id
          WHERE 
            COALESCE(td.tournament_wins, 0) > 0 OR 
            COALESCE(tdd.tdm_wins, 0) > 0 OR
            COALESCE(td.tournaments_joined, 0) > 0 OR
            COALESCE(tdd.tdm_matches_joined, 0) > 0
        )
        SELECT 
          cd.*,
          ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM combined_data cd
        ORDER BY score DESC
        LIMIT $2 OFFSET $3
      `;
    } else {
      if (!userIdInt) {
        params = [gameName, limit, offset];
        leaderboardQuery = `
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' AND t.game_name = $1 ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' AND m.game_name = $1 ${matchTimeConstraint}
            GROUP BY u.id
          ),
          combined_data AS (
            SELECT 
              u.id, 
              u.username, 
              u.name,
              NULL as profile,
              NULL as tournament_wins,
              NULL as tournaments_joined,
              NULL as tdm_wins,
              NULL as tdm_matches_joined,
              (
                COALESCE(td.tournament_wins, 0) * 100 + 
                COALESCE(tdd.tdm_wins, 0) * 25
              ) as score
            FROM users u
            LEFT JOIN tournament_data td ON u.id = td.id
            LEFT JOIN tdm_data tdd ON u.id = tdd.id
            WHERE 
              COALESCE(td.tournament_wins, 0) > 0 OR 
              COALESCE(tdd.tdm_wins, 0) > 0 OR
              COALESCE(td.tournaments_joined, 0) > 0 OR
              COALESCE(tdd.tdm_matches_joined, 0) > 0
          )
          SELECT 
            cd.*,
            ROW_NUMBER() OVER (ORDER BY score DESC) as rank
          FROM combined_data cd
          ORDER BY score DESC
          LIMIT $2 OFFSET $3
        `;
      } else {
        params = [gameName, userIdInt, limit, offset];
        leaderboardQuery = `
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' AND t.game_name = $1 ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' AND m.game_name = $1 ${matchTimeConstraint}
            GROUP BY u.id
          ),
          combined_data AS (
            SELECT 
              u.id, 
              u.username, 
              u.name,
              CASE WHEN u.id = $2 THEN u.profile ELSE NULL END as profile,
              CASE WHEN u.id = $2 THEN COALESCE(td.tournament_wins, 0) ELSE NULL END as tournament_wins,
              CASE WHEN u.id = $2 THEN COALESCE(td.tournaments_joined, 0) ELSE NULL END as tournaments_joined,
              CASE WHEN u.id = $2 THEN COALESCE(tdd.tdm_wins, 0) ELSE NULL END as tdm_wins,
              CASE WHEN u.id = $2 THEN COALESCE(tdd.tdm_matches_joined, 0) ELSE NULL END as tdm_matches_joined,
              (
                COALESCE(td.tournament_wins, 0) * 100 + 
                COALESCE(tdd.tdm_wins, 0) * 25
              ) as score
            FROM users u
            LEFT JOIN tournament_data td ON u.id = td.id
            LEFT JOIN tdm_data tdd ON u.id = tdd.id
            WHERE 
              COALESCE(td.tournament_wins, 0) > 0 OR 
              COALESCE(tdd.tdm_wins, 0) > 0 OR
              COALESCE(td.tournaments_joined, 0) > 0 OR
              COALESCE(tdd.tdm_matches_joined, 0) > 0
          )
          SELECT 
            cd.*,
            ROW_NUMBER() OVER (ORDER BY score DESC) as rank
          FROM combined_data cd
          ORDER BY score DESC
          LIMIT $3 OFFSET $4
        `;
      }
    }

    const result = await pool.query(leaderboardQuery, params);

    // Get user's game rank if valid user ID is provided
    let userRank = null;
    if (userIdInt) {
      const userRankQuery = `
        WITH combined_data AS (
          WITH tournament_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
              COUNT(DISTINCT ut.tournament_id) as tournaments_joined
            FROM users u
            LEFT JOIN user_tournaments ut ON u.id = ut.user_id
            LEFT JOIN tournaments t ON ut.tournament_id = t.id
            LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
            WHERE t.status = 'completed' AND t.game_name = $1 ${tournamentTimeConstraint}
            GROUP BY u.id
          ),
          tdm_data AS (
            SELECT 
              u.id,
              COUNT(DISTINCT CASE WHEN m.winner_team_id = tm.id THEN m.id END) as tdm_wins,
              COUNT(DISTINCT m.id) as tdm_matches_joined
            FROM users u
            LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
            LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
            LEFT JOIN tdm_matches m ON tm.match_id = m.id
            WHERE m.status = 'completed' AND m.game_name = $1 ${matchTimeConstraint}
            GROUP BY u.id
          )
          SELECT 
            u.id, 
            (
              COALESCE(td.tournament_wins, 0) * 100 + 
              COALESCE(tdd.tdm_wins, 0) * 25
            ) as score
          FROM users u
          LEFT JOIN tournament_data td ON u.id = td.id
          LEFT JOIN tdm_data tdd ON u.id = tdd.id
          WHERE 
            COALESCE(td.tournament_wins, 0) > 0 OR 
            COALESCE(tdd.tdm_wins, 0) > 0 OR
            COALESCE(td.tournaments_joined, 0) > 0 OR
            COALESCE(tdd.tdm_matches_joined, 0) > 0
        )
        SELECT 
          ROW_NUMBER() OVER (ORDER BY score DESC) as rank
        FROM combined_data
        WHERE id = $2
      `;

      const userRankResult = await pool.query(userRankQuery, [gameName, userIdInt]);
      if (userRankResult.rows.length > 0) {
        userRank = userRankResult.rows[0].rank;
      }
    }

    return res.status(200).json({
      success: true,
      game: {
        id: gameId,
        name: gameName,
      },
      data: result.rows,
      pagination: {
        totalUsers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      user_rank: userRank,
      isPro: isPro
    });
  } catch (error) {
    console.error("Error fetching game leaderboard:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch game leaderboard data",
      error: error.message,
    });
  }
};

// Keep the getUserLeaderboardStats function as is, but also apply the same user_id validation
export const getUserLeaderboardStats = async (req, res) => {
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.params;
    
    // Validate and parse user_id
    let targetUserId = null;
    if (user_id && user_id !== 'undefined' && user_id !== 'null' && !isNaN(parseInt(user_id))) {
      targetUserId = parseInt(user_id);
    } else {
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    const membershipStatus = await checkUserMembership(targetUserId);
    const isPro = membershipStatus.active;

    // Check if viewing own profile or has membership to view others
    const isOwnProfile = parseInt(userId) === targetUserId;

    if (!isOwnProfile && !isPro) {
      return res.status(403).json({
        success: false,
        message: "Pro membership required to view detailed statistics of other users",
        requiresPro: true,
      });
    }

    // Rest of the function remains the same...
    const userStatsQuery = `
      WITH tournament_data AS (
        SELECT 
          COUNT(DISTINCT CASE WHEN tr.winner_id = $1 THEN t.id END) as tournament_wins,
          COUNT(DISTINCT ut.tournament_id) as tournaments_joined
        FROM user_tournaments ut 
        JOIN tournaments t ON ut.tournament_id = t.id
        LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
        WHERE ut.user_id = $1 AND t.status = 'completed'
      ),
      tdm_data AS (
        SELECT 
          COUNT(DISTINCT CASE WHEN m.winner_team_id = ttm.team_id THEN m.id END) as tdm_wins,
          COUNT(DISTINCT m.id) as tdm_matches_joined
        FROM tdm_team_members ttm
        JOIN tdm_teams tm ON ttm.team_id = tm.id
        JOIN tdm_matches m ON tm.match_id = m.id
        WHERE ttm.user_id = $1 AND m.status = 'completed'
      ),
      game_stats AS (
        SELECT 
          COALESCE(t.game_name, m.game_name) as game_name,
          COUNT(DISTINCT CASE WHEN tr.winner_id = $1 THEN t.id END) as tournament_wins,
          COUNT(DISTINCT CASE WHEN t.id IS NOT NULL THEN t.id END) as tournaments_joined,
          COUNT(DISTINCT CASE WHEN m.winner_team_id = ttm.team_id THEN m.id END) as tdm_wins,
          COUNT(DISTINCT CASE WHEN m.id IS NOT NULL THEN m.id END) as tdm_matches_joined
        FROM users u
        LEFT JOIN user_tournaments ut ON u.id = ut.user_id
        LEFT JOIN tournaments t ON ut.tournament_id = t.id AND t.status = 'completed'
        LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
        LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
        LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
        LEFT JOIN tdm_matches m ON tm.match_id = m.id AND m.status = 'completed'
        WHERE u.id = $1
        GROUP BY COALESCE(t.game_name, m.game_name)
        HAVING COALESCE(t.game_name, m.game_name) IS NOT NULL
      )
      SELECT 
        u.id, 
        u.username, 
        u.name,
        u.profile,
        u.total_wins,
        u.total_games_played,
        td.tournament_wins,
        td.tournaments_joined,
        tdd.tdm_wins,
        tdd.tdm_matches_joined,
        (
          COALESCE(td.tournament_wins, 0) * 100 + 
          COALESCE(tdd.tdm_wins, 0) * 25 +
          COALESCE(u.total_wins, 0) * 5
        ) as score,
        (
          SELECT json_agg(
            json_build_object(
              'game_name', gs.game_name,
              'tournament_wins', gs.tournament_wins,
              'tournaments_joined', gs.tournaments_joined,
              'tdm_wins', gs.tdm_wins,
              'tdm_matches_joined', gs.tdm_matches_joined
            )
          )
          FROM game_stats gs
        ) as games
      FROM users u
      CROSS JOIN tournament_data td
      CROSS JOIN tdm_data tdd
      WHERE u.id = $1
    `;

    const userStats = await pool.query(userStatsQuery, [targetUserId]);

    if (userStats.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get user's global rank
    const userRankQuery = `
      WITH combined_data AS (
        WITH tournament_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN tr.winner_id = u.id THEN t.id END) as tournament_wins,
            COUNT(DISTINCT ut.tournament_id) as tournaments_joined
          FROM users u
          LEFT JOIN user_tournaments ut ON u.id = ut.user_id
          LEFT JOIN tournaments t ON ut.tournament_id = t.id
          LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
          WHERE t.status = 'completed'
          GROUP BY u.id
        ),
        tdm_data AS (
          SELECT 
            u.id,
            COUNT(DISTINCT CASE WHEN m.winner_team_id = ttm.team_id THEN m.id END) as tdm_wins,
            COUNT(DISTINCT m.id) as tdm_matches_joined
          FROM users u
          LEFT JOIN tdm_team_members ttm ON u.id = ttm.user_id
          LEFT JOIN tdm_teams tm ON ttm.team_id = tm.id
          LEFT JOIN tdm_matches m ON tm.match_id = m.id
          WHERE m.status = 'completed'
          GROUP BY u.id
        )
        SELECT 
          u.id, 
          (
            COALESCE(td.tournament_wins, 0) * 100 + 
            COALESCE(tdd.tdm_wins, 0) * 25 +
            COALESCE(u.total_wins, 0) * 5
          ) as score
        FROM users u
        LEFT JOIN tournament_data td ON u.id = td.id
        LEFT JOIN tdm_data tdd ON u.id = tdd.id
        WHERE 
          COALESCE(td.tournament_wins, 0) > 0 OR 
          COALESCE(tdd.tdm_wins, 0) > 0 OR
          COALESCE(u.total_wins, 0) > 0
      )
      SELECT 
        ROW_NUMBER() OVER (ORDER BY score DESC) as rank
      FROM combined_data
      WHERE id = $1
    `;

    const userRank = await pool.query(userRankQuery, [targetUserId]);

    const userData = {
      ...userStats.rows[0],
      global_rank: userRank.rows.length > 0 ? userRank.rows[0].rank : null,
    };

    return res.status(200).json({
      success: true,
      data: userData,
      isPro: isPro,
      isOwnProfile: isOwnProfile,
    });
  } catch (error) {
    console.error("Error fetching user's leaderboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user's leaderboard statistics",
      error: error.message,
    });
  }
};
