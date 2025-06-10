import { pool } from "../db/db.js";
import Razorpay from "razorpay";
import crypto from "crypto";
import { sendUserNotification } from "../utils/sendNotifications.js"; // Add this import

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

export const createDeposit = async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, userId } = req.body;

    if (!amount || !userId) {
      return res
        .status(400)
        .json({ success: false, message: "Amount and userId are required" });
    }

    // Create order in Razorpay
    const order = await razorpay.orders.create({
      amount: amount * 100, // Convert to paise
      currency: "INR",
      receipt: `deposit_${Date.now()}`,
    });

    // Record the transaction
    await client.query(
      `INSERT INTO transactions (user_id, type, amount, status, payment_method, transaction_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, "deposit", amount, "pending", "razorpay", order.id]
    );

    res.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error("Error creating deposit:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create deposit" });
  } finally {
    client.release();
  }
};

export const verifyPayment = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
      userId,
      amount,
    } = req.body;

    // Verify signature
    const shasum = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET);
    shasum.update(`${razorpay_order_id}|${razorpay_payment_id}`);
    const digest = shasum.digest("hex");

    if (digest !== razorpay_signature) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid signature" });
    }

    await client.query("BEGIN");

    // Update transaction status
    await client.query(
      `UPDATE transactions 
       SET status = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE transaction_id = $2`,
      ["completed", razorpay_order_id]
    );

    // Update user wallet
    await client.query(
      `UPDATE users 
       SET wallet = COALESCE(wallet, 0) + $1 
       WHERE id = $2`,
      [amount, userId]
    );

    await client.query("COMMIT");

    res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error verifying payment:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to verify payment" });
  } finally {
    client.release();
  }
};

export const requestWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const { amount, userId, accountType, accountDetails } = req.body;

    if (!amount || !userId || !accountType || !accountDetails) {
      return res.status(400).json({
        success: false,
        message: "Amount, userId, accountType, and accountDetails are required",
      });
    }

    await client.query("BEGIN");

    // Check user balance
    const userResult = await client.query(
      "SELECT wallet FROM users WHERE id = $1",
      [userId]
    );
    const userWallet = userResult.rows[0]?.wallet || 0;

    if (userWallet < amount) {
      return res
        .status(400)
        .json({ success: false, message: "Insufficient balance" });
    }

    // Create withdrawal request
    await client.query(
      `INSERT INTO transactions 
       (user_id, type, amount, status, payment_method, account_details) 
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, "withdrawal", amount, "pending", accountType, accountDetails]
    );

    // Lock the amount in user's wallet
    await client.query(
      `UPDATE users 
       SET wallet = wallet - $1 
       WHERE id = $2`,
      [amount, userId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: "Withdrawal request submitted successfully",
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error requesting withdrawal:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to submit withdrawal request" });
  } finally {
    client.release();
  }
};

// Update the getAdminTransactions function to support search and date filtering

export const getAdminTransactions = async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      status,
      type,
      page = 1,
      limit = 10,
      search,
      startDate,
      endDate,
    } = req.query;
    const offset = (page - 1) * limit;

    // Build the where clause conditionally
    let whereClause = "WHERE 1=1";
    const params = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND t.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (type) {
      whereClause += ` AND t.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    // Add search filter
    if (search) {
      whereClause += ` AND (
        u.username ILIKE $${paramIndex} 
        OR u.email ILIKE $${paramIndex}
        OR CAST(t.id AS TEXT) = $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Add date range filter
    if (startDate) {
      whereClause += ` AND t.created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      whereClause += ` AND t.created_at <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Count total records for pagination
    const countQuery = `
      SELECT COUNT(*) 
      FROM transactions t 
      JOIN users u ON t.user_id = u.id 
      ${whereClause}
    `;

    const countResult = await client.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(totalCount / limit);

    // Query for actual data with pagination
    const dataQuery = `
      SELECT t.*, u.username, u.email 
      FROM transactions t 
      JOIN users u ON t.user_id = u.id 
      ${whereClause}
      ORDER BY t.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const finalParams = [...params, limit, offset];
    const result = await client.query(dataQuery, finalParams);

    res.json({
      success: true,
      data: result.rows,
      totalCount,
      totalPages,
      currentPage: parseInt(page),
    });
  } catch (error) {
    console.error("Error fetching transactions:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch transactions" });
  } finally {
    client.release();
  }
};

export const processWithdrawal = async (req, res) => {
  const client = await pool.connect();
  try {
    const { transactionId, status, adminRemarks } = req.body;

    if (!transactionId || !status) {
      return res.status(400).json({
        success: false,
        message: "TransactionId and status are required",
      });
    }

    await client.query("BEGIN");

    // Get transaction details
    const txnResult = await client.query(
      "SELECT * FROM transactions WHERE id = $1",
      [transactionId]
    );
    const transaction = txnResult.rows[0];

    if (!transaction) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }

    if (status === "rejected") {
      // Refund the amount back to user's wallet
      await client.query(
        `UPDATE users 
         SET wallet = wallet + $1 
         WHERE id = $2`,
        [transaction.amount, transaction.user_id]
      );
    }

    // Update transaction status
    await client.query(
      `UPDATE transactions 
       SET status = $1, admin_remarks = $2, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $3`,
      [status, adminRemarks, transactionId]
    );

    // Send notification to user based on withdrawal status
    let notificationTitle, notificationBody;

    if (status === "completed") {
      notificationTitle = "Withdrawal Request Approved";
      notificationBody = `Your withdrawal request for ₹${transaction.amount} has been approved and processed.`;
    } else if (status === "rejected") {
      notificationTitle = "Withdrawal Request Rejected";
      notificationBody = `Your withdrawal request for ₹${
        transaction.amount
      } has been rejected. The amount has been refunded to your wallet.${
        adminRemarks ? " Reason: " + adminRemarks : ""
      }`;
    } else {
      notificationTitle = "Withdrawal Request Updated";
      notificationBody = `The status of your withdrawal request for ₹${transaction.amount} has been updated to ${status}.`;
    }

    // Send notification to the user who requested the withdrawal
    await sendUserNotification(
      transaction.user_id,
      notificationTitle,
      notificationBody,
      null,
      {
        type:
          status === "completed"
            ? "withdrawal_approved"
            : "withdrawal_rejected",
        transaction_id: transaction.id.toString(),
        route: "profile", // As requested, route to profile page
        status: status,
      }
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      message: `Withdrawal ${status} successfully`,
      notificationSent: true,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error processing withdrawal:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to process withdrawal" });
  } finally {
    client.release();
  }
};

export const getUserTransactions = async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, type } = req.query;
    console.log("type", type);

    let query = `
      SELECT * FROM transactions 
      WHERE user_id = $1
    `;
    const params = [userId];

    if (type && type !== "all") {
      query += ` AND type = $2`;
      params.push(type);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await client.query(query, params);

    res.json({
      success: true,
      data: result.rows,
    });
  } catch (error) {
    console.error("Error fetching user transactions:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  } finally {
    client.release();
  }
};
