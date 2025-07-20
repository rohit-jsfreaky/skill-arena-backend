import { pool } from "../db/db.js";
import crypto from "crypto";
import multer from "multer";

import fs from "fs";
import { getIO } from "../utils/socketManager.js";

const generateReferralCode = () => {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
};

function generateUniqueUsername(prefix = "user") {
  const randomString = crypto.randomBytes(8).toString("hex");
  const timestamp = Date.now().toString(36);

  return `${prefix}-${timestamp}-${randomString.slice(0, 8)}`;
}

export const createUser = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId } = req.auth || {};

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    let {
      name,
      email,
      username,
      wallet,
      total_games_played,
      total_wins,
      profile,
    } = req.body;

    if (!email || !name) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    username = username || generateUniqueUsername();

    // Check if email exists
    const userCheckResult = await client.query(
      "SELECT 1 FROM users WHERE email = $1",
      [email]
    );

    if (userCheckResult.rows.length > 0) {
      console.log("User already registered");
      return res.status(409).json({ error: "User already registered" });
    }

    // Check if username exists
    const usernameCheckResult = await client.query(
      "SELECT 1 FROM users WHERE username = $1",
      [username]
    );

    if (usernameCheckResult.rows.length > 0) {
      return res.status(400).json({ error: "Username already taken" });
    }

    // Generate unique referral code
    let referral_code;
    let isUnique = false;
    while (!isUnique) {
      referral_code = generateReferralCode();
      const referralCheckResult = await client.query(
        "SELECT 1 FROM users WHERE referral_code = $1",
        [referral_code]
      );

      if (referralCheckResult.rows.length === 0) {
        isUnique = true;
      }
    }

    // Insert user into database
    const insertUserQuery = `
      INSERT INTO users (name, email, username, profile, wallet, total_games_played, total_wins, referral_code) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *;
    `;
    const queryParams = [
      name,
      email,
      username,
      profile,
      wallet || 0,
      total_games_played || 0,
      total_wins || 0,
      referral_code,
    ];

    const newUser = await client.query(insertUserQuery, queryParams);

    if (!newUser.rows.length) {
      throw new Error("Failed to create user");
    }

    console.log("New user created:", newUser.rows[0]);

    const io = getIO();

    // Insert system message
    const systemMessageResult = await client.query(
      "INSERT INTO chat_messages (user_id, message, is_system) VALUES ($1, $2, $3) RETURNING *",
      [0, `${username} has joined the chat!`, true]
    );

    if (systemMessageResult.rows.length) {
      const systemMessage = systemMessageResult.rows[0];
      io.to("global").emit("chat_message", {
        id: systemMessage.id,
        userId: newUser.rows[0].id,
        username: "System",
        message: `${username} has joined the chat!`,
        timestamp: systemMessage.timestamp,
        isSystem: true,
      });
    }

    res
      .status(201)
      .json({ message: "User created successfully", user: newUser.rows[0] });
  } catch (error) {
    console.error("Error creating user:", error.message);
    res
      .status(500)
      .json({ error: "Something went wrong! Please Try Again Later" });
  } finally {
    if (client) client.release();
  }
};

export const getUserByEmail = async (req, res) => {
  let client;
  try {
    const { userId } = req.auth || {};

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    client = await pool.connect();
    const user = await client.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);

    if (user.rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }

    res.status(200).json({ user: user.rows[0] });
  } catch (error) {
    console.error("Error fetching user:", error.message);
    res.status(500).json({ error: "Internal server error" });
  } finally {
    if (client) client.release();
  }
};

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = "uploads/";
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const upload = multer({ storage }).single("profile");

