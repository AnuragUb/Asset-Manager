
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

module.exports = {
  // Development: PostgreSQL (Primary via Docker)
  development: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_NAME || 'asset_manager',
      user:     process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      port:     process.env.DB_PORT || 5432
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations'
    }
  },

  // SQLite (Local fast testing or fallback)
  sqlite: {
    client: 'better-sqlite3',
    connection: {
      filename: process.env.DB_PATH || path.join(__dirname, '../../data/test/database_v2.db')
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    }
  },

  // Test Environment
  test: {
    client: 'better-sqlite3',
    connection: {
      filename: ':memory:'
    },
    useNullAsDefault: true,
    migrations: {
      directory: './migrations'
    }
  },

  // Production: PostgreSQL (Remote/Cloud)
  production: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST,
      database: process.env.DB_NAME,
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      port:     process.env.DB_PORT || 5432,
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
    },
    pool: {
      min: 2,
      max: 20
    },
    migrations: {
      directory: './migrations'
    }
  }
};
