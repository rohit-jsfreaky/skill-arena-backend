import { pool } from "../db/db.js";

// Get public platform statistics for users
export const getPublicPlatformStats = async (req, res) => {
  try {
    const query = `
      SELECT 
        id,
        stat_key,
        stat_value,
        stat_label,
        stat_description,
        display_order,
        icon,
        format_type
      FROM platform_statistics 
      WHERE is_active = true
      ORDER BY display_order ASC, created_at ASC
    `;
    
    const result = await pool.query(query);
    
    return res.status(200).json({
      success: true,
      message: "Platform statistics fetched successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching public platform statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform statistics",
      error: error.message,
    });
  }
};

// Get specific public platform statistic by key
export const getPublicPlatformStatByKey = async (req, res) => {
  try {
    const { key } = req.params;
    
    const query = `
      SELECT 
        id,
        stat_key,
        stat_value,
        stat_label,
        stat_description,
        display_order,
        icon,
        format_type
      FROM platform_statistics 
      WHERE stat_key = $1 AND is_active = true
    `;
    
    const result = await pool.query(query, [key]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Platform statistic not found or inactive",
      });
    }
    
    return res.status(200).json({
      success: true,
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error fetching public platform statistic:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch platform statistic",
      error: error.message,
    });
  }
};

// Get banner statistics (first 4-6 most important stats for homepage banner)
export const getBannerStats = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 6;
    
    const query = `
      SELECT 
        id,
        stat_key,
        stat_value,
        stat_label,
        stat_description,
        display_order,
        icon,
        format_type
      FROM platform_statistics 
      WHERE is_active = true
      ORDER BY display_order ASC
      LIMIT $1
    `;
    
    const result = await pool.query(query, [limit]);
    
    return res.status(200).json({
      success: true,
      message: "Banner statistics fetched successfully",
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching banner statistics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch banner statistics",
      error: error.message,
    });
  }
};