export const updateUser = async (req, res) => {
  upload(req, res, async (err) => {
    if (err) {
      return res
        .status(500)
        .json({ message: "File upload error", error: err.message });
    }

    let {
      id,
      name,
      email,
      username,
      wallet,
      total_games_played,
      total_wins,
      referral_code,
      profile,
      account_details,
      paytm_number,
      upi_id,
      upi_qr_code_url,
    } = req.body;

    if (!id) {
      return res.status(400).json({ error: "User ID is required." });
    }

    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const SERVER_URL = `${req.protocol}://${req.get("host")}`;

    const isUrl =
      profile &&
      (profile.startsWith("http://") || profile.startsWith("https://"));
    if (!isUrl && req.file) {
      profile = `${SERVER_URL}/uploads/${req.file.filename}`;
    }

    wallet = wallet ? parseInt(wallet, 10) || null : null;
    total_games_played = total_games_played
      ? parseInt(total_games_played, 10) || null
      : null;
    total_wins = total_wins ? parseInt(total_wins, 10) || null : null;

    let client;
    try {
      client = await pool.connect();

      // ✅ Check if the new username is already taken (excluding the current user)
      const checkUsernameQuery = `SELECT id FROM users WHERE username = $1 AND id != $2`;
      const usernameResult = await client.query(checkUsernameQuery, [
        username,
        id,
      ]);

      if (usernameResult.rowCount > 0) {
        return res.status(400).json({ error: "Username already taken." });
      }

      const query = `
  UPDATE users 
  SET 
      name = COALESCE($1, name), 
      email = COALESCE($2, email), 
      username = COALESCE($3, username), 
      profile = COALESCE($4, profile), 
      wallet = COALESCE($5, wallet), 
      total_games_played = COALESCE($6, total_games_played), 
      total_wins = COALESCE($7, total_wins), 
      referral_code = COALESCE($8, referral_code),
      account_details = COALESCE($9, account_details),
      paytm_number = COALESCE($10, paytm_number),
      upi_id = COALESCE($11, upi_id),
      upi_qr_code_url = COALESCE($12, upi_qr_code_url)
  WHERE id = $13
  RETURNING *;
`;

      const values = [
        name,
        email,
        username,
        profile,
        wallet,
        total_games_played,
        total_wins,
        referral_code,
        account_details,
        paytm_number,
        upi_id,
        upi_qr_code_url,
        id,
      ];
      const result = await client.query(query, values);

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "User not found." });
      }

      res
        .status(200)
        .json({ message: "User updated successfully", user: result.rows[0] });
    } catch (error) {
      console.error("Error updating user:", error.message);
      res.status(500).json({ error: "Internal server error." });
    } finally {
      if (client) client.release();
    }
  });
};

export const handleReferralBonus = async (req, res) => {
  let client;

  try {
    const { userId } = req.auth;
    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const { email, referral_code } = req.body;
    if (!email || !referral_code) {
      return res
        .status(400)
        .json({ error: "Email and referral code are required." });
    }

    client = await pool.connect();

    // ✅ Fetch the user who owns the referral code
    const referralUserQuery = `
      SELECT id, email, COALESCE(wallet, 0.00) AS wallet 
      FROM users 
      WHERE referral_code = $1`;
    const referralUserResult = await client.query(referralUserQuery, [
      referral_code,
    ]);

    if (referralUserResult.rowCount === 0) {
      return res.status(404).json({ error: "Invalid referral code." });
    }

    const referralUser = referralUserResult.rows[0];

    // ✅ Prevent self-referrals
    if (referralUser.email === email) {
      return res
        .status(400)
        .json({ error: "You cannot use your own referral code." });
    }

    // ✅ Fetch the user applying the referral code
    const requestUserQuery = `
      SELECT id, COALESCE(wallet, 0.00) AS wallet, applied_referral 
      FROM users 
      WHERE email = $1`;
    const requestUserResult = await client.query(requestUserQuery, [email]);

    if (requestUserResult.rowCount === 0) {
      return res.status(404).json({ error: "User with this email not found." });
    }

    const requestUser = requestUserResult.rows[0];

    // ✅ Ensure the user hasn't already used a referral code
    if (requestUser.applied_referral) {
      return res
        .status(400)
        .json({ error: "You have already applied a referral code." });
    }

    // ✅ Start a transaction for atomicity
    await client.query("BEGIN");

    // ✅ Update wallet balances
    const updateWalletQuery = `
      UPDATE users 
      SET wallet = ROUND(COALESCE(wallet, 0.00) + 10.00, 2) 
      WHERE id = $1`;

    const updateAppliedReferralQuery = `
      UPDATE users 
      SET applied_referral = TRUE 
      WHERE id = $1`;

    await client.query(updateWalletQuery, [requestUser.id]);
    await client.query(updateWalletQuery, [referralUser.id]);
    await client.query(updateAppliedReferralQuery, [requestUser.id]);

    // ✅ Commit transaction
    await client.query("COMMIT");

    res.status(200).json({ message: "Referral bonus added successfully." });
  } catch (error) {
    if (client) await client.query("ROLLBACK"); // Rollback on error
    console.error("Error processing referral bonus:", error.message);
    res.status(500).json({ error: "Internal server error." });
  } finally {
    if (client) client.release(); // Always release the client
  }
};

