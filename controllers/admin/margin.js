import { pool } from "../../db/db.js";

export const getMargin = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT margin FROM prize_margin ORDER BY created_at DESC LIMIT 1`
    );

    if (result.rows.length === 0) {
      // No margin found, insert default value
      await pool.query(`INSERT INTO prize_margin (margin) VALUES (0)`);
      return res.status(200).json({ margin: 0 });
    }

    return res.status(200).json({ margin: result.rows[0].margin });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};

export const updateMargin = async (req, res) => {
  try {
    const { margin } = req.body;

    if (margin === undefined || typeof margin !== "number") {
      return res
        .status(400)
        .json({ message: "Valid margin value is required" });
    }

    // Insert new margin record
    const result = await pool.query(
      `INSERT INTO prize_margin (margin) VALUES ($1) RETURNING *`,
      [margin]
    );

    return res.status(200).json({
      message: "Margin updated successfully",
      margin: result.rows[0].margin,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
