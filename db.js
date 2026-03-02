const { Pool } = require("pg");

const pool = new Pool({
  user: "postgres",
  host: "localhost",
  database: "REC",
  password: "rahma",   
  port: 5432,
});

module.exports = pool;
