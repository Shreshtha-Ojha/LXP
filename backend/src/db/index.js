// src/db/index.js
// PostgreSQL connection pool using pg.
// All queries go through this. Never create direct connections in modules.

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  family: 4,
  max: parseInt(process.env.DB_POOL_MAX || '20'),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
})

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err)
})

/**
 * Run a query on the pool.
 * Usage: const result = await db.query('SELECT ...', [params])
 */
async function query(text, params) {
  const start = Date.now()
  const result = await pool.query(text, params)
  const duration = Date.now() - start
  if (duration > 1000) {
    console.warn('Slow query detected:', { text, duration, rows: result.rowCount })
  }
  return result
}

/**
 * Get a client from the pool for transactions.
 * Always release the client in a finally block.
 *
 * Usage:
 *   const client = await db.getClient()
 *   try {
 *     await client.query('BEGIN')
 *     await client.query(...)
 *     await auditLog.write({ ... }, client)
 *     await client.query('COMMIT')
 *   } catch (e) {
 *     await client.query('ROLLBACK')
 *     throw e
 *   } finally {
 *     client.release()
 *   }
 */
async function getClient() {
  return pool.connect()
}

module.exports = { query, getClient }
