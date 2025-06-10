import { pool } from "../db/db.js";
import crypto from "crypto";
import Razorpay from "razorpay";

// Initialize Razorpay with your key_id and key_secret
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// Get all membership plans
export const getMemberShipPlans = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const result = await pool.query("SELECT * FROM memberships");

    return res.json(result.rows);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Check user's membership status
export const getUserMemberShipStatus = async (req, res) => {
  try {
    const { userId: user_id } = req.auth;

    if (!user_id) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }
    const { userId } = req.body;

    // Get user membership details
    const user = await pool.query(
      "SELECT u.membership_id, u.membership_expiry, m.name as plan_name FROM users u LEFT JOIN memberships m ON u.membership_id = m.id WHERE u.id = $1",
      [userId]
    );

    if (!user.rows.length || !user.rows[0].membership_id) {
      return res.json({ active: false });
    }

    // Check if membership is active
    const isActive = new Date(user.rows[0].membership_expiry) > new Date();

    return res.json({
      active: isActive,
      expiresAt: user.rows[0].membership_expiry,
      plan: {
        id: user.rows[0].membership_id,
        name: user.rows[0].plan_name,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};

// Create Razorpay order
export const createOrder = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const { membershipId } = req.body;

    // Get membership details
    const membership = await pool.query(
      "SELECT * FROM memberships WHERE id = $1",
      [membershipId]
    );

    if (!membership.rows.length) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid membership plan" });
    }

    // Create a shorter receipt ID (must be <= 40 characters)
    // Format: mem_userId_timestamp (using last 8 digits of timestamp)
    const timestamp = Date.now().toString().slice(-8);
    const receipt = `mem_${userId}_${timestamp}`.slice(0, 40);

    console.log(receipt);
    // Create an order
    const options = {
      amount: membership.rows[0].price * 100, // Amount in paise
      currency: "INR",
      receipt: receipt, // This should now be within the 40 character limit
      notes: {
        membershipId: membershipId,
        userId: userId,
      },
    };

    // Create Razorpay order
    const order = await razorpay.orders.create(options);

    return res.json({
      success: true,
      orderId: order.id,
      amount: order.amount,
    });
  } catch (err) {
    console.error("Order creation error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

// Verify Razorpay payment
export const verifyPayment = async (req, res) => {
  try {
    const { userId } = req.auth;

    if (!userId) {
      return res
        .status(401)
        .json({ error: "Unauthorized: You need to log in." });
    }

    const {
      membershipId,
      razorpayPaymentId,
      razorpayOrderId,
      razorpaySignature,
      user_id
    } = req.body;

    // Verify signature
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest("hex");

    if (generatedSignature !== razorpaySignature) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    // Get membership details
    const membership = await pool.query(
      "SELECT * FROM memberships WHERE id = $1",
      [membershipId]
    );

    if (!membership.rows.length) {
      return res.status(400).json({
        success: false,
        message: "Invalid membership plan",
      });
    }

    // Calculate expiry date based on duration
    const expiryDate = new Date();
    const duration = membership.rows[0].duration;

    if (duration.days) {
      expiryDate.setDate(expiryDate.getDate() + parseInt(duration.days));
    } else if (duration.months) {
      expiryDate.setMonth(expiryDate.getMonth() + parseInt(duration.months));
    } else if (duration.years) {
      expiryDate.setFullYear(
        expiryDate.getFullYear() + parseInt(duration.years)
      );
    } else {
      // Default to 30 days if no valid duration
      expiryDate.setDate(expiryDate.getDate() + 30);
    }

    // Update user's membership
    await pool.query(
      "UPDATE users SET membership_id = $1, membership_expiry = $2 WHERE id = $3",
      [membershipId, expiryDate, user_id]
    );

    // Record the payment
    await pool.query(
      `INSERT INTO membership_payments 
       (user_id, membership_id, payment_id, order_id, amount, payment_date) 
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        user_id,
        membershipId,
        razorpayPaymentId,
        razorpayOrderId,
        membership.rows[0].price,
      ]
    );

    return res.json({
      success: true,
      message: "Membership activated successfully",
      expiresAt: expiryDate,
    });
  } catch (err) {
    console.error("Payment verification error:", err);
    return res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};
