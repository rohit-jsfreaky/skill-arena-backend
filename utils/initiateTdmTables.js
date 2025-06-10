import { pool } from "../db/db.js";

export const initTdmTables = async () => {
  try {
    // TDM Matches Table
    // Add team_size to tdm_matches table
    await pool.query(`
  CREATE TABLE IF NOT EXISTS tdm_matches (
    id SERIAL PRIMARY KEY,
    match_type VARCHAR(20) NOT NULL CHECK (match_type IN ('public', 'private')),
    status VARCHAR(20) NOT NULL CHECK (status IN ('waiting', 'team_a_ready', 'team_b_ready', 'confirmed', 'in_progress', 'completed', 'cancelled')),
    room_id VARCHAR(100),
    room_password VARCHAR(100),
    game_name VARCHAR(255) NOT NULL,
    entry_fee DECIMAL(10,2) NOT NULL CHECK (entry_fee >= 0),
    prize_pool DECIMAL(10,2) NOT NULL CHECK (prize_pool >= 0),
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    winner_team_id INTEGER,
    team_size INTEGER DEFAULT 4 CHECK (team_size IN (4, 6, 8))
  );
`);

    // TDM Teams Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tdm_teams (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES tdm_matches(id) ON DELETE CASCADE,
        team_type VARCHAR(10) NOT NULL CHECK (team_type IN ('team_a', 'team_b')),
        team_name VARCHAR(100),
        is_ready BOOLEAN DEFAULT FALSE,
        payment_completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // TDM Team Members Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tdm_team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES tdm_teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_captain BOOLEAN DEFAULT FALSE,
        payment_amount DECIMAL(10,2),
        payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'completed')),
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(team_id, user_id)
      );
    `);

    // TDM Match Results Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tdm_match_results (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES tdm_matches(id) ON DELETE CASCADE,
        winner_team_id INTEGER REFERENCES tdm_teams(id) ON DELETE SET NULL,
        prize_awarded BOOLEAN DEFAULT FALSE,
        prize_amount DECIMAL(10,2),
        resolution_method VARCHAR(50) CHECK (resolution_method IN ('automatic', 'admin_decision')),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(match_id)
      );
    `);

    // TDM Match Screenshots Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tdm_match_screenshots (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES tdm_matches(id) ON DELETE CASCADE,
        team_id INTEGER NOT NULL REFERENCES tdm_teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        screenshot_path TEXT NOT NULL,
        upload_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verification_status VARCHAR(50) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified_win', 'verified_loss', 'disputed', 'admin_reviewed')),
        ocr_result TEXT,
        admin_notes TEXT
      );
    `);

    // TDM Dispute Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tdm_disputes (
        id SERIAL PRIMARY KEY,
        match_id INTEGER NOT NULL REFERENCES tdm_matches(id) ON DELETE CASCADE,
        reported_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        reported_team_id INTEGER NOT NULL REFERENCES tdm_teams(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        evidence_path TEXT,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'under_review', 'resolved', 'rejected')),
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      );
    `);

    console.log("TDM tables initialized successfully");
  } catch (error) {
    console.error("Error initializing TDM tables:", error);
  }
};
