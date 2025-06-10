import { pool } from "../db/db.js";

// Public endpoint to get page content
export const getPageContent = async (req, res) => {
  try {
    const { pageName } = req.params;

    const pageResult = await pool.query(
      "SELECT title, content, updated_at FROM pages WHERE page_name = $1",
      [pageName]
    );

    if (pageResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Page not found",
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
