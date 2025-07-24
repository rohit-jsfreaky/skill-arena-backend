import { pool } from "../../db/db.js";

// Get all platform statistics for admin
export const getAllPlatformStats = async (req, res) => {
  try {
    const query = `
      SELECT * FROM platform_statistics 
      ORDER BY display_order ASC, created_at ASC
    `;
    
    const result = await pool.query(query);
    
    return res.status(200).json({
      success: true,
      message: "Platform statistics fetched successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching platform statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform statistics",
      error: error.message,
    });
  }
};

// Get specific platform statistic
export const getPlatformStat = async (req, res) => {
  try {
    const { id } = req.params;
    
    const query = `SELECT * FROM platform_statistics WHERE id = $1`;
    const result = await pool.query(query, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform statistic not found",
      });
    }
    
    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching platform statistic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform statistic",
      error: error.message,
    });
  }
};

// Create new platform statistic
export const createPlatformStat = async (req, res) => {
  try {
    const {
      stat_key,
      stat_value,
      stat_label,
      stat_description,
      display_order,
      is_active,
      icon,
      format_type,
    } = req.body;

    // Validation
    if (!stat_key || !stat_label) {
      return res.status(400).json({
        success: false,
        message: "stat_key and stat_label are required",
      });
    }

    const query = `
      INSERT INTO platform_statistics 
      (stat_key, stat_value, stat_label, stat_description, display_order, is_active, icon, format_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;

    const values = [
      stat_key,
      stat_value || 0,
      stat_label,
      stat_description || null,
      display_order || 0,
      is_active !== undefined ? is_active : true,
      icon || null,
      format_type || 'number',
    ];

    const result = await pool.query(query, values);

    return res.status(201).json({
      success: true,
      message: "Platform statistic created successfully",
      data: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({
        success: false,
        message: "A statistic with this key already exists",
      });
    }
    
    console.error("Error creating platform statistic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create platform statistic",
      error: error.message,
    });
  }
};

// Update platform statistic
export const updatePlatformStat = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      stat_key,
      stat_value,
      stat_label,
      stat_description,
      display_order,
      is_active,
      icon,
      format_type,
    } = req.body;

    // Check if statistic exists
    const checkQuery = `SELECT id FROM platform_statistics WHERE id = $1`;
    const checkResult = await pool.query(checkQuery, [id]);
    
    if (checkResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform statistic not found",
      });
    }

    const query = `
      UPDATE platform_statistics 
      SET 
        stat_key = COALESCE($1, stat_key),
        stat_value = COALESCE($2, stat_value),
        stat_label = COALESCE($3, stat_label),
        stat_description = COALESCE($4, stat_description),
        display_order = COALESCE($5, display_order),
        is_active = COALESCE($6, is_active),
        icon = COALESCE($7, icon),
        format_type = COALESCE($8, format_type),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING *
    `;

    const values = [
      stat_key,
      stat_value,
      stat_label,
      stat_description,
      display_order,
      is_active,
      icon,
      format_type,
      id,
    ];

    const result = await pool.query(query, values);

    return res.status(200).json({
      success: true,
      message: "Platform statistic updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    if (error.code === '23505') { // Unique constraint violation
      return res.status(400).json({
        success: false,
        message: "A statistic with this key already exists",
      });
    }
    
    console.error("Error updating platform statistic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update platform statistic",
      error: error.message,
    });
  }
};

// Delete platform statistic
export const deletePlatformStat = async (req, res) => {
  try {
    const { id } = req.params;

    const query = `DELETE FROM platform_statistics WHERE id = $1 RETURNING *`;
    const result = await pool.query(query, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform statistic not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Platform statistic deleted successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error deleting platform statistic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete platform statistic",
      error: error.message,
    });
  }
};

// Bulk update statistics (useful for updating multiple stats at once)
export const bulkUpdatePlatformStats = async (req, res) => {
  try {
    const { statistics } = req.body;

    if (!Array.isArray(statistics) || statistics.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Statistics array is required",
      });
    }

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      const results = [];
      
      for (const stat of statistics) {
        const { id, stat_value } = stat;
        
        if (!id || stat_value === undefined) {
          continue; // Skip invalid entries
        }

        const updateQuery = `
          UPDATE platform_statistics 
          SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
          WHERE id = $2 
          RETURNING *
        `;
        
        const result = await client.query(updateQuery, [stat_value, id]);
        if (result.rows.length > 0) {
          results.push(result.rows[0]);
        }
      }

      await client.query('COMMIT');

      return res.status(200).json({
        success: true,
        message: `Successfully updated ${results.length} statistics`,
        data: results,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error bulk updating platform statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to bulk update platform statistics",
      error: error.message,
    });
  }
};

// Auto-update certain statistics based on actual data
export const autoUpdatePlatformStats = async (req, res) => {
  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');

      // Update total players
      const playersQuery = `SELECT COUNT(*) as count FROM users`;
      const playersResult = await client.query(playersQuery);
      const totalPlayers = playersResult.rows[0].count;

      await client.query(`
        UPDATE platform_statistics 
        SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE stat_key = 'total_players'
      `, [totalPlayers]);

      // Update total tournaments
      const tournamentsQuery = `SELECT COUNT(*) as count FROM tournaments`;
      const tournamentsResult = await client.query(tournamentsQuery);
      const totalTournaments = tournamentsResult.rows[0].count;

      await client.query(`
        UPDATE platform_statistics 
        SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE stat_key = 'total_tournaments'
      `, [totalTournaments]);

      // Update active tournaments
      const activeTournamentsQuery = `SELECT COUNT(*) as count FROM tournaments WHERE status IN ('upcoming', 'ongoing')`;
      const activeTournamentsResult = await client.query(activeTournamentsQuery);
      const activeTournaments = activeTournamentsResult.rows[0].count;

      await client.query(`
        UPDATE platform_statistics 
        SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE stat_key = 'active_tournaments'
      `, [activeTournaments]);

      // Update total matches (tournaments + TDM matches)
      const tournamentsMatchesQuery = `SELECT COUNT(*) as count FROM tournaments WHERE status = 'completed'`;
      const tdmMatchesQuery = `SELECT COUNT(*) as count FROM tdm_matches WHERE status = 'completed'`;
      
      const tournamentsMatchesResult = await client.query(tournamentsMatchesQuery);
      const tdmMatchesResult = await client.query(tdmMatchesQuery);
      
      const totalMatches = parseInt(tournamentsMatchesResult.rows[0].count) + parseInt(tdmMatchesResult.rows[0].count);

      await client.query(`
        UPDATE platform_statistics 
        SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE stat_key = 'total_matches'
      `, [totalMatches]);

      // Update total prizes distributed (sum of completed tournament prize pools)
      const prizesQuery = `
        SELECT COALESCE(SUM(prize_pool), 0) as total 
        FROM tournaments 
        WHERE status = 'completed'
      `;
      const prizesResult = await client.query(prizesQuery);
      const totalPrizes = prizesResult.rows[0].total;

      await client.query(`
        UPDATE platform_statistics 
        SET stat_value = $1, updated_at = CURRENT_TIMESTAMP 
        WHERE stat_key = 'total_prizes'
      `, [totalPrizes]);

      await client.query('COMMIT');

      // Get updated statistics
      const updatedStatsQuery = `SELECT * FROM platform_statistics ORDER BY display_order ASC`;
      const updatedStatsResult = await client.query(updatedStatsQuery);

      return res.status(200).json({
        success: true,
        message: "Platform statistics auto-updated successfully",
        data: updatedStatsResult.rows,
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error auto-updating platform statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to auto-update platform statistics",
      error: error.message,
    });
  }
};
