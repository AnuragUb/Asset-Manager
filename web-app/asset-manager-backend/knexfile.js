
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
      port:     process.env.DB_PORT || 5432,
      charset:  'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
    migrations: {
      directory: './migrations'
    }
  },

  // Test Environment (Using Postgres)
  test: {
    client: 'postgresql',
    connection: {
      host: process.env.DB_HOST || 'localhost',
      database: process.env.DB_TEST_NAME || 'asset_manager_test',
      user:     process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || 'password',
      port:     process.env.DB_PORT || 5432,
      charset:  'utf8'
    },
    pool: {
      min: 2,
      max: 10
    },
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
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
      charset:  'utf8'
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
