

export const initChatTables = async () => {
  try {
    // AUTH & ADMIN TABLES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS email_verifications (
        email VARCHAR(255) PRIMARY KEY,
        otp_verified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_resets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(100) NOT NULL,
        otp_hash VARCHAR(255) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // USERS & MEMBERSHIPS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS memberships (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        benefits TEXT[]
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        profile TEXT DEFAULT NULL,
        wallet NUMERIC(10,2) DEFAULT 0.00,
        total_games_played INT DEFAULT 0,
        total_wins INT DEFAULT 0,
        referral_code VARCHAR(50) UNIQUE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        username VARCHAR(255) UNIQUE DEFAULT NULL,
        applied_referral BOOLEAN DEFAULT FALSE,
        membership_expiry TIMESTAMP DEFAULT NULL,
        membership_id INT DEFAULT NULL,
        is_banned BOOLEAN DEFAULT FALSE,
        banned_until TIMESTAMP DEFAULT NULL,
        ban_reason TEXT DEFAULT NULL,
        account_details TEXT DEFAULT NULL,
        paytm_number VARCHAR(15) DEFAULT NULL,
        upi_id VARCHAR(100) DEFAULT NULL,
        upi_qr_code_url TEXT DEFAULT NULL
      );
    `);

    // CHAT TABLES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_messages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        is_system BOOLEAN DEFAULT FALSE
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS personal_messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT FALSE,
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // TOURNAMENT TABLES
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournaments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        game_name VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        image TEXT,
        entry_fee_normal INTEGER NOT NULL CHECK (entry_fee_normal >= 0),
        entry_fee_pro INTEGER NOT NULL CHECK (entry_fee_pro >= 0),
        prize_pool INTEGER NOT NULL CHECK (prize_pool >= 0),
        team_mode VARCHAR(10) NOT NULL CHECK (team_mode IN ('solo', 'duo', '4v4', '6v6', '8v8')),
        max_participants INTEGER NOT NULL CHECK (max_participants > 0),
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL CHECK (end_time > start_time),
        rules TEXT NOT NULL,
        status VARCHAR(20) NOT NULL CHECK (status IN ('upcoming', 'ongoing', 'completed')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        room_id VARCHAR(255),
        room_password VARCHAR(255)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_tournaments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        team_id INTEGER,
        payment_amount DECIMAL(10,2) NOT NULL,
        UNIQUE(user_id, tournament_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS teams (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS team_members (
        id SERIAL PRIMARY KEY,
        team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        is_captain BOOLEAN DEFAULT FALSE,
        UNIQUE(team_id, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournament_screenshots (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        screenshot_path TEXT NOT NULL,
        upload_timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        verification_status VARCHAR(50) DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified_win', 'verified_loss', 'disputed', 'admin_reviewed')),
        ocr_result TEXT,
        admin_notes TEXT,
        UNIQUE(tournament_id, user_id)
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS tournament_results (
        id SERIAL PRIMARY KEY,
        tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
        winner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        prize_awarded BOOLEAN DEFAULT FALSE,
        prize_amount DECIMAL(10,2),
        resolution_method VARCHAR(50) CHECK (resolution_method IN ('automatic', 'admin_decision')),
        resolved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_tournament_id UNIQUE (tournament_id)
      );
    `);

    // GAME & TRANSACTIONS
    await pool.query(`
      CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        image TEXT,
        status VARCHAR(20) NOT NULL CHECK (status IN ('upcoming', 'active', 'inactive')),
        platform VARCHAR(100),
        genre VARCHAR(100),
        release_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        type VARCHAR(50) NOT NULL CHECK (type IN ('deposit', 'withdrawal')),
        amount DECIMAL(10,2) NOT NULL,
        status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'completed', 'rejected')),
        payment_method VARCHAR(50) NOT NULL,
        account_details TEXT,
        transaction_id VARCHAR(255),
        admin_remarks TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS membership_payments (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        membership_id INTEGER NOT NULL REFERENCES memberships(id),
        payment_id VARCHAR(255) NOT NULL,
        order_id VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(50) DEFAULT 'completed'
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS prize_margin (
        id SERIAL PRIMARY KEY,
        margin INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await pool.query(`
     CREATE TABLE IF NOT EXISTS membership_games (
  id SERIAL PRIMARY KEY,
  membership_id INTEGER NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  UNIQUE(membership_id, game_id)
);

    `);
    await pool.query(`
     CREATE TABLE IF NOT EXISTS pages (
  id SERIAL PRIMARY KEY,
  page_name VARCHAR(50) NOT NULL UNIQUE,
  title VARCHAR(100) NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES admins(id)
);

    `);



    await pool.query(`
      ALTER TABLE games 
      ADD COLUMN IF NOT EXISTS access_type VARCHAR(10) NOT NULL DEFAULT 'free' 
      CHECK (access_type IN ('free', 'pro'))
    `);
    
    // Set all games to free initially
    await pool.query(`
      UPDATE games 
      SET access_type = 'free'
    `);
    
    // Find all games that are in a membership and mark them as pro
    await pool.query(`
      UPDATE games
      SET access_type = 'pro'
      WHERE id IN (
        SELECT DISTINCT game_id FROM membership_games
      )
    `);

    console.log("All tables initialized successfully.");
  } catch (error) {
    console.error("Error initializing tables:", error);
  }
};
