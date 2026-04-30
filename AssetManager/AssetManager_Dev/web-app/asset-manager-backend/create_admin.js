const knex = require('knex');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const db = knex({
  client: 'postgresql',
  connection: {
    host: process.env.DB_HOST || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    database: process.env.DB_NAME || 'asset_manager',
    port: process.env.DB_PORT || 5432,
  }
});

async function createAdmin() {
  try {
    const username = 'admin';
    const password = 'password123';
    const fullname = 'System Administrator';
    const role = 'superuser';
    const companyName = 'CINEOM';

    console.log('Checking for existing admin user...');
    const existingUser = await db('users').where({ username }).first();
    if (existingUser) {
      console.log('Admin user already exists.');
      process.exit(0);
    }

    console.log('Creating default company...');
    let company = await db('companies').where({ name: companyName }).first();
    if (!company) {
      const companyId = crypto.randomUUID();
      await db('companies').insert({ id: companyId, name: companyName });
      company = { id: companyId };
    }

    console.log('Hashing password...');
    const passwordHash = await bcrypt.hash(password, 12);

    console.log('Inserting admin user...');
    await db('users').insert({
      username,
      password: passwordHash,
      fullname,
      role,
      company_id: company.id,
      client_id: company.id
    });

    console.log('-----------------------------------');
    console.log('Admin user created successfully!');
    console.log(`Username: ${username}`);
    console.log(`Password: ${password}`);
    console.log('-----------------------------------');
    process.exit(0);
  } catch (err) {
    console.error('Error creating admin user:', err);
    process.exit(1);
  }
}

createAdmin();
