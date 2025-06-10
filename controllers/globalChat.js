import { pool } from "../db/db.js";

export const getMessage = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `
      SELECT cm.id, cm.user_id, u.username, cm.message, cm.timestamp , cm.is_system
      FROM chat_messages cm
      JOIN users u ON cm.user_id = u.id
      ORDER BY cm.timestamp DESC
      LIMIT $1 OFFSET $2
    `,
      [limit, offset]
    );

    return res.json(result.rows.reverse());
  } catch (error) {
    console.error("Error fetching chat messages:", error);
    return res.status(500).json({ error: "Failed to fetch chat messages" });
  }
};

export const postMessage = async (req, res) => {
  try {
    const { userId: user_id } = req.auth;

    if (!user_id) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const { userId, message } = req.body;

    if (!userId || !message) {
      return res
        .status(400)
        .json({ error: "User ID and message are required" });
    }

    const result = await pool.query(
      "INSERT INTO chat_messages (user_id, message) VALUES ($1, $2) RETURNING *",
      [userId, message]
    );

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating chat message:", error);
    return res.status(500).json({ error: "Failed to create chat message" });
  }
};

export const deleteMessage = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const { id } = req.params;

    await pool.query("DELETE FROM chat_messages WHERE id = $1", [id]);
    return res.status(204).send();
  } catch (error) {
    console.error("Error deleting chat message:", error);
    return res.status(500).json({ error: "Failed to delete chat message" });
  }
};
