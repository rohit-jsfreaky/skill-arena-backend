import { pool } from '../../db/db.js';
import { sendUserNotification } from '../../utils/sendNotifications.js';

// Get a list of tournaments with disputed results needing admin review
export const getDisputedTournaments = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, tr.resolution_method, COUNT(ts.id) as disputed_screenshots_count
       FROM tournaments t
       JOIN tournament_results tr ON t.id = tr.tournament_id
       LEFT JOIN tournament_screenshots ts ON t.id = ts.tournament_id AND ts.verification_status = 'disputed'
       WHERE tr.resolution_method = 'admin_decision' AND tr.prize_awarded = false
       GROUP BY t.id, tr.id
       ORDER BY t.end_time DESC`
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error retrieving disputed tournaments:', error);
    res.status(500).json({ message: 'Failed to retrieve disputed tournaments', error: error.message });
  }
};

// Get all screenshots for a specific tournament for admin review
export const getTournamentScreenshotsForAdmin = async (req, res) => {
  const { tournamentId } = req.params;

  try {
    // Get all screenshots with user information for this tournament
    const result = await pool.query(
      `SELECT ts.*, u.name as user_name, u.username, u.email
       FROM tournament_screenshots ts
       JOIN users u ON ts.user_id = u.id
       WHERE ts.tournament_id = $1
       ORDER BY ts.verification_status DESC, ts.upload_timestamp ASC`,
      [tournamentId]
    );

    // Get tournament details
    const tournamentResult = await pool.query(
      `SELECT t.*, tr.prize_awarded, tr.prize_amount, tr.resolution_method
       FROM tournaments t
       LEFT JOIN tournament_results tr ON t.id = tr.tournament_id
       WHERE t.id = $1`,
      [tournamentId]
    );

    if (tournamentResult.rows.length === 0) {
      return res.status(404).json({ message: 'Tournament not found' });
    }

    // Return tournament details and all screenshots
    res.status(200).json({
      tournament: tournamentResult.rows[0],
      screenshots: result.rows
    });
  } catch (error) {
    console.error('Error retrieving tournament screenshots for admin:', error);
    res.status(500).json({ message: 'Failed to retrieve screenshots', error: error.message });
  }
};

// Admin reviews a tournament and determines the winner
export const adminReviewTournament = async (req, res) => {
  const { tournamentId } = req.params;
  const { winnerId, adminNotes } = req.body;

  if (!winnerId) {
    return res.status(400).json({ message: 'Winner ID is required' });
  }

  try {
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Get tournament details
      const tournamentResult = await client.query(
        'SELECT * FROM tournaments WHERE id = $1',
        [tournamentId]
      );
      
      if (tournamentResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: 'Tournament not found' });
      }
      
      const tournament = tournamentResult.rows[0];
      
      // Verify user is participant
      const participantCheck = await client.query(
        'SELECT * FROM user_tournaments WHERE user_id = $1 AND tournament_id = $2',
        [winnerId, tournamentId]
      );
      
      if (participantCheck.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: 'Selected winner is not a tournament participant' });
      }
      
      // Mark the winner's screenshot as admin_reviewed
      await client.query(
        `UPDATE tournament_screenshots 
         SET verification_status = 'admin_reviewed', admin_notes = $1
         WHERE tournament_id = $2 AND user_id = $3`,
        [adminNotes || 'Selected as winner by admin', tournamentId, winnerId]
      );
      
      // Mark all other screenshots as reviewed but not winners
      await client.query(
        `UPDATE tournament_screenshots 
         SET verification_status = 'admin_reviewed', admin_notes = 'Admin selected different winner'
         WHERE tournament_id = $1 AND user_id != $2`,
        [tournamentId, winnerId]
      );
      
      // Update tournament result
      await client.query(
        `INSERT INTO tournament_results 
         (tournament_id, winner_id, prize_awarded, prize_amount, resolution_method, resolved_at) 
         VALUES ($1, $2, true, $3, 'admin_decision', CURRENT_TIMESTAMP)
         ON CONFLICT (tournament_id) 
         DO UPDATE SET 
           winner_id = EXCLUDED.winner_id, 
           prize_awarded = EXCLUDED.prize_awarded,
           prize_amount = EXCLUDED.prize_amount,
           resolution_method = EXCLUDED.resolution_method,
           resolved_at = EXCLUDED.resolved_at`,
        [tournamentId, winnerId, tournament.prize_pool]
      );
      
      // Award prize to winner and increment total_wins
      await client.query(
        'UPDATE users SET wallet = wallet + $1, total_wins = COALESCE(total_wins, 0) + 1 WHERE id = $2 RETURNING wallet, total_wins',
        [tournament.prize_pool, winnerId]
      );

      // Get winner details
      const winnerDetails = await client.query(
        'SELECT name, username, email, wallet, total_wins FROM users WHERE id = $1',
        [winnerId]
      );
      
      // Get all participants for this tournament
      const participantsResult = await client.query(
        `SELECT ut.user_id
         FROM user_tournaments ut 
         WHERE ut.tournament_id = $1`,
        [tournamentId]
      );
      
      const participants = participantsResult.rows;
      const winnerName = winnerDetails.rows[0]?.name || "A participant";
      
      // Send notifications to all participants
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
      
      await client.query('COMMIT');
      
      res.status(200).json({
        message: 'Tournament winner determined by admin and prize awarded',
        tournament_id: tournamentId,
        tournament_name: tournament.name,
        winner: winnerDetails.rows[0],
        prize_amount: tournament.prize_pool,
        notificationsSent: participants.length
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error in admin review:', error);
    res.status(500).json({ message: 'Failed to process admin review', error: error.message });
  }
};