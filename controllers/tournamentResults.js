import { pool } from "../db/db.js";
import Tesseract from "tesseract.js";
import { sendUserNotification } from "../utils/sendNotifications.js";

// Upload a tournament screenshot
export const uploadTournamentScreenshot = async (req, res) => {
  console.log("rec");
  const { tournamentId } = req.params;
  const { userId, screenshotPath } = req.query;

  console.log(tournamentId, userId, screenshotPath);
  try {
    // Check if user is a participant in this tournament
    const participantCheck = await pool.query(
      "SELECT * FROM user_tournaments WHERE user_id = $1 AND tournament_id = $2",
      [userId, tournamentId]
    );

    if (participantCheck.rows.length === 0) {
      console.log("i am returning here");
      return res
        .status(403)
        .json({ message: "You are not a participant in this tournament" });
    }

    console.log("Participant check:", participantCheck.rows.length);

    // Check if tournament is completed
    const tournamentCheck = await pool.query(
      "SELECT status FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (tournamentCheck.rows.length === 0) {
      return res.status(404).json({ message: "Tournament not found" });
    }

    if (tournamentCheck.rows[0].status !== "completed") {
      return res.status(400).json({
        message: "Screenshots can only be uploaded for completed tournaments",
      });
    }

    // Process the image with OCR to detect win/loss
    const ocrResult = await processScreenshotWithOCR(screenshotPath);
    const verificationStatus = determineWinLossStatus(ocrResult);

    // Check if user already uploaded a screenshot for this tournament
    const existingScreenshot = await pool.query(
      "SELECT id FROM tournament_screenshots WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId]
    );

    let result;
    if (existingScreenshot.rows.length > 0) {
      // Update existing screenshot
      result = await pool.query(
        "UPDATE tournament_screenshots SET screenshot_path = $1, upload_timestamp = CURRENT_TIMESTAMP, verification_status = $2, ocr_result = $3 WHERE tournament_id = $4 AND user_id = $5 RETURNING *",
        [screenshotPath, verificationStatus, ocrResult, tournamentId, userId]
      );
    } else {
      // Insert new screenshot
      result = await pool.query(
        "INSERT INTO tournament_screenshots (tournament_id, user_id, screenshot_path, verification_status, ocr_result) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [tournamentId, userId, screenshotPath, verificationStatus, ocrResult]
      );
    }

    // Check if all participants have uploaded screenshots, if so, trigger verification
    await checkAndProcessTournamentResults(tournamentId);

    res.status(201).json({
      message: "Screenshot uploaded successfully",
      screenshot: result.rows[0],
      status: verificationStatus,
    });
  } catch (error) {
    console.log("Error uploading tournament screenshot:", error);

    res
      .status(500)
      .json({ message: "Failed to upload screenshot", error: error.message });
  }
};

// Process the screenshot with OCR
export const processScreenshotWithOCR = async (imagePath) => {
  try {
    const {
      data: { text },
    } = await Tesseract.recognize(
      imagePath,
      "eng" // language
    );
    return text;
  } catch (error) {
    console.log("OCR processing error:", error);
    throw new Error("Failed to process screenshot with OCR");
  }
};

// Determine if the screenshot shows a win or loss
export const determineWinLossStatus = (ocrText) => {
  // This is a simple example. In a real implementation, you'd want to make this more sophisticated
  // based on the specific game and what text patterns indicate a win
  const lowerText = ocrText.toLowerCase();

  // Look for common win indicators
  if (
    lowerText.includes("victory") ||
    lowerText.includes("winner") ||
    lowerText.includes("you win") ||
    lowerText.includes("1st place") ||
    lowerText.includes("champion") ||
    lowerText.includes("1/") ||
    lowerText.includes("win") // First place indicator like "1/10"
  ) {
    return "verified_win";
  }
  // Look for common loss indicators
  else if (
    lowerText.includes("defeat") ||
    lowerText.includes("you lose") ||
    lowerText.includes("game over")||
    lowerText.includes("lose")
  ) {
    return "verified_loss";
  }

  // If we can't determine, mark as pending for manual review
  return "pending";
};

// Get a participant's uploaded screenshot for a tournament
export const getParticipantScreenshot = async (req, res) => {
  const { tournamentId } = req.params;
  const { userId } = req.query;

  console.log("Getting participant screenshot:", tournamentId, userId);
  try {
    const result = await pool.query(
      "SELECT * FROM tournament_screenshots WHERE tournament_id = $1 AND user_id = $2",
      [tournamentId, userId]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ message: "No screenshot found for this tournament" });
    }

    res.status(200).json(result.rows[0]);
  } catch (error) {
    console.log("Error retrieving tournament screenshot:", error);
    res
      .status(500)
      .json({ message: "Failed to retrieve screenshot", error: error.message });
  }
};

