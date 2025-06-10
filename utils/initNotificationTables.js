import { pool } from "../db/db.js";

export const initNotificationTables = async () => {
  try {
    // FCM Device Tokens Table - Stores user device tokens for sending notifications
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_token TEXT NOT NULL,
        device_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, device_token)
      );
    `);

    // Notification Records Table - Stores all sent notifications for history/tracking
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL, 
        image_url TEXT,
        data JSONB,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_global BOOLEAN DEFAULT FALSE,
        is_read BOOLEAN DEFAULT FALSE,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent_by INTEGER REFERENCES admins(id) ON DELETE SET NULL
      );
    `);
    await pool.query(`
      ALTER TABLE notifications
DROP CONSTRAINT IF EXISTS notifications_sent_by_fkey;
    `);

    console.log("Notification tables initialized successfully");
  } catch (error) {
    console.error("Error initializing notification tables:", error);
  }
};