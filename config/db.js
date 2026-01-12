// 01-May 2025
// HoRenSo Plus v3
import pg from "pg";
const { Pool } = pg;

const connectDB = async () => {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    max: 100,
    connectionTimeoutMillis: 0,
    idleTimeoutMillis: 0,
    ssl: {
      rejectUnauthorized: false,
      require: true,
    },
  });

  try {
    const results = await pool.query("SELECT NOW();");
    if (results.rows.length > 0) {
      console.log("PostgreSQL Connected!");
    }
    // It is common to return the pool or close it
    // depending on how you use this specific connectDB file.
    return pool;
  } catch (err) {
    console.error("PostgreSQL Connection Error:", err.message);
    process.exit(1); // Exit process with failure
  }
};

export default connectDB;
