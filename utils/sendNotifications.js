import { pool } from "../db/db.js";
import firebaseAdmin from "./firebase.js";

export const sendGlobalNotificationUtil = async (
  title,
  body,
  image_url,
  data
) => {
  const client = await pool.connect();

  try {
    const userId = 0;

    if (!title || !body) {
      return {
        success: false,
        message: "Missing required fields: title and body are required",
      };
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
    const tokensResult = await client.query(
      "SELECT DISTINCT device_token FROM fcm_tokens WHERE device_token != '{}' AND device_token IS NOT NULL AND device_token != ''"
    );

    const tokens = tokensResult.rows
      .map((row) => row.device_token)
      .filter((token) => {
        // Additional validation to ensure tokens are valid strings
        return typeof token === "string" && token.length > 10;
      });

    if (tokens.length === 0) {
      await client.query("COMMIT");
      return {
        success: false,
        message: "No valid device tokens found in the system",
      };
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
        // if (image_url) {
        //   message.notification.imageUrl = image_url;
        // }

        // Use Promise.allSettled to handle individual token failures
        const batchPromises = batch.map((token) => {
          // Skip invalid tokens
          if (!token || token === "{}" || token.length < 10) {
            console.log(`Skipping invalid token: ${token}`);
            return Promise.resolve({ status: "skipped", token });
          }

          return firebaseAdmin
            .messaging()
            .send({
              ...message,
              token: token,
            })
            .then((response) => {
              return { status: "fulfilled", token, response };
            })
            .catch((error) => {
              console.log(`Error sending to token ${token}: ${error.message}`);
              return { status: "rejected", token, error: error.message };
            });
        });

        const results = await Promise.allSettled(batchPromises);

        // Count successes and failures
        const fulfilled = results.filter(
          (r) => r.value?.status === "fulfilled"
        ).length;
        const rejected = results.filter(
          (r) => r.value?.status === "rejected"
        ).length;
        const skipped = results.filter(
          (r) => r.value?.status === "skipped"
        ).length;

        successCount += fulfilled;
        failureCount += rejected;

        console.log(
          `Batch processed: ${fulfilled} success, ${rejected} failed, ${skipped} skipped`
        );
      } catch (error) {
        console.error("Error sending batch:", error);
        failureCount += batch.length;
      }
    }

    await client.query("COMMIT");

    return {
      success: true,
      message: "Global notification sent successfully",
      results: {
        notificationId,
        successCount,
        failureCount,
        totalDevices: tokens.length,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error sending global notification:", error);
    return {
      success: false,
      message: "Failed to send global notification",
      error: error.message,
    };
  } finally {
    client.release();
  }
};

export const sendUserNotification = async (
  user_id,
  title,
  body,
  image_url,
  data
) => {
  const client = await pool.connect();

  try {
    const userId = 0;

    if (!user_id || !title || !body) {
      return {
        success: false,
        message:
          "Missing required fields: user_id, title, and body are required",
      };
    }

    await client.query("BEGIN");

    const alltokens = await client.query("SELECT * FROM fcm_tokens");

    console.log("all tokens", alltokens.rows);

    // Get user's FCM tokens
    const tokensResult = await client.query(
      "SELECT device_token FROM fcm_tokens WHERE user_id = $1",
      [user_id]
    );

    const tokens = tokensResult.rows
      .map((row) => row.device_token)
      .filter((token) => {
        // Additional validation to ensure tokens are valid strings
        return typeof token === "string" && token.length > 10;
      });

    if (tokens.length === 0) {
      await client.query("COMMIT");
      return {
        success: false,
        message: "No device tokens found for this user",
      };
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

    // Prepare base message object
    const baseMessage = {
      notification: {
        title,
        body,
      },
      data: {
        ...data,
        notification_id: notificationId.toString(),
      },
    };

    // Add image if provided
    if (image_url) {
      baseMessage.notification.imageUrl = image_url;
    }

    // Send to each token individually
    let successCount = 0;
    let failureCount = 0;

    // Use Promise.all to send to all tokens concurrently
    const sendPromises = tokens.map((token) => {
      return firebaseAdmin
        .messaging()
        .send({
          ...baseMessage,
          token: token,
        })
        .then(() => {
          successCount++;
          console.log(`Notification sent to token: ${token}`);
          return { success: true, token };
        })
        .catch((error) => {
          failureCount++;
          console.error(`Failed to send to token: ${token}`, error);
          return { success: false, token, error: error.message };
        });
    });

    await Promise.all(sendPromises);

    await client.query("COMMIT");

    return {
      success: true,
      message: `Notification sent successfully to user ${user_id}`,
      results: {
        notificationId,
        successCount,
        failureCount,
      },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error sending user notification:", error);
    return {
      success: false,
      message: "Failed to send notification",
      error: error.message,
    };
  } finally {
    client.release();
  }
};
