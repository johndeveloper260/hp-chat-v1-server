//01-May 2025
//HoRenSo Plus v3

const { Pool } = require("pg");

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

  const results = await pool.query("SELECT NOW();");
  // console.table(results.rows);
  if (results.rows.length > 0) {
    console.log("PostgresSQL Connected!");
  }
};

module.exports = connectDB;
