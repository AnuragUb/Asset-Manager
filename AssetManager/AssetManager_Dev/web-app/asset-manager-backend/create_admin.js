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

    console.log('Granting user management permissions...');
    // 1. Ensure 'superuser' role exists
    await db('roles').insert({ name: 'superuser', description: 'Full System Access' }).onConflict('name').ignore();
    
    // 2. Ensure 'user.manage' permission exists
    await db('permissions').insert({ key: 'user.manage', description: 'Ability to create and manage users' }).onConflict('key').ignore();
    
    // 3. Link permission to superuser role
    await db('role_permissions').insert({ role_name: 'superuser', permission_key: 'user.manage' }).onConflict(['role_name', 'permission_key']).ignore();

    console.log('-----------------------------------');
    console.log('Admin user and permissions setup successfully!');
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
