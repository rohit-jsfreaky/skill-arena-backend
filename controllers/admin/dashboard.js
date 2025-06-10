import { pool } from "../../db/db.js";

export const getDashboardStats = async (req, res) => {
  let client;
  
  try {
    client = await pool.connect();
    
    // Get total users count
    const totalUsersQuery = "SELECT COUNT(*) FROM users";
    const totalUsersResult = await client.query(totalUsersQuery);
    
    // Get active users count
    const activeUsersQuery = "SELECT COUNT(*) FROM users WHERE is_banned = FALSE OR is_banned IS NULL";
    const activeUsersResult = await client.query(activeUsersQuery);
    
    // Get banned users count
    const bannedUsersQuery = "SELECT COUNT(*) FROM users WHERE is_banned = TRUE";
    const bannedUsersResult = await client.query(bannedUsersQuery);
    
    // Get tournaments counts by status
    const tournamentsQuery = `
      SELECT status, COUNT(*) 
      FROM tournaments 
      GROUP BY status
    `;
    const tournamentsResult = await client.query(tournamentsQuery);
    
    // Process tournaments data
    const tournamentsStats = {
      total: 0,
      upcoming: 0,
      ongoing: 0,
      completed: 0
    };
    
    tournamentsResult.rows.forEach(row => {
      if (row.status === 'upcoming') tournamentsStats.upcoming = parseInt(row.count);
      else if (row.status === 'ongoing') tournamentsStats.ongoing = parseInt(row.count);
      else if (row.status === 'completed') tournamentsStats.completed = parseInt(row.count);
      
      tournamentsStats.total += parseInt(row.count);
    });
    
    // Get user registrations by date (last 30 days)
    const userRegistrationsQuery = `
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date, COUNT(*) as count
      FROM users
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;
    const userRegistrationsResult = await client.query(userRegistrationsQuery);
    
    // Get tournaments created by date (last 30 days)
    const tournamentsCreatedQuery = `
      SELECT TO_CHAR(DATE(created_at), 'YYYY-MM-DD') as date, COUNT(*) as count
      FROM tournaments
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;
    const tournamentsCreatedResult = await client.query(tournamentsCreatedQuery);
    
    // Get top 5 most active users
    const activeUsersListQuery = `
      SELECT id, username, name, profile, total_games_played, total_wins
      FROM users
      WHERE (is_banned = FALSE OR is_banned IS NULL) AND total_games_played > 0
      ORDER BY total_games_played DESC
      LIMIT 5
    `;
    const activeUsersListResult = await client.query(activeUsersListQuery);
    
    // Get recent user registrations
    const recentUsersQuery = `
      SELECT id, username, name, profile, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 5
    `;
    const recentUsersResult = await client.query(recentUsersQuery);
    
    return res.status(200).json({
      success: true,
      data: {
        users: {
          total: parseInt(totalUsersResult.rows[0].count),
          active: parseInt(activeUsersResult.rows[0].count),
          banned: parseInt(bannedUsersResult.rows[0].count),
          registrations: userRegistrationsResult.rows.map(row => ({
            date: row.date,
            count: parseInt(row.count)
          })),
          recentUsers: recentUsersResult.rows,
          topActiveUsers: activeUsersListResult.rows
        },
        tournaments: {
          ...tournamentsStats,
          created: tournamentsCreatedResult.rows.map(row => ({
            date: row.date,
            count: parseInt(row.count)
          }))
        }
      }
    });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch dashboard stats",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};