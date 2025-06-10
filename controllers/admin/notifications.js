import { pool } from "../../db/db.js";
import firebaseAdmin from "../../utils/firebase.js";

// Send notification to a specific user
export const sendUserNotification = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = 0
    const { user_id, title, body, image_url, data } = req.body;

    if (!user_id || !title || !body) {
      return res.status(400).json({
        success: false,
        message:
          "Missing required fields: user_id, title, and body are required",
      });
    }

    await client.query("BEGIN");

    // Get user's FCM tokens
    const tokensResult = await client.query(
      "SELECT device_token FROM fcm_tokens WHERE user_id = $1",
      [user_id]
    );

    const tokens = tokensResult.rows.map((row) => row.device_token);

    if (tokens.length === 0) {
      await client.query("COMMIT");
      return res.status(404).json({
        success: false,
        message: "No device tokens found for this user",
      });
    }

    // Store notification in database
    const notificationResult = await client.query(
      `INSERT INTO notifications 
       (title, body, image_url, data, user_id, is_global, sent_by) 
       VALUES ($1, $2, $3, $4, $5, false, $6) 
       RETURNING id`,
      [title, body, image_url, data || {}, user_id, userId]
    );

    const notificationId = notificationResult.rows[0].id;

    // Prepare notification message
    const message = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        notification_id: notificationId.toString(),
      },
      tokens: tokens,
    };

    // Add image if provided
    if (image_url) {
      message.notification.imageUrl = image_url;
    }

    // Send message through Firebase
    const response = await firebaseAdmin.messaging().sendMulticast(message);

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: `Notification sent successfully to user ${user_id}`,
      results: {
        notificationId,
        successCount: response.successCount,
        failureCount: response.failureCount,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error sending user notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send notification",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Send notification to all users
export const sendGlobalNotification = async (req, res) => {
  const client = await pool.connect();

  try {
    const userId = 0;

    const { title, body, image_url, data } = req.body;

    if (!title || !body) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: title and body are required",
      });
    }

    await client.query("BEGIN");

    // Store notification in database as global
    const notificationResult = await client.query(
      `INSERT INTO notifications 
       (title, body, image_url, data, is_global, sent_by) 
       VALUES ($1, $2, $3, $4, true, $5) 
       RETURNING id`,
      [title, body, image_url, data || {}, userId]
    );

    const notificationId = notificationResult.rows[0].id;

    // Get all unique device tokens
    const result = await client.query("SELECT * FROM fcm_tokens");

    console.log(result.rows);
    const tokensResult = await client.query(
      "SELECT DISTINCT device_token FROM fcm_tokens WHERE device_token != '{}' AND device_token IS NOT NULL AND device_token != ''"
    );

    const tokens = tokensResult.rows
      .map((row) => row.device_token)
      .filter(token => {
        // Additional validation to ensure tokens are valid strings
        return typeof token === 'string' && token.length > 10;
      });

    if (tokens.length === 0) {
      await client.query("COMMIT");
      return res.status(404).json({
        success: false,
        message: "No valid device tokens found in the system",
      });
    }

    // Firebase can only send to 500 tokens at once, so we need to batch them
    const batchSize = 500;
    const batches = [];

    for (let i = 0; i < tokens.length; i += batchSize) {
      batches.push(tokens.slice(i, i + batchSize));
    }

    // Prepare notification message template
    const messageTemplate = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        notification_id: notificationId.toString(),
        is_global: "true",
      },
    };

    // Add image if provided
    if (image_url) {
      messageTemplate.notification.imageUrl = image_url;
    }

    // Send message to each batch
    let successCount = 0;
    let failureCount = 0;

    for (const batch of batches) {
      try {
        // Create a multicast message object without tokens field
        const message = {
          notification: {
            title,
            body,
          },
          data: {
            ...data,
            notification_id: notificationId.toString(),
            is_global: "true",
          },
        };

        // Add image if provided
        if (image_url) {
          message.notification.imageUrl = image_url;
        }

        // Use Promise.allSettled to handle individual token failures
        const batchPromises = batch.map(token => {
          // Skip invalid tokens
          if (!token || token === '{}' || token.length < 10) {
            console.log(`Skipping invalid token: ${token}`);
            return Promise.resolve({ status: 'skipped', token });
          }
          
          return firebaseAdmin.messaging().send({
            ...message,
            token: token
          }).then(response => {
            return { status: 'fulfilled', token, response };
          }).catch(error => {
            console.log(`Error sending to token ${token}: ${error.message}`);
            return { status: 'rejected', token, error: error.message };
          });
        });
        
        const results = await Promise.allSettled(batchPromises);
        
        // Count successes and failures
        const fulfilled = results.filter(r => r.value?.status === 'fulfilled').length;
        const rejected = results.filter(r => r.value?.status === 'rejected').length;
        const skipped = results.filter(r => r.value?.status === 'skipped').length;
        
        successCount += fulfilled;
        failureCount += rejected;
        
        console.log(`Batch processed: ${fulfilled} success, ${rejected} failed, ${skipped} skipped`);
      } catch (error) {
        console.error("Error sending batch:", error);
        failureCount += batch.length;
      }
    }

    await client.query("COMMIT");

    return res.status(200).json({
      success: true,
      message: "Global notification sent successfully",
      results: {
        notificationId,
        successCount,
        failureCount,
        totalDevices: tokens.length,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error sending global notification:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send global notification",
      error: error.message,
    });
  } finally {
    client.release();
  }
};

