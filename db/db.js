import dotenv from "dotenv";
import pkg from "pg"; // Import all pg as an object

dotenv.config();

const { Pool } = pkg; // Extract Pool from pg package

export const pool = new Pool({
  host: process.env.PG_HOST,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
  port: process.env.PG_PORT,
});

pool
  .connect()
  .then(() => console.log("Connected to PostgreSQL ✅"))
  .catch((err) => console.error("Connection error ❌", err));