// Update the searchUsers function to exclude users already in a match
export const searchUsers = async (req, res) => {
  let client;
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ message: "Unauthorized: You need to log in." });
    }

    const { q, limit = 5, matchId } = req.query;
    if (!q || q.trim().length < 2) {
      return res
        .status(400)
        .json({ message: "Search query must be at least 2 characters" });
    }

    client = await pool.connect();

    let query, params;

    if (matchId) {
      // If matchId is provided, exclude users who are already in this match
      query = `
        SELECT u.id, u.username, u.name, u.profile 
        FROM users u
        WHERE (u.username ILIKE $1 OR u.name ILIKE $1)
        AND u.id NOT IN (
          SELECT tm.user_id
          FROM tdm_team_members tm
          JOIN tdm_teams t ON tm.team_id = t.id
          WHERE t.match_id = $2
        )
        ORDER BY u.username
        LIMIT $3
      `;
      params = [`%${q}%`, matchId, limit];
    } else {
      // Original query without match filtering
      query = `
        SELECT id, username, name, profile 
        FROM users 
        WHERE username ILIKE $1 OR name ILIKE $1
        ORDER BY username
        LIMIT $2
      `;
      params = [`%${q}%`, limit];
    }

    const result = await client.query(query, params);

    return res.status(200).json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error searching users:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  } finally {
    if (client) client.release();
  }
};

// Client-side user search with support for ID, username, and name
export const searchUsersForClient = async (req, res) => {
  let client;
  try {
    const { userId } = req.auth || {};
    if (!userId) {
      return res
        .status(401)
        .json({ 
          success: false,
          message: "Unauthorized: You need to log in." 
        });
    }

    const { term, limit = 5 } = req.query;
    
    if (!term) {
      return res.status(400).json({
        success: false,
        message: "Search term is required"
      });
    }

    // For numeric searches (user ID), allow single character searches
    // For text searches, require at least 2 characters
    const isNumeric = /^\d+$/.test(term.toString().trim());
    const minLength = isNumeric ? 1 : 2;
    
    if (term.length < minLength) {
      return res.status(400).json({
        success: false,
        message: isNumeric 
          ? "Enter user ID to search" 
          : "Type at least 2 characters to search"
      });
    }

    client = await pool.connect();
    
    let query;
    let queryParams;
    
    if (isNumeric) {
      // If search term is numeric, prioritize exact ID match, then include name/username matches
      query = `
        SELECT id, username, name, profile
        FROM users
        WHERE id = $1 
           OR username ILIKE $2 
           OR name ILIKE $2
        ORDER BY 
          CASE 
            WHEN id = $1 THEN 0
            WHEN username ILIKE $3 THEN 1
            WHEN username ILIKE $4 THEN 2
            WHEN name ILIKE $3 THEN 3
            ELSE 4
          END
        LIMIT $5
      `;
      
      queryParams = [
        parseInt(term), // Exact ID match
        `%${term}%`,    // Pattern for anywhere in username/name
        `${term}%`,     // Pattern for starts with (higher priority)
        `%${term}`,     // Pattern for ends with (medium priority)
        limit
      ];
    } else {
      // If search term is not numeric, search only by username and name
      query = `
        SELECT id, username, name, profile
        FROM users
        WHERE username ILIKE $1 OR name ILIKE $1
        ORDER BY 
          CASE 
            WHEN username ILIKE $2 THEN 0
            WHEN username ILIKE $3 THEN 1
            WHEN name ILIKE $2 THEN 2
            ELSE 3
          END
        LIMIT $4
      `;
      
      queryParams = [
        `%${term}%`, // Pattern for anywhere in the string
        `${term}%`,  // Pattern for starts with (higher priority)
        `%${term}`,  // Pattern for ends with (medium priority)
        limit
      ];
    }
    
    const result = await client.query(query, queryParams);
    
    return res.status(200).json({
      success: true,
      message: "Search results fetched successfully",
      data: result.rows
    });
    
  } catch (error) {
    console.error("Error searching users for client:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to search users",
      error: error.message
    });
  } finally {
    if (client) {
      client.release();
    }
  }
};
