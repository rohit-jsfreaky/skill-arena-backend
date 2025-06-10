import { pool } from "../../db/db.js";

// Get all games with pagination
export const getAllGames = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = "" } = req.query;
    const offset = (page - 1) * limit;


    // Create the search term (% is wildcard in SQL)
    const searchTerm = `%${search}%`;


    console.log("Query params:", { searchTerm, limit, offset });

    let query = `
      SELECT * FROM games
      WHERE name ILIKE $1
      ORDER BY created_at DESC
      LIMIT $2 OFFSET $3
    `;

    const countQuery = `
      SELECT COUNT(*) FROM games
      WHERE name ILIKE $1
    `;

    const gamesResult = await pool.query(query, [searchTerm, limit, offset]);
    const countResult = await pool.query(countQuery, [searchTerm]);


    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);


    return res.status(200).json({
      games: gamesResult.rows,
      pagination: {
        total,
        totalPages,
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Error getting games:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Get game by ID
export const getGameById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("SELECT * FROM games WHERE id = $1", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    return res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error getting game:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Create a new game
export const createGame = async (req, res) => {
  try {
    const { name, description, image, status, platform, genre, release_date } =
      req.body;

    if (!name || !status) {
      return res.status(400).json({ message: "Name and status are required" });
    }

    const query = `
      INSERT INTO games (name, description, image, status, platform, genre, release_date, access_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'free')
      RETURNING *
    `;

    const values = [
      name,
      description,
      image,
      status,
      platform,
      genre,
      release_date,
    ];
    const result = await pool.query(query, values);

    return res.status(201).json({
      message: "Game created successfully",
      game: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating game:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Update an existing game
export const updateGame = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, image, status, platform, genre, release_date } =
      req.body;

    // Check if game exists
    const checkResult = await pool.query("SELECT * FROM games WHERE id = $1", [
      id,
    ]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    const query = `
      UPDATE games
      SET 
        name = $1,
        description = $2,
        image = $3,
        status = $4,
        platform = $5,
        genre = $6,
        release_date = $7
      WHERE id = $8
      RETURNING *
    `;

    const values = [
      name,
      description,
      image,
      status,
      platform,
      genre,
      release_date,
      id,
    ];

    const result = await pool.query(query, values);

    return res.status(200).json({
      message: "Game updated successfully",
      game: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating game:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Delete a game
export const deleteGame = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if game exists
    const checkResult = await pool.query("SELECT * FROM games WHERE id = $1", [
      id,
    ]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ message: "Game not found" });
    }

    // Delete the game
    await pool.query("DELETE FROM games WHERE id = $1", [id]);

    return res.status(200).json({ message: "Game deleted successfully" });
  } catch (error) {
    console.error("Error deleting game:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

// Add this new controller
export const getActiveGames = async (req, res) => {
  try {
    const query = `
      SELECT id, name, image 
      FROM games 
      WHERE status = 'active' 
      ORDER BY name ASC
    `;

    const result = await pool.query(query);

    return res.status(200).json({
      games: result.rows,
    });
  } catch (error) {
    console.error("Error getting active games:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
