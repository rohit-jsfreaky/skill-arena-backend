import { pool } from "../../db/db.js";
import { markGamesAsPro, updateGameAccessAfterRemoval } from "../../utils/gameAccessUtils.js";

// Get all memberships
export const getAllMemberships = async (req, res) => {
  try {
    const membershipsResult = await pool.query("SELECT * FROM memberships ORDER BY id ASC");
    const memberships = membershipsResult.rows;
    
    // For each membership, get the associated games
    for (const membership of memberships) {
      const gamesResult = await pool.query(`
        SELECT g.* FROM games g
        JOIN membership_games mg ON g.id = mg.game_id
        WHERE mg.membership_id = $1
      `, [membership.id]);
      
      membership.games = gamesResult.rows;
    }
    
    res.status(200).json({
      success: true,
      data: memberships,
      message: "Memberships fetched successfully"
    });
  } catch (error) {
    console.error("Error fetching memberships:", error);
    res.status(500).json({ 
      success: false,
      message: "Error fetching memberships", 
      error: error.message 
    });
  }
};

// Updated formatter for duration in createMembership function

// Format duration as a PostgreSQL interval string
const formattedDuration = (duration) => {
  if (typeof duration === 'string') {
    return duration; // Already formatted like "30 days"
  } 
  
  if (typeof duration === 'object') {
    if (duration.days) return `${duration.days} days`;
    if (duration.months) return `${duration.months} months`;
    if (duration.years) return `${duration.years} years`;
  }
  
  // Default to 30 days if format is unrecognized
  return '30 days';
};

// Create new membership
export const createMembership = async (req, res) => {
  const { name, price, duration, benefits, games } = req.body;
  
  if (!name || !price) {
    return res.status(400).json({ 
      success: false,
      message: "Name and price are required" 
    });
  }

  try {
    // First check if a membership with this name already exists
    const nameCheck = await pool.query(
      "SELECT id FROM memberships WHERE name = $1",
      [name]
    );

    if (nameCheck.rows.length > 0) {
      return res.status(400).json({
        success: false,
        message: "A membership with this name already exists"
      });
    }

    // Use null for duration if it's not provided (permanent membership)
    const intervalDuration = duration ? formattedDuration(duration) : null;

    // Begin transaction
    await pool.query('BEGIN');

    // Insert the membership
    const result = await pool.query(
      "INSERT INTO memberships (name, price, duration, benefits) VALUES ($1, $2, $3::interval, $4) RETURNING *",
      [name, price, intervalDuration, benefits || []]
    );
    
    const membershipId = result.rows[0].id;
    
    // Insert the games if provided
    if (games && games.length > 0) {
      const gameValues = games.map(gameId => {
        return `(${membershipId}, ${gameId})`;
      }).join(', ');
      
      await pool.query(`
        INSERT INTO membership_games (membership_id, game_id) 
        VALUES ${gameValues}
      `);
      
      // Mark these games as premium
      await markGamesAsPro(games);
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    // Get the membership with games
    const membership = await getMembershipWithGames(membershipId);
    
    res.status(201).json({
      success: true,
      data: membership,
      message: "Membership created successfully"
    });
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.log("Error creating membership:", error);
    res.status(500).json({ 
      success: false,
      message: "Error creating membership", 
      error: error.message 
    });
  }
};

// Add helper function to get membership with games
const getMembershipWithGames = async (membershipId) => {
  // Get the membership
  const membershipResult = await pool.query(
    "SELECT * FROM memberships WHERE id = $1",
    [membershipId]
  );
  
  const membership = membershipResult.rows[0];
  
  // Get the associated games
  const gamesResult = await pool.query(`
    SELECT g.* FROM games g
    JOIN membership_games mg ON g.id = mg.game_id
    WHERE mg.membership_id = $1
  `, [membershipId]);
  
  membership.games = gamesResult.rows;
  
  return membership;
};

// Get single membership
export const getMembershipById = async (req, res) => {
  const { id } = req.params;
  
  try {
    const result = await pool.query("SELECT * FROM memberships WHERE id = $1", [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Membership not found" });
    }
    
    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching membership:", error);
    res.status(500).json({ message: "Error fetching membership", error: error.message });
  }
};

// Update membership
export const updateMembership = async (req, res) => {
  const { id } = req.params;
  const { name, price, duration, benefits, games } = req.body;
  
  try {
    // Check if name is being changed and if it conflicts with an existing membership
    if (name) {
      const nameCheck = await pool.query(
        "SELECT id FROM memberships WHERE name = $1 AND id != $2",
        [name, id]
      );

      if (nameCheck.rows.length > 0) {
        return res.status(400).json({
          success: false,
          message: "A membership with this name already exists"
        });
      }
    }

    // Begin transaction
    await pool.query('BEGIN');

    // Use null for duration if it's not provided (permanent membership)
    const intervalDuration = duration ? formattedDuration(duration) : null;

    const result = await pool.query(
      "UPDATE memberships SET name = $1, price = $2, duration = $3::interval, benefits = $4 WHERE id = $5 RETURNING *",
      [name, price, intervalDuration, benefits || [], id]
    );
    
    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Membership not found" 
      });
    }
    
    // Update the games if provided
    if (games) {
      // Get the current games for this membership
      const currentGamesResult = await pool.query(
        "SELECT game_id FROM membership_games WHERE membership_id = $1",
        [id]
      );
      const currentGameIds = currentGamesResult.rows.map(row => row.game_id);
      
      // Delete existing associations
      await pool.query(
        "DELETE FROM membership_games WHERE membership_id = $1",
        [id]
      );
      
      // Insert new associations
      if (games.length > 0) {
        const gameValues = games.map(gameId => {
          return `(${id}, ${gameId})`;
        }).join(', ');
        
        await pool.query(`
          INSERT INTO membership_games (membership_id, game_id) 
          VALUES ${gameValues}
        `);
        
        // Mark the newly added games as premium
        await markGamesAsPro(games);
      }
      
      // Check if any games were removed from this membership
      // and should potentially be marked as free
      const removedGameIds = currentGameIds.filter(id => !games.includes(id));
      await updateGameAccessAfterRemoval(removedGameIds);
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    // Get the membership with games
    const membership = await getMembershipWithGames(id);
    
    res.status(200).json({
      success: true,
      data: membership,
      message: "Membership updated successfully"
    });
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.error("Error updating membership:", error);
    res.status(500).json({ 
      success: false,
      message: "Error updating membership", 
      error: error.message 
    });
  }
};

// Delete membership
export const deleteMembership = async (req, res) => {
  const { id } = req.params;
  
  try {
    // Begin transaction
    await pool.query('BEGIN');
    
    // Get the games associated with this membership
    const gamesResult = await pool.query(
      "SELECT game_id FROM membership_games WHERE membership_id = $1",
      [id]
    );
    const gameIds = gamesResult.rows.map(row => row.game_id);
    
    // Delete the membership
    const result = await pool.query("DELETE FROM memberships WHERE id = $1 RETURNING *", [id]);
    
    if (result.rows.length === 0) {
      await pool.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Membership not found" 
      });
    }
    
    // Check if any games should now be marked as free
    if (gameIds.length > 0) {
      await updateGameAccessAfterRemoval(gameIds);
    }
    
    // Commit transaction
    await pool.query('COMMIT');
    
    res.status(200).json({ 
      success: true,
      message: "Membership deleted successfully" 
    });
  } catch (error) {
    // Rollback on error
    await pool.query('ROLLBACK');
    console.error("Error deleting membership:", error);
    res.status(500).json({ 
      success: false,
      message: "Error deleting membership", 
      error: error.message 
    });
  }
};