import bcrypt from "bcryptjs";
import { pool } from "../../db/db.js";
import {
  generateAccessToken,
  generateRefreshToken,
} from "../../utils/admin/tokens.js";
import jwt from "jsonwebtoken";
import transporter from "../../utils/admin/nodemailer.js";
import crypto from "crypto";

export const loginAdmin = async (req, res) => {
  try {
    const { usernameOrEmail, password } = req.body;
    const result = await pool.query(
      "SELECT * FROM admins WHERE email = $1 OR username = $1",
      [usernameOrEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const admin = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, admin.password);

    if (!passwordMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(admin);
    const refreshToken = generateRefreshToken(admin);

    console.log("login access token", accessToken);
    console.log("refresh token", refreshToken);

    res.cookie("accessToken", accessToken, {
      httpOnly: true,
      secure: true, // Set to true since hosted backend likely uses HTTPS
      SameSite: "none", // Required for cross-site cookies
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: true, // Set to true since hosted backend likely uses HTTPS
      SameSite: "none", // Required for cross-site cookies
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
    return res.status(200).json({ message: "Login successful" });
  } catch (err) {
    console.error("Login Error:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

export const checkAdminAuthStatus = async (req, res) => {
  const token = req.cookies.accessToken;

  if (!token) {
    console.log("returining token");
    console.log(token);
    return res.json({ authenticated: false });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    console.log("returning token", token);
    return res.json({ authenticated: true, admin: decoded });
  } catch (err) {
    console.log("returining token", err);
    return res.json({ authenticated: false });
  }
};

export const logoutAdmin = (req, res) => {
  res.clearCookie("accessToken");
  res.clearCookie("refreshToken");
  return res.json({ success: true, message: "Logged out" });
};

export const refreshAccessToken = async (req, res) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    if (!refreshToken) return res.status(401).json({ message: "Unauthorized" });

    const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);

    const newAccessToken = generateAccessToken(decoded);

    console.log("refresshing token", newAccessToken);

    res.cookie("accessToken", newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      SameSite: "none",
      maxAge: 15 * 60 * 1000, // 15 minute
    });

    return res.status(200).json({ newAccessToken: newAccessToken });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    return res.status(403).json({ message: "Invalid refresh token" });
  }
};

export const generatePasswordResetOTP = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const otp = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(`DELETE FROM password_resets WHERE email = $1`, [email]);

    await pool.query(
      `INSERT INTO password_resets (email, otp_hash, expires_at) 
       VALUES ($1, $2, NOW() + INTERVAL '15 minutes')`,
      [email, otpHash]
    );

    await transporter.sendMail({
      from: "skillarena@gmail.com",
      to: email,
      subject: "Password Reset OTP",
      text: `Your OTP is: ${otp}. It will expire in 15 minutes.`,
    });

    return res.status(200).json({ message: "OTP sent to your email" });
  } catch (error) {
    return res
      .status(500)
      .json({ message: "Something went wrong! Please try again later" });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    const { otp, email } = req.body;

    console.log(otp, email);

    const result = await pool.query(
      `
      SELECT otp_hash FROM password_resets 
      WHERE email = $1 AND expires_at > NOW()
      ORDER BY created_at DESC 
      LIMIT 1
    `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ message: "Otp not found or expired otp" });
    }

    const isValidOTP = await bcrypt.compare(otp, result.rows[0].otp_hash);

    if (!isValidOTP) {
      return res
        .status(400)
        .json({ message: "Invalid otp please try with correct otp" });
    }

    await pool.query(
      `INSERT INTO email_verifications (email, otp_verified) 
       VALUES ($1, TRUE) 
       ON CONFLICT (email) DO UPDATE 
       SET otp_verified = TRUE`,
      [email]
    );

    return res.status(200).json({ message: "OTP verified" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "something went wrong!" });
  }
};

export const resetPassword = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const otpVerificationResult = await pool.query(
      `SELECT * FROM email_verifications WHERE email = $1 AND otp_verified = TRUE`,
      [email]
    );

    if (otpVerificationResult.rowCount === 0) {
      return res.status(400).json({ message: "OTP not verified" });
    }

    const hashedPassword = await bcrypt.hash(password, 14);

    const updateResult = await pool.query(
      `UPDATE admins SET password = $1 WHERE email = $2 RETURNING email`,
      [hashedPassword, email]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Delete the OTP verification record after successful reset
    await pool.query(`DELETE FROM email_verifications WHERE email = $1`, [
      email,
    ]);

    // Delete the used password reset request
    await pool.query(`DELETE FROM password_resets WHERE email = $1`, [email]);

    return res.status(200).json({ message: "Password reset successfully" });
  } catch (error) {
    console.log(error);
    return res.status(500).json({ message: "Something went wrong!" });
  }
};
