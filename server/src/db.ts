import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

export const pool = mysql.createPool({
  host:     process.env.DB_HOST     ?? 'localhost',
  port:     Number(process.env.DB_PORT ?? 3306),
  user:     process.env.DB_USER     ?? 'root',
  password: process.env.DB_PASSWORD ?? '',
  database: process.env.DB_NAME     ?? 'farmtycoon',
  waitForConnections: true,
  connectionLimit:    20,
  timezone: '+00:00',
});

export async function testConnection(): Promise<void> {
  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
}

export async function initTables(): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS market_orders (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      farm_id VARCHAR(64) NOT NULL,
      market_city VARCHAR(64) NOT NULL,
      merchant_id VARCHAR(64) NOT NULL,
      product_id VARCHAR(64) NOT NULL,
      amount INT NOT NULL,
      filled_amount INT DEFAULT 0,
      price_per_unit FLOAT DEFAULT 0,
      earned_total INT DEFAULT 0,
      status ENUM('pending','partial','filled','expired') DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      INDEX idx_user_status (user_id, status),
      INDEX idx_city_merchant (market_city, merchant_id, product_id, status)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS market_credits (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      amount_eur INT NOT NULL DEFAULT 0,
      product_changes_json TEXT NOT NULL,
      description VARCHAR(256),
      order_id BIGINT DEFAULT NULL,
      applied TINYINT(1) DEFAULT 0,
      created_at BIGINT NOT NULL,
      INDEX idx_user_applied (user_id, applied)
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS market_reputation (
      user_id INT NOT NULL,
      market_city VARCHAR(64) NOT NULL,
      score FLOAT DEFAULT 10.0,
      PRIMARY KEY (user_id, market_city)
    )
  `);
}
