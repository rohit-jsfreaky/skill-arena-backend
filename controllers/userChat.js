import { pool } from "../db/db.js";

// Get list of users for chat (except current user)

export const getUsersChat = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const currentUserId = req.query.currentUserId;

    if (!currentUserId) {
      return res.status(400).json({ error: "Current user ID is required" });
    }

    const result = await pool.query(
      "SELECT id, username FROM users WHERE id != $1 ORDER BY username",
      [currentUserId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

// Get conversation history between two users

export const getUsersHistory = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const { receiverId } = req.params;
    const senderId = req.query.senderId;

    if (!senderId || !receiverId) {
      return res
        .status(400)
        .json({ error: "Both sender and receiver IDs are required" });
    }

    // Get messages between the two users
    const result = await pool.query(
      `
        SELECT pm.*, 
          sender.username as sender_username,
          receiver.username as receiver_username
        FROM personal_messages pm
        JOIN users sender ON pm.sender_id = sender.id
        JOIN users receiver ON pm.receiver_id = receiver.id
        WHERE (pm.sender_id = $1 AND pm.receiver_id = $2)
           OR (pm.sender_id = $2 AND pm.receiver_id = $1)
        ORDER BY pm.timestamp
      `,
      [senderId, receiverId]
    );

    const messages = result.rows.map((row) => ({
      id: row.id,
      senderId: row.sender_id,
      senderUsername: row.sender_username,
      receiverId: row.receiver_id,
      receiverUsername: row.receiver_username,
      message: row.message,
      timestamp: row.timestamp,
      isRead: row.is_read,
    }));

    res.json(messages);
  } catch (error) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ error: "Failed to fetch conversation" });
  }
};

// Get unread message counts for a user

export const getUnreadMessage = async (req, res) => {
  try {
    const { userId: user_id } = req.auth;

    if (!user_id) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const userId = req.query.userId;

    console.log(" in unread");
    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const result = await pool.query(
      `
        SELECT sender_id, COUNT(*) as unread_count
        FROM personal_messages
        WHERE receiver_id = $1 AND is_read = FALSE
        GROUP BY sender_id
      `,
      [userId]
    );

    // Convert to a map of sender_id -> count
    const unreadCounts = {};
    result.rows.forEach((row) => {
      unreadCounts[row.sender_id] = parseInt(row.unread_count);
    });

    console.log(unreadCounts);
    res.json(unreadCounts);
  } catch (error) {
    console.error("Error fetching unread counts:", error);
    res.status(500).json({ error: "Failed to fetch unread counts" });
  }
};
