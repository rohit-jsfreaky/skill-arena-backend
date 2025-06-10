import { pool } from "../db/db.js";

export const getUserNotifications = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.query;

    // Query to get both user-specific and global notifications
    const query = `
      SELECT 
        id, 
        title, 
        body, 
        image_url, 
        data, 
        user_id, 
        is_global,
        is_read,
        sent_at
      FROM notifications
      WHERE 
        (user_id = $1 OR is_global = true)
      ORDER BY sent_at DESC
      LIMIT $2 OFFSET $3
    `;

    // Count total notifications for pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM notifications
      WHERE 
        (user_id = $1 OR is_global = true)
    `;

    // Execute queries
    const result = await pool.query(query, [user_id, limit, offset]);
    const countResult = await pool.query(countQuery, [user_id]);

    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Mark retrieved notifications as read
    if (result.rows.length > 0) {
      const notificationIds = result.rows
        .filter((notification) => !notification.is_read)
        .map((notification) => notification.id);

      if (notificationIds.length > 0) {
        await pool.query(
          `UPDATE notifications 
           SET is_read = true 
           WHERE id = ANY($1)`,
          [notificationIds]
        );
      }
    }

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        total: totalCount,
        totalPages,
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error fetching notifications", error);
    res.status(500).json({ message: error.message });
  }
};

// Add function to mark a notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const { userId } = req.auth;
    const { id } = req.params;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.query;

    // Verify notification belongs to this user or is global
    const checkResult = await pool.query(
      `SELECT id FROM notifications 
       WHERE id = $1 AND (user_id = $2 OR is_global = true)`,
      [id, user_id]
    );

    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    // Mark as read
    await pool.query(`UPDATE notifications SET is_read = true WHERE id = $1`, [
      id,
    ]);

    return res
      .status(200)
      .json({ success: true, message: "Notification marked as read" });
  } catch (error) {
    console.error("Error marking notification as read", error);
    res.status(500).json({ message: error.message });
  }
};

// Add function to mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { user_id } = req.query;

    // Mark all user's notifications as read
    await pool.query(
      `UPDATE notifications 
       SET is_read = true 
       WHERE (user_id = $1 OR is_global = true) AND is_read = false`,
      [user_id]
    );

    return res
      .status(200)
      .json({ success: true, message: "All notifications marked as read" });
  } catch (error) {
    console.error("Error marking all notifications as read", error);
    res.status(500).json({ message: error.message });
  }
};



// Add this new controller function

/**
 * Get the count of unread notifications for a user
 */
export const getUnreadNotificationsCount = async (req, res) => {
    try {
      const { userId } = req.auth;
      
      if (!userId) {
        return res
          .status(401)
          .json({ 
            success: false,
            message: "Unauthorized: You need to log in." 
          });
      }

      const { user_id } = req.query;
  
      // Query to count unread notifications (both user-specific and global)
      const query = `
        SELECT COUNT(*) 
        FROM notifications
        WHERE 
          (user_id = $1 OR is_global = true)
          AND is_read = false
      `;
  
      const result = await pool.query(query, [user_id]);
      const count = parseInt(result.rows[0].count);
  
      return res.status(200).json({
        success: true,
        count: count,
        message: "Unread notification count retrieved successfully"
      });
    } catch (error) {
      console.error("Error getting unread notification count", error);
      return res.status(500).json({ 
        success: false,
        message: error.message 
      });
    }
  };