// Get notification history for admin dashboard
export const getNotificationHistory = async (req, res) => {
  try {
    const { userId } = req.auth; // Admin ID
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const offset = (page - 1) * limit;
    const type = req.query.type || "all"; // 'all', 'global', 'user'

    // Build WHERE clause based on type
    let whereClause = "";
    if (type === "global") {
      whereClause = "WHERE n.is_global = true";
    } else if (type === "user") {
      whereClause = "WHERE n.is_global = false";
    }

    // Get total count
    const countQuery = `
      SELECT COUNT(*) 
      FROM notifications n 
      ${whereClause}
    `;
    const countResult = await pool.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Get notification history with admin name and user name if applicable
    const notificationsQuery = `
      SELECT 
        n.*,
        a.username as admin_username,
        CASE 
          WHEN n.user_id IS NOT NULL THEN u.username
          ELSE NULL
        END as recipient_username
      FROM notifications n
      LEFT JOIN admins a ON n.sent_by = a.id
      LEFT JOIN users u ON n.user_id = u.id
      ${whereClause}
      ORDER BY n.sent_at DESC
      LIMIT $1 OFFSET $2
    `;

    const notificationsResult = await pool.query(notificationsQuery, [
      limit,
      offset,
    ]);

    return res.status(200).json({
      success: true,
      data: notificationsResult.rows,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        limit,
      },
    });
  } catch (error) {
    console.error("Error fetching notification history:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification history",
      error: error.message,
    });
  }
};

// Register or update FCM token (for user clients - this endpoint would be used by the frontend app)
export const registerFcmToken = async (req, res) => {
  try {
    const { userId } = req.auth; // User ID
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const { device_token, device_type } = req.body;
    const { user_id } = req.query; // Extract any query parameters if needed

    if (!device_token) {
      return res.status(400).json({
        success: false,
        message: "Device token is required",
      });
    }

    // Check if token already exists for this user
    const checkResult = await pool.query(
      "SELECT id FROM fcm_tokens WHERE user_id = $1 AND device_token = $2",
      [user_id, device_token]
    );

    console.log("Check result:", checkResult.rows, device_token);

    if (checkResult.rows.length > 0) {
      // Update existing token
      await pool.query(
        "UPDATE fcm_tokens SET updated_at = CURRENT_TIMESTAMP, device_type = $1 WHERE user_id = $2 AND device_token = $3",
        [device_type || null, user_id, device_token]
      );
    } else {
      // Insert new token
      await pool.query(
        "INSERT INTO fcm_tokens (user_id, device_token, device_type) VALUES ($1, $2, $3)",
        [user_id, device_token, device_type || null]
      );
    }

    return res.status(200).json({
      success: true,
      message: "FCM token registered successfully",
    });
  } catch (error) {
    console.log("Error registering FCM token:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to register FCM token",
      error: error.message,
    });
  }
};
