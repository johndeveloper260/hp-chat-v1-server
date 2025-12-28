const { Pool } = require("pg");

let mainPool = null;

const createPool = () => {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_DATABASE,
    max: 10,
    connectionTimeoutMillis: 0,
    idleTimeoutMillis: 0,
    ssl: {
      rejectUnauthorized: false,
      require: true,
    },
  });

  return pool;
};

exports.getPool = () => {
  if (!mainPool) {
    mainPool = createPool();
  }
  return mainPool;
};
