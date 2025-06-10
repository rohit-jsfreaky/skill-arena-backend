import { pool } from "../db/db.js";

export const findAdminByEmailOrUsername = async (identifier) => {
  const query = "SELECT * FROM admins WHERE email = $1 OR username = $1";
  const { rows } = await pool.query(query, [identifier]);
  return rows[0];
};

export const createAdmin = async (username, email, passwordHash) => {
  const query = "INSERT INTO admins (username, email, password) VALUES ($1, $2, $3) RETURNING *";
  const { rows } = await pool.query(query, [username, email, passwordHash]);
  return rows[0];
};

export const updateAdminPassword = async (email, passwordHash) => {
  const query = "UPDATE admins SET password = $1 WHERE email = $2 RETURNING *";
  const { rows } = await pool.query(query, [passwordHash, email]);
  return rows[0];
};