// Get all screenshots for a tournament (for participants to see)
export const getTournamentScreenshots = async (req, res) => {
  const { tournamentId } = req.params;
  const { userId } = req.query;

  console.log("Getting tournament screenshots:", tournamentId, userId);

  try {
    // Check if user is a participant
    const participantCheck = await pool.query(
      "SELECT * FROM user_tournaments WHERE user_id = $1 AND tournament_id = $2",
      [userId, tournamentId]
    );

    if (participantCheck.rows.length === 0) {
      return res
        .status(403)
        .json({ message: "You are not a participant in this tournament" });
    }

    // Get all screenshots for this tournament
    const result = await pool.query(
      `SELECT ts.*, u.name, u.username 
       FROM tournament_screenshots ts
       JOIN users u ON ts.user_id = u.id
       WHERE ts.tournament_id = $1`,
      [tournamentId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.log("Error retrieving tournament screenshots:", error);
    res.status(500).json({
      message: "Failed to retrieve screenshots",
      error: error.message,
    });
  }
};

// Verify tournament results and determine winner
export const verifyTournamentResults = async (req, res) => {
  const { tournamentId } = req.params;

  try {
    const result = await processVerification(tournamentId);
    res.status(200).json(result);
  } catch (error) {
    console.log("Error verifying tournament results:", error);
    res.status(500).json({
      message: "Failed to verify tournament results",
      error: error.message,
    });
  }
};

// Helper function to check if all participants have uploaded screenshots and process results
const checkAndProcessTournamentResults = async (tournamentId) => {
  try {
    // Get count of participants
    const participantsResult = await pool.query(
      "SELECT COUNT(*) as total_participants FROM user_tournaments WHERE tournament_id = $1",
      [tournamentId]
    );

    // Get count of uploaded screenshots
    const screenshotsResult = await pool.query(
      "SELECT COUNT(*) as uploaded_screenshots FROM tournament_screenshots WHERE tournament_id = $1",
      [tournamentId]
    );

    const totalParticipants = parseInt(
      participantsResult.rows[0].total_participants
    );
    const uploadedScreenshots = parseInt(
      screenshotsResult.rows[0].uploaded_screenshots
    );

    // If all participants have uploaded screenshots, process verification
    if (uploadedScreenshots >= totalParticipants && totalParticipants > 0) {
      await processVerification(tournamentId);
    }
  } catch (error) {
    console.log("Error checking tournament results:", error);
  }
};

// Process verification and determine winner(s)
const processVerification = async (tournamentId) => {
  try {
    // Get tournament details
    const tournamentResult = await pool.query(
      "SELECT * FROM tournaments WHERE id = $1",
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      throw new Error("Tournament not found");
    }

    const tournament = tournamentResult.rows[0];

    // Get all screenshots for this tournament
    const screenshotsResult = await pool.query(
      "SELECT * FROM tournament_screenshots WHERE tournament_id = $1",
      [tournamentId]
    );

    // Count verified wins
    const winners = screenshotsResult.rows.filter(
      (screenshot) => screenshot.verification_status === "verified_win"
    );

    // If there is exactly one winner, award the prize
    if (winners.length === 1) {
      const winnerId = winners[0].user_id;

      // Mark in tournament_results
      await pool.query(
        `INSERT INTO tournament_results 
         (tournament_id, winner_id, prize_awarded, prize_amount, resolution_method, resolved_at) 
         VALUES ($1, $2, true, $3, 'automatic', CURRENT_TIMESTAMP)
         ON CONFLICT (tournament_id) 
         DO UPDATE SET 
           winner_id = EXCLUDED.winner_id, 
           prize_awarded = EXCLUDED.prize_awarded,
           prize_amount = EXCLUDED.prize_amount,
           resolution_method = EXCLUDED.resolution_method,
           resolved_at = EXCLUDED.resolved_at`,
        [tournamentId, winnerId, tournament.prize_pool]
      );

      // Update user's wallet and increment total_wins
      await pool.query("UPDATE users SET wallet = wallet + $1, total_wins = COALESCE(total_wins, 0) + 1 WHERE id = $2", [
        tournament.prize_pool,
        winnerId,
      ]);
      
      // Get the winner's name
      const winnerResult = await pool.query(
        "SELECT name FROM users WHERE id = $1",
        [winnerId]
      );
      
      const winnerName = winnerResult.rows[0]?.name || "A participant";
      
      // Get all participants to notify them
      const participantsResult = await pool.query(
        `SELECT ut.user_id
         FROM user_tournaments ut 
         WHERE ut.tournament_id = $1`,
        [tournamentId]
      );
      
      // Send notifications to all participants
      const participants = participantsResult.rows;
      const notificationTitle = `Tournament Results: ${tournament.name}`;
      const notificationBody = `${winnerName} has won the tournament and received ₹${tournament.prize_pool} prize money!`;
      
      for (const participant of participants) {
        await sendUserNotification(
          participant.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: "tournament_winner",
            tournament_id: tournamentId,
            route: "tournaments/" + tournamentId,
            winner_id: winnerId
          }
        );
      }

      return {
        message: "Tournament winner automatically determined and prize awarded",
        winner_id: winnerId,
        resolution_method: "automatic",
        prize_amount: tournament.prize_pool,
      };
    }
    // If there are multiple winners or no winners, mark for admin review
    else {
      // Mark all screenshots with win status as disputed
      await pool.query(
        `UPDATE tournament_screenshots 
         SET verification_status = 'disputed' 
         WHERE tournament_id = $1 AND verification_status = 'verified_win'`,
        [tournamentId]
      );

      // Create tournament result entry but don't award prize yet
      await pool.query(
        `INSERT INTO tournament_results 
         (tournament_id, prize_awarded, prize_amount, resolution_method, created_at) 
         VALUES ($1, false, $2, 'admin_decision', CURRENT_TIMESTAMP)
         ON CONFLICT (tournament_id) 
         DO UPDATE SET 
           prize_awarded = EXCLUDED.prize_awarded,
           prize_amount = EXCLUDED.prize_amount,
           resolution_method = EXCLUDED.resolution_method`,
        [tournamentId, tournament.prize_pool]
      );

      return {
        message:
          winners.length === 0
            ? "No clear winner detected. Tournament needs admin review."
            : `Multiple winners (${winners.length}) detected. Tournament needs admin review.`,
        winner_count: winners.length,
        resolution_method: "admin_decision",
        prize_amount: tournament.prize_pool,
      };
    }
  } catch (error) {
    console.log("Error processing verification:", error);
    throw error;
  }
};

// Get tournaments that need admin review
export const getDisputedTournaments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, tr.resolution_method, COUNT(ts.id) as disputed_screenshots
       FROM tournaments t
       JOIN tournament_results tr ON t.id = tr.tournament_id
       LEFT JOIN tournament_screenshots ts ON t.id = ts.tournament_id AND ts.verification_status = 'disputed'
       WHERE tr.resolution_method = 'admin_decision' AND tr.prize_awarded = false
       GROUP BY t.id, tr.resolution_method`
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.log("Error retrieving disputed tournaments:", error);
    res.status(500).json({
      message: "Failed to retrieve disputed tournaments",
      error: error.message,
    });
  }
};

// Admin reviews a screenshot and resolves tournament
export const adminReviewScreenshot = async (req, res) => {
  const { tournamentId } = req.params;
  const { winnerId, adminNotes } = req.body;

  if (!winnerId) {
    return res.status(400).json({ message: "Winner ID is required" });
  }

  try {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // Get tournament details
      const tournamentResult = await client.query(
        "SELECT * FROM tournaments WHERE id = $1",
        [tournamentId]
      );

      if (tournamentResult.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ message: "Tournament not found" });
      }

      const tournament = tournamentResult.rows[0];

      // Verify user is participant
      const participantCheck = await client.query(
        "SELECT * FROM user_tournaments WHERE user_id = $1 AND tournament_id = $2",
        [winnerId, tournamentId]
      );

      if (participantCheck.rows.length === 0) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({ message: "Selected winner is not a tournament participant" });
      }

      // Mark the winning screenshot
      await client.query(
        `UPDATE tournament_screenshots 
         SET verification_status = 'admin_reviewed', admin_notes = $1
         WHERE tournament_id = $2 AND user_id = $3`,
        [adminNotes, tournamentId, winnerId]
      );

      // Mark other screenshots as reviewed (not winners)
      await client.query(
        `UPDATE tournament_screenshots 
         SET verification_status = 'admin_reviewed', admin_notes = 'Admin selected different winner'
         WHERE tournament_id = $1 AND user_id != $2`,
        [tournamentId, winnerId]
      );

      // Update tournament result
      await client.query(
        `UPDATE tournament_results 
         SET winner_id = $1, prize_awarded = true, resolution_method = 'admin_decision', resolved_at = CURRENT_TIMESTAMP
         WHERE tournament_id = $2`,
        [winnerId, tournamentId]
      );

      // Award prize to winner and increment total_wins
      await client.query(
        "UPDATE users SET wallet = wallet + $1, total_wins = COALESCE(total_wins, 0) + 1 WHERE id = $2",
        [tournament.prize_pool, winnerId]
      );
      
      // Get the winner's name
      const winnerResult = await client.query(
        "SELECT name FROM users WHERE id = $1",
        [winnerId]
      );
      
      const winnerName = winnerResult.rows[0]?.name || "A participant";
      
      // Get all participants to notify them
      const participantsResult = await client.query(
        `SELECT ut.user_id
         FROM user_tournaments ut 
         WHERE ut.tournament_id = $1`,
        [tournamentId]
      );
      
      // Send notifications to all participants
      const participants = participantsResult.rows;
      const notificationTitle = `Tournament Results: ${tournament.name}`;
      const notificationBody = `${winnerName} has won the tournament and received ₹${tournament.prize_pool} prize money!`;
      
      for (const participant of participants) {
        await sendUserNotification(
          participant.user_id,
          notificationTitle,
          notificationBody,
          null,
          {
            type: "tournament_winner",
            tournament_id: tournamentId,
            route: "tournaments/" + tournamentId,
            winner_id: winnerId
          }
        );
      }

      await client.query("COMMIT");

      res.status(200).json({
        message: "Tournament winner determined by admin and prize awarded",
        tournament_id: tournamentId,
        winner_id: winnerId,
        prize_amount: tournament.prize_pool,
      });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.log("Error in admin review:", error);
    res.status(500).json({
      message: "Failed to process admin review",
      error: error.message,
    });
  }
};
