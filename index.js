import express from "express";
import cors from "cors";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import cookieParser from "cookie-parser";
import cron from "node-cron";
import helmet from "helmet";
import { pool } from "./db/db.js";
import { userRoutes } from "./routes/users.js";
import { chatRoutes } from "./routes/globalChat.js";
import {
  chatSocketsManager,
  initializeSocketIO,
} from "./utils/socketManager.js";
import { personalMessageRoutes } from "./routes/userChat.js";
import { membershipRoutes } from "./routes/membership.js";
import tournamentsRouter from "./routes/tournaments.js";
import tournamentResultsRouter from "./routes/tournamentResults.js";
import "./utils/TournamentStatusCheck.js";
import "./utils/adminAuthotpcheck.js";
import { initChatTables } from "./utils/initiateTables.js";
import { adminTournamentRouter } from "./routes/admin/tournament.js";
import { adminAuthRoutes } from "./routes/admin/adminAuth.js";
import bcrypt from "bcryptjs";
import { adminUsersRouter } from "./routes/admin/users.js";
import "./utils/UserBanCheck.js";
import { adminDashboardRouter } from "./routes/admin/dashboard.js";
import { adminGamesRouter } from "./routes/admin/games.js";
import paymentRouter from "./routes/transactions.js";
import { adminMembershipRouter } from "./routes/admin/membership.js";
import { adminTournamentResultsRouter } from "./routes/admin/tournamentResults.js";
import { updateSchemaConstraints } from "./utils/updateSchemaConstraints.js";
import tdmRouter from "./routes/tdm/tdmMatch.js";
import adminTdmRouter from "./routes/admin/tdmMatch.js";
import { initTdmTables } from "./utils/initiateTdmTables.js";
import leaderboardRouter from "./routes/leaderboard.js";
import gamesRouter from "./routes/games.js";
import adminNotificationRouter from "./routes/admin/notifications.js";
import notificationRouter from "./routes/notifications.js";
import { initNotificationTables } from "./utils/initNotificationTables.js";
import marginRouter from "./routes/admin/margin.js";
import { adminPagesRouter } from "./routes/admin/pages.js";
import { pagesRouter } from "./routes/pages.js";
import { createFinalSchema } from "./utils/intiateMainTables.js";
import { adminLeaderboardRouter } from "./routes/admin/leaderboard.js";
import { adminPlatformStatsRouter } from "./routes/admin/platformStats.js";
import { platformStatsRouter } from "./routes/platformStats.js";
import { initPlatformStatsTable } from "./utils/initPlatformStats.js";
import { initLeaderboardTables } from "./utils/initLeaderboardTables.js";
import { fixLeaderboardSchema } from "./utils/fixLeaderboardSchema.js";
import { addYoutubeLiveUrlColumn } from "./utils/addYoutubeLiveUrl.js";

const app = express();
const port = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = initializeSocketIO(httpServer);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://skill-arena-frontend.vercel.app",
    ], // ✅ Replace with your frontend URL
    credentials: true, // ✅ Allow cookies/auth headers
  })
);

app.use(express.json());
app.use(helmet());
app.use(cookieParser());
// app.set('trust proxy', true);

app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  next();
});

// Database connection check
pool.query("SELECT NOW()", (err, res) => {
  if (err) {
    console.error("Query error ❌", err);
  } else {
    console.log("PostgreSQL Time:", res.rows[0]);
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "uploads/")); // Store uploaded files in the 'uploads' directory
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({ storage: storage });

app.post("/", upload.any(), (req, res) => {
  console.log("Files received:", req.files);
  console.log("Body received:", req.body);
  res.send("hello");
});

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.get("/", (req, res) => {
  res.send("Hello World");
});
// API routes
app.use("/api/user", userRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/personal-messages", personalMessageRoutes);
app.use("/api/memberships", membershipRoutes);
app.use("/api/tournaments", tournamentsRouter);
app.use("/api/tournament-results", tournamentResultsRouter);
app.use("/api/admin/tournaments", adminTournamentRouter);
app.use("/api/admin/tournament-results", adminTournamentResultsRouter);
app.use("/api/admin/auth", adminAuthRoutes);
app.use("/api/admin/users", adminUsersRouter);
app.use("/api/admin/dashboard", adminDashboardRouter);
app.use("/api/admin/games", adminGamesRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/admin/memberships", adminMembershipRouter);
app.use("/api/tdm", tdmRouter);
app.use("/api/admin/tdm", adminTdmRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/games", gamesRouter);
// Add new notification routes
app.use("/api/admin/notifications", adminNotificationRouter);
app.use("/api/notifications", notificationRouter);
app.use("/api/admin/margin", marginRouter);
app.use("/api/admin/pages", adminPagesRouter);
app.use("/api/pages", pagesRouter);
app.use("/api/admin/leaderboard", adminLeaderboardRouter);
app.use("/api/admin/platform-stats", adminPlatformStatsRouter);
app.use("/api/platform-stats", platformStatsRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);

  res.status(500).send("Something broke!");
});


// createFinalSchema()
//  initChatTables()
//  updateSchemaConstraints()
//  initTdmTables();
// Initialize notification tables
//  initNotificationTables();
// Initialize leaderboard tables
//  initLeaderboardTables();
// Fix leaderboard schema
// fixLeaderboardSchema();
// Add YouTube live URL column to tournaments
// addYoutubeLiveUrlColumn();
// Initialize platform statistics table
// initPlatformStatsTable();

chatSocketsManager();

cron.schedule("0 0 * * *", async () => {
  try {
    await pool.query(
      "UPDATE users SET membership_id = NULL WHERE membership_expiry < NOW()"
    );
    console.log("Expired memberships updated");
  } catch (err) {
    console.error("Error updating expired memberships:", err);
  }
});

httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

async function hashPassword() {
  const saltRounds = 10;
  const hashedPassword = await bcrypt.hash("admin123", saltRounds);
  console.log(hashedPassword);
}

hashPassword();
