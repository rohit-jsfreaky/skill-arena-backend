import { pool } from "../../db/db.js";

// Get page content by name
export const getPageContent = async (req, res) => {
  try {
    const { pageName } = req.params;

    const pageResult = await pool.query(
      "SELECT * FROM pages WHERE page_name = $1",
      [pageName]
    );

    if (pageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Page content not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: pageResult.rows[0],
    });
  } catch (error) {
    console.error("Error fetching page content:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch page content",
      error: error.message,
    });
  }
};

// Update page content
export const updatePageContent = async (req, res) => {
  try {
    const { pageName } = req.params;
    const { title, content } = req.body;
    const userId = 1;

    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: "Title and content are required",
      });
    }

    // Check if page exists
    const existingPage = await pool.query(
      "SELECT id FROM pages WHERE page_name = $1",
      [pageName]
    );

    let result;

    if (existingPage.rows.length > 0) {
      // Update existing page
      result = await pool.query(
        `UPDATE pages 
         SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP, updated_by = $3
         WHERE page_name = $4
         RETURNING *`,
        [title, content, userId, pageName]
      );
    } else {
      // Create new page
      result = await pool.query(
        `INSERT INTO pages (page_name, title, content, updated_by)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [pageName, title, content, userId]
      );
    }

    return res.status(200).json({
      success: true,
      message: "Page content updated successfully",
      data: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating page content:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update page content",
      error: error.message,
    });
  }
};

// Get all pages (for admin dashboard)
export const getAllPages = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, a.username as admin_username
       FROM pages p
       LEFT JOIN admins a ON p.updated_by = a.id
       ORDER BY p.updated_at DESC`
    );

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching pages:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch pages",
      error: error.message,
    });
  }
};
