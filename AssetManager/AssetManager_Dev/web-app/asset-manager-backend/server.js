console.log('Starting server.js...');
const express = require('express')
const path = require('path')
const qrcode = require('qrcode')
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const dns = require('dns').promises;
// const Evilscan = require('evilscan');
// const { find } = require('local-devices');
// const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cache = require('./services/cacheService');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '../../input');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

const exportDir = path.join(__dirname, '../../export');
if (!fs.existsSync(exportDir)) {
  fs.mkdirSync(exportDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage });

const ocrUpload = multer({ storage: multer.memoryStorage() });
const { 
  db, 
  readJson, 
  writeJson, 
  getLocalIP, 
  appendAudit, 
  readDynamic, 
  writeDynamic, 
  genCode, 
  typeCode, 
  locCode, 
  purposeCode, 
  dateCode, 
  generateModernAssetId,
  generateSplitAssetId,
  generateProjectId,
  generateProjectQRPayload,
  generateTempAssetId,
  makeIdForAsset, 
  assetsFile, 
  usersFile, 
  auditFile, 
  dynamicFile, 
  sendTallyRequest, 
  parseTallyXml, 
  TALLY_CONFIG,
  getTallyConfig,
  normalizeDBData,
  legacyDb
} = require('./utils')
const crypto = require('crypto');
const tokenService = require('./services/tokenService');
const passwordService = require('./services/passwordService');
const emailService = require('./services/emailService');
const encryptionService = require('./services/encryptionService');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const JWT_EXPIRES_IN_SECONDS = parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '3600', 10);
const JWT_COOKIE_NAME = 'auth_token';
const REMEMBER_COOKIE_NAME = 'remember_token';
const DEFAULT_COMPANY_NAME = 'CINEOM';
let DEFAULT_COMPANY_ID = null;

const app = express();
const port = process.env.PORT || 9090;

// --- DATABASE UTILITIES ---

/**
 * Universal Normalizer for PostgreSQL results.
 * Maps lowercase PostgreSQL keys to CamelCase/PascalCase keys expected by the frontend.
 * Also handles common type conversions and date formatting.
 */
function normalizeResult(data) {
  if (!data) return data;
  if (Array.isArray(data)) return data.map(item => normalizeResult(item));
  if (typeof data !== 'object') return data;

  const result = { ...data };
  const isPostgres = process.env.DB_CLIENT === 'postgresql';

  if (isPostgres) {
    // 1. Common Key Mapping (lower -> Pascal/Camel)
    const mappings = {
      'id': 'ID',
      'itemname': 'ItemName',
      'itemdescription': 'ItemDescription',
      'status': 'Status',
      'make': 'Make',
      'model': 'Model',
      'srno': 'SrNo',
      'serialno': 'SerialNo',
      'type': 'Type',
      'category': 'Category',
      'icon': 'Icon',
      'isplaceholder': 'IsPlaceholder',
      'parentid': 'ParentId',
      'currentlocation': 'CurrentLocation',
      'previouslocation': 'PreviousLocation',
      'dispatchreceivedt': 'DispatchReceiveDt',
      'purchasedetails': 'PurchaseDetails',
      'remarks': 'Remarks',
      'purpose': 'Purpose',
      'purchasedate': 'PurchaseDate',
      'lastupdated': 'LastUpdated',
      'qrcode': 'QRCode',
      'assignedto': 'AssignedTo',
      'macaddress': 'MACAddress',
      'ipaddress': 'IPAddress',
      'networktype': 'NetworkType',
      'physicalport': 'PhysicalPort',
      'vlan': 'VLAN',
      'socketid': 'SocketID',
      'userid': 'UserID',
      'noqr': 'NoQR',
      'currency': 'Currency',
      'asset_value': 'AssetValue',
      'unitprice': 'UnitPrice',
      'warranty_months': 'WarrantyMonths',
      'amc_months': 'AMCMonths',
      'employeeid': 'EmployeeID',
      'name': 'Name',
      'fullname': 'Fullname',
      'department': 'Department',
      'designation': 'Designation',
      'email': 'Email',
      'phone': 'Phone',
      'timestamp': 'Timestamp',
      'projectname': 'ProjectName',
      'clientname': 'ClientName',
      'location': 'Location',
      'startdate': 'StartDate',
      'enddate': 'EndDate',
      'owneremail': 'OwnerEmail',
      'coordinatoremail': 'CoordinatorEmail',
      'consigneename': 'ConsigneeName',
      'consigneeaddress': 'ConsigneeAddress',
      'consigneegstin': 'ConsigneeGSTIN',
      'consigneestate': 'ConsigneeState',
      'consigneestatecode': 'ConsigneeStateCode',
      'buyername': 'BuyerName',
      'buyeraddress': 'BuyerAddress',
      'buyergstin': 'BuyerGSTIN',
      'buyerstate': 'BuyerState',
      'buyerstatecode': 'BuyerStateCode',
      'ponumber': 'PONumber',
      'podate': 'PODate',
      'vendorname': 'VendorName',
      'totalamount': 'TotalAmount',
      'orderno': 'OrderNo',
      'orderdate': 'OrderDate',
      'challanno': 'ChallanNo',
      'customername': 'CustomerName',
      'deliverydate': 'DeliveryDate',
      'assetids': 'AssetIds',
      'payloadjson': 'PayloadJSON',
      'createdby': 'CreatedBy',
      'module': 'Module',
      'parentname': 'ParentName',
      'displayimage': 'DisplayImage',
      'identifier': 'Identifier'
    };

    Object.keys(data).forEach(key => {
      const mapped = mappings[key];
      if (mapped && mapped !== key) {
        result[mapped] = data[key];
      }
    });

    // 2. Specialized Logic
    if (result.PayloadJSON && typeof result.PayloadJSON === 'string') {
        try { result.PayloadJSON = JSON.parse(result.PayloadJSON); } catch(e) {}
    }
    if (result.metadata_json && typeof result.metadata_json === 'string') {
        try { result.metadata = JSON.parse(result.metadata_json); } catch(e) {}
    }
  }

  return result;
}

/**
 * Executes a query against the active database (Postgres or legacy SQLite).
 * Automatically normalizes results for PostgreSQL.
 */
async function executeQuery(tableName, callback) {
  const isPostgres = process.env.DB_CLIENT === 'postgresql';
  try {
    if (isPostgres) {
        const result = await callback(db(tableName));
        return normalizeResult(result);
    } else {
        // Fallback for legacy calls during transition
        console.warn(`[DB] Falling back to legacy SQLite for table: ${tableName}`);
        return null; 
    }
  } catch (err) {
    console.error(`[DB] Query Error on ${tableName}:`, err.message);
    throw err;
  }
}

// --- Automated Backup System ---
function performDatabaseBackup() {
  try {
    const isProd = __dirname.includes('AssetManager_Prod');
    const backupBaseDir = 'c:/Users/Admin/AssetManager/backups';
    const subDir = isProd ? '8080_prod' : '9090_dev';
    const targetDir = path.join(backupBaseDir, subDir);
    
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data', isProd ? 'prod' : 'test', 'database_v2.db');
    
    // Check if source DB exists
    if (!fs.existsSync(dbPath)) {
      console.error(`[BACKUP] Source database not found at: ${dbPath}`);
      return;
    }

    const now = new Date();
    const ts = now.getFullYear() + 
               String(now.getMonth() + 1).padStart(2, '0') + 
               String(now.getDate()).padStart(2, '0') + '_' + 
               String(now.getHours()).padStart(2, '0') + 
               String(now.getMinutes()).padStart(2, '0');
    
    const backupPath = path.join(targetDir, `database_v2_${ts}.db`);
    
    fs.copyFileSync(dbPath, backupPath);
    console.log(`[BACKUP] Success! Saved to: ${backupPath}`);
    
    // Cleanup: Keep only last 30 backups
    const files = fs.readdirSync(targetDir)
      .filter(f => f.startsWith('database_v2_') && f.endsWith('.db'))
      .map(f => ({ name: f, time: fs.statSync(path.join(targetDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 30) {
      files.slice(30).forEach(f => {
        fs.unlinkSync(path.join(targetDir, f.name));
        console.log(`[BACKUP] Cleaned up old backup: ${f.name}`);
      });
    }
  } catch (err) {
    console.error('[BACKUP] Failed:', err);
  }
}

// 1. Run on Restart
performDatabaseBackup();

// 2. Schedule every 12 hours (at 00:00 and 12:00)
cron.schedule('0 0,12 * * *', () => {
  console.log('[CRON] Starting scheduled 12-hour backup...');
  performDatabaseBackup();
});

// --- Automated Cleanup System (Permanent Deletion after 30 days) ---
async function performPermanentDeletionCleanup() {
  try {
    const tablesToCleanup = ['assets', 'projects', 'asset_kinds', 'temporary_assets'];
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const dateStr = thirtyDaysAgo.toISOString();

    console.log(`[CLEANUP] Starting permanent deletion cleanup for items deleted before ${dateStr}...`);

    for (const tableName of tablesToCleanup) {
      // Check if table exists before trying to delete from it (Database agnostic way)
      const tableExists = await db.schema.hasTable(tableName);
      if (tableExists) {
        const result = await db(tableName)
          .where('is_deleted', 1)
          .andWhere('deleted_at', '<', dateStr)
          .delete();
        
        if (result > 0) {
          console.log(`[CLEANUP] Permanently deleted ${result} items from ${tableName}`);
        }
      }
    }
  } catch (err) {
    console.error('[CLEANUP] Permanent deletion failed:', err);
  }
}

// Run cleanup on restart and every 24 hours
performPermanentDeletionCleanup();
cron.schedule('0 2 * * *', () => { // Every day at 2 AM
  performPermanentDeletionCleanup();
});

// --- Asset History System ---
// --- Asset History System ---
async function initializeHistory() {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    const hasTable = await db.schema.hasTable('asset_history');
    
    if (hasTable && isPostgres) {
      // Check if columns are lowercase or PascalCase
      const columns = await db('asset_history').columnInfo();
      if (columns['AssetID']) {
        console.log('[MIGRATION] asset_history has PascalCase columns. Dropping for recreation...');
        await db.schema.dropTable('asset_history');
        return initializeHistory(); // Re-run to create new table
      }
    }

    if (!hasTable) {
      await db.schema.createTable('asset_history', table => {
        table.increments('id').primary();
        if (isPostgres) {
          table.string('assetid').notNullable();
          table.string('action').notNullable();
          table.text('oldvalue');
          table.text('newvalue');
          table.string('user');
          table.timestamp('timestamp').defaultTo(db.fn.now());
          table.text('details');
        } else {
          table.string('AssetID').notNullable();
          table.string('Action').notNullable();
          table.text('FromValue');
          table.text('ToValue');
          table.string('User');
          table.timestamp('Timestamp').defaultTo(db.fn.now());
          table.text('Details');
        }
      });
      console.log('Created asset_history table');
    }

    // Ensure temporary_assets has soft delete columns
    const hasTempTable = await db.schema.hasTable('temporary_assets');
    if (hasTempTable) {
      const tempColumns = await db('temporary_assets').columnInfo();
      if (!tempColumns['is_deleted']) {
        await db.schema.table('temporary_assets', table => {
          table.integer('is_deleted').defaultTo(0);
          table.string('deleted_at');
        });
        console.log('Added soft delete columns to temporary_assets');
      }
    }
  } catch (err) {
    console.error('Migration error (initialization):', err);
  }
}
initializeHistory();

// Unified logAssetHistory
async function logAssetHistory(assetId, action, oldValue, newValue, user, details = '') {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    const timestamp = new Date().toISOString();
    
    if (isPostgres) {
      await db('asset_history').insert(normalizeDBData({
        AssetID: assetId,
        Action: action,
        OldValue: oldValue,
        NewValue: newValue,
        User: user || 'web',
        Timestamp: timestamp,
        Details: details
      }));
    } else {
      legacyDb.prepare(`
        INSERT INTO asset_history (AssetID, Action, FromValue, ToValue, User, Timestamp, Details)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assetId, action, oldValue, newValue, user || 'web', timestamp, details);
    }
  } catch (err) {
    console.error('[HISTORY] Failed to log:', err);
  }
}

// Unified logAudit
async function logAudit(user, action, details, assetId = 'N/A', severity = 'INFO') {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        const timestamp = new Date().toISOString();
        
        if (isPostgres) {
            await db('audit_log').insert(normalizeDBData({
                User: user || 'web',
                Action: action,
                Details: details,
                AssetId: assetId,
                Severity: severity,
                Timestamp: timestamp
            }));
        } else {
            legacyDb.prepare(`
                INSERT INTO audit_log (User, Action, Details, AssetId, Severity, Timestamp)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(user || 'web', action, details, assetId, severity, timestamp);
        }
    } catch (err) {
        console.error('[AUDIT] Failed to log audit:', err.message);
    }
}

// QA Test Route
app.get('/api/test-ping', (req, res) => res.json({ pong: true, time: new Date().toISOString() }));

// Debug Endpoint
app.get('/api/debug/diagnose/:id', (req, res) => {
  const id = req.params.id;
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'database_v2.db');
  const dbExists = fs.existsSync(dbPath);
  
  let asset = null;
  let recent = [];
  let error = null;

  try {
    const Database = require('better-sqlite3');
    const debugDb = new Database(dbPath);
    asset = debuglegacyDb.prepare('SELECT * FROM assets WHERE ID = ?').get(id);
    recent = debuglegacyDb.prepare('SELECT ID, ItemName, LastUpdated FROM assets ORDER BY LastUpdated DESC LIMIT 5').all();
  } catch (err) {
    error = err.message;
  }

  res.json({
    requested_id: id,
    db_path: dbPath,
    db_exists: dbExists,
    found: !!asset,
    asset_data: asset,
    recent_assets: recent,
    error: error,
    env_port: process.env.PORT || 'default(8080)',
    cwd: process.cwd()
  });
});

// Increase payload limit for OCR uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// DEBUG: Log all requests
app.use((req, res, next) => {
    // console.log(`[Request] ${req.method} ${req.url}`);
    // console.log(`[Cookies]`, req.headers.cookie);
    next();
});

// DEBUG Endpoint
app.get('/api/debug/cookies', (req, res) => {
    res.json({
        cookies: req.headers.cookie || '',
        parsed: parseCookies(req.headers.cookie || ''),
        ip: req.ip
    });
});

// --- Asset History Endpoint ---
app.get('/api/assets/:id/history', (req, res) => {
  try {
    const { id } = req.params;
    const history = legacyDb.prepare('SELECT * FROM asset_history WHERE AssetID = ? ORDER BY Timestamp DESC').all(id);
    res.json({ success: true, history });
  } catch (err) {
    console.error('[HISTORY] Fetch error:', err);
    res.status(500).json({ error: err.message });
  }
});

function parseCookies(header) {
  const list = {};
  if (!header) return list;
  header.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    const key = parts.shift();
    const value = parts.join('=');
    if (!key) return;
    list[key.trim()] = decodeURIComponent((value || '').trim());
  });
  return list;
}

// ... (existing helper functions) ...

// --- DB Migrations for Auth ---
try {
    legacyDb.exec(`
        CREATE TABLE IF NOT EXISTS auth_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_auth_tokens_hash ON auth_tokens(token_hash);

        CREATE TABLE IF NOT EXISTS password_resets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            token_hash TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);
    `);
    console.log('Auth tables checked/created');
} catch (err) {
    console.error('Auth migration error:', err);
}

// --- Auth Endpoints ---

app.post('/api/auth/login', async (req, res) => {
  const { username, password, category, rememberMe } = req.body || {};
  console.log(`[AUTH] Login attempt for: ${username} (${category})`);

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = await getUserFromDb(username);
    if (!user) {
      console.log(`[AUTH] User not found: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials', message: 'Invalid credentials' });
    }
    
    const stored = user.password || '';
    let passwordMatch = false;
    
    if (stored && typeof stored === 'string' && (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$'))) {
      passwordMatch = await bcrypt.compare(password, stored);
    } else {
      if (stored === password) {
        passwordMatch = true;
        console.log(`[AUTH] Plaintext match for ${username}. Upgrading to bcrypt.`);
        const newHash = await bcrypt.hash(password, 12);
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        if (isPostgres) {
          await db('users').where('username', user.username).update({ password: newHash });
        } else {
          legacyDb.prepare('UPDATE users SET password = ? WHERE username = ?').run(newHash, user.username);
        }
      }
    }

    if (!passwordMatch) {
      console.log(`[AUTH] Password mismatch for: ${username}`);
      return res.status(401).json({ error: 'Invalid credentials', message: 'Invalid credentials' });
    }

    // Generate JWT
    const { token, claims } = signJwtForUser(user, category);

    // Set JWT Cookie
    res.cookie(JWT_COOKIE_NAME, token, {
      httpOnly: true,
      secure: false, 
      sameSite: 'lax',
      maxAge: JWT_EXPIRES_IN_SECONDS * 1000
    });

    // Handle Remember Me
    if (rememberMe) {
        const rememberToken = tokenService.generateToken();
        await tokenService.storeRememberToken(user.username, rememberToken, 30);      

        res.cookie(REMEMBER_COOKIE_NAME, rememberToken, {
            httpOnly: true,
            secure: false, 
            sameSite: 'lax',
            maxAge: 30 * 24 * 60 * 60 * 1000 // 30 days
        });
    }

    console.log(`[AUTH] Login successful for: ${username}`);
    const permissions = Array.from(rolePermissionCache[user.role] || []);

    res.json({
      ok: true,
      user: {
        id: claims.user_id,
        username: user.username,
        fullname: user.fullname,
        role: claims.role,
        projectId: user.project_id,
        clientId: user.client_id,
        department: user.department,
        permissions: permissions,
        category
      }
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  // Invalidate Remember Token if present
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies[REMEMBER_COOKIE_NAME]) {
      await tokenService.invalidateRememberToken(cookies[REMEMBER_COOKIE_NAME]);
  }

  // Clear Cookies
  res.cookie(JWT_COOKIE_NAME, '', {
    httpOnly: true,
    secure: false, // Set to false to work over plain HTTP (like on .118)
    sameSite: 'lax',
    maxAge: 0
  });
  
  res.cookie(REMEMBER_COOKIE_NAME, '', {
    httpOnly: true,
    secure: false, // Set to false to work over plain HTTP (like on .118)
    sameSite: 'lax',
    maxAge: 0
  });

  res.json({ ok: true, message: 'Logged out' });
});

app.get('/api/auth/me', async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie || '');
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        // 1. Try standard JWT check first
        let token = null;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
            token = authHeader.slice(7).trim();
        } else {
            token = cookies[JWT_COOKIE_NAME];
        }

        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                let user;
                if (isPostgres) {
                    user = await db('users').where('username', decoded.user_id).orWhere('username', decoded.user_id).first();
                    user = normalizeResult(user);
                } else {
                    user = legacyDb.prepare('SELECT * FROM users WHERE username = ? OR id = ?').get(decoded.user_id, decoded.user_id);
                }

                if (user) {
                    return res.json({
                        ok: true,
                        user: {
                            id: decoded.user_id,
                            username: user.username,
                            fullname: user.fullname,
                            role: decoded.role,
                            projectId: user.project_id,
                            clientId: user.client_id,
                            category: decoded.company_id
                        }
                    });
                }
            } catch (e) {}
        }

        // 2. Try Remember Me
        const rememberToken = cookies[REMEMBER_COOKIE_NAME];
        if (rememberToken) {
            const userId = await tokenService.verifyRememberToken(rememberToken);
            if (userId) {
                let user;
                if (isPostgres) {
                    user = await db('users').where('username', userId).first();
                    user = normalizeResult(user);
                } else {
                    user = legacyDb.prepare('SELECT * FROM users WHERE username = ? OR id = ?').get(userId, userId);
                }

                if (user) {
                    const category = 'IT';
                    const { token: newToken, claims } = signJwtForUser(user, category);
                    
                    res.cookie(JWT_COOKIE_NAME, newToken, {
                        httpOnly: true,
                        secure: false, 
                        sameSite: 'lax',
                        maxAge: JWT_EXPIRES_IN_SECONDS * 1000
                    });

                    return res.json({
                        ok: true,
                        user: {
                            id: claims.user_id,
                            username: user.username,
                            fullname: user.fullname,
                            role: claims.role,
                            projectId: user.project_id,
                            clientId: user.client_id,
                            category: category
                        }
                    });
                }
            }
        }

        return res.status(401).json({ error: 'Not authenticated' });
    } catch (err) {
        console.error('Session check error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let user;
        if (isPostgres) {
            user = await db('users').where('username', email).orWhere('fullname', email).first();
            if (!user) user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).orWhereRaw('LOWER(fullname) = LOWER(?)', [email]).first();
            user = normalizeResult(user);
        } else {
            user = legacyDb.prepare('SELECT * FROM users WHERE username = ? OR fullname = ?').get(email, email);
        }
        if (!user) return res.json({ ok: true, message: 'If an account exists, a reset email has been sent.' });
        const resetToken = tokenService.generateToken();
        tokenService.storeResetToken(user.username, resetToken);
        const host = req.get('host'); 
        const protocol = req.protocol;
        const resetLink = `${protocol}://${host}/#reset-password?token=${resetToken}`;
        await emailService.sendPasswordResetEmail(user.fullname || email, resetLink);
        res.json({ ok: true, message: 'If an account exists, a reset email has been sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ ok: false, message: 'Internal server error' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        const username = tokenService.verifyResetToken(token);
        if (!username) return res.status(400).json({ error: 'Invalid or expired reset token' });
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        if (isPostgres) {
            await db('users').where('username', username).update({ password: passwordHash });
        } else {
            legacyDb.prepare('UPDATE users SET password = ? WHERE username = ?').run(passwordHash, username);
        }
        tokenService.invalidateAllUserTokens(username);
        tokenService.consumeResetToken(token);
        res.json({ ok: true, message: 'Password reset successful' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

function buildUserClaims(user, category) {
  const companyId = user.company_id || user.client_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
  return {
    user_id: String(user.username || user.id),
    role: user.role || 'employee',
    company_id: String(companyId),
    category: category || null,
    department: user.department || null
  };
}

function signJwtForUser(user, category) {
  const claims = buildUserClaims(user, category);
  const payload = {
    user_id: claims.user_id,
    role: claims.role,
    company_id: claims.company_id,
    department: claims.department
  };
  const token = jwt.sign(payload, JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: JWT_EXPIRES_IN_SECONDS
  });
  return { token, claims };
}

function authenticateJWT(req, res, next) {
  try {
    let token = null;
    const authHeader = req.headers.authorization || req.headers.Authorization;
    if (authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }
    if (!token) {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies[JWT_COOKIE_NAME]) {
        token = cookies[JWT_COOKIE_NAME];
      }
    }
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.user_id || !decoded.role || !decoded.company_id) {
      return res.status(401).json({ error: 'Invalid token payload' });
    }
    req.user = {
      user_id: String(decoded.user_id),
      role: String(decoded.role),
      company_id: String(decoded.company_id),
      department: decoded.department || null
    };
    return next();
  } catch (err) {
    if (err && err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function authorizeRoles() {
  const allowedRoles = Array.from(arguments);
  return function (req, res, next) {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    // superuser bypasses all role checks
    if (req.user.role === 'superuser') {
      return next();
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

let rolePermissionCache = {};

async function loadRolePermissionsIntoCache() {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    const rows = isPostgres 
      ? await db('role_permissions').select('role_name', 'permission_key')
      : legacyDb.prepare('SELECT role_name, permission_key FROM role_permissions').all();
      
    const map = {};
    rows.forEach(row => {
      const roleName = row.role_name; 
      const permKey = row.permission_key;
      
      if (!map[roleName]) {
        map[roleName] = new Set();
      }
      map[roleName].add(permKey);
    });
    rolePermissionCache = map;
    console.log(`[AUTH] Loaded ${rows.length} permissions for ${Object.keys(map).length} roles into cache.`);
  } catch (err) {
    console.error('Error loading role permissions into cache:', err);
    rolePermissionCache = {};
  }
}

function hasPermission(roleName, permissionKey) {
  // superuser always has all permissions
  if (roleName === 'superuser') return true;
  const set = rolePermissionCache[roleName];
  return !!(set && set.has(permissionKey));
}

function requirePermission(permissionKey) {
  return function (req, res, next) {
    if (!req.user || !req.user.role) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!hasPermission(req.user.role, permissionKey)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

// --- Database Migrations ---
const isPostgres = process.env.DB_CLIENT === 'postgresql';

if (!isPostgres) {
  try {
    // Check if projects table has QRCode column
    const tableInfo = legacyDb.prepare("PRAGMA table_info(projects)").all();
    const hasQRCode = tableInfo.some(col => col.name === 'QRCode');
    if (!hasQRCode) {
      legacyDb.prepare("ALTER TABLE projects ADD COLUMN QRCode TEXT").run();
      console.log('Added QRCode column to projects table');
    }

    // Ensure other new columns exist
    const existingColumns = new Set(tableInfo.map(c => c.name));
    const newColumns = [
      'OwnerEmail', 'CoordinatorEmail',
      'ConsigneeName', 'ConsigneeAddress', 'ConsigneeGSTIN', 'ConsigneeState', 'ConsigneeStateCode',
      'BuyerName', 'BuyerAddress', 'BuyerGSTIN', 'BuyerState', 'BuyerStateCode'
    ];

    newColumns.forEach(col => {
      if (!existingColumns.has(col)) {
        legacyDb.prepare(`ALTER TABLE projects ADD COLUMN ${col} TEXT`).run();
        console.log(`Added ${col} column to projects table`);
      }
    });
  } catch (err) {
    console.error('Migration error (projects columns):', err);
  }
}

if (!isPostgres) {
  try {
    const historyTable = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_history'").get();
    if (!historyTable) {
      legacyDb.prepare(`
        CREATE TABLE IF NOT EXISTS project_history (
          ID INTEGER PRIMARY KEY AUTOINCREMENT,
          ProjectID TEXT,
          Status TEXT,
          Note TEXT,
          Timestamp TEXT
        )
      `).run();
      console.log('Created project_history table');
    }
  } catch (err) {
    console.error('Migration error (project_history):', err);
  }
}

// --- Purchase Order (PO) Migrations ---
if (!isPostgres) {
  try {
    // 1. project_orders table
    const ordersTable = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_orders'").get();
    if (!ordersTable) {
      legacyDb.prepare(`
        CREATE TABLE project_orders (
          ID TEXT PRIMARY KEY,
          ProjectID TEXT NOT NULL,
          PONumber TEXT,
          PODate TEXT,
          VendorName TEXT,
          TotalAmount REAL DEFAULT 0,
          Status TEXT DEFAULT 'Active',
          ConsigneeName TEXT,
          ConsigneeAddress TEXT,
          ConsigneeGSTIN TEXT,
          ConsigneeState TEXT,
          ConsigneeStateCode TEXT,
          BuyerName TEXT,
          BuyerAddress TEXT,
          BuyerGSTIN TEXT,
          BuyerState TEXT,
          BuyerStateCode TEXT,
          Timestamp TEXT,
          FOREIGN KEY (ProjectID) REFERENCES projects(ID)
        )
      `).run();
      console.log('Created project_orders table');
    } else {
      // Ensure all columns exist for project_orders
      const cols = legacyDb.prepare("PRAGMA table_info(project_orders)").all();
      const existing = new Set(cols.map(c => c.name));
      const needed = [
        'PONumber', 'PODate', 'VendorName', 'TotalAmount', 'Status',
        'OrderNo', 'OrderDate', 'ConsigneeName', 'ConsigneeAddress', 'ConsigneeGSTIN', 
        'ConsigneeState', 'ConsigneeStateCode', 'BuyerName', 'BuyerAddress', 
        'BuyerGSTIN', 'BuyerState', 'BuyerStateCode'
      ];
      needed.forEach(col => {
        if (!existing.has(col)) {
          const type = (col === 'TotalAmount') ? 'REAL DEFAULT 0' : 'TEXT';
          legacyDb.prepare(`ALTER TABLE project_orders ADD COLUMN ${col} ${type}`).run();
          console.log(`Added ${col} to project_orders`);
        }
      });
    }

    // 2. project_order_items table
    const itemsTable = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_order_items'").get();
    if (!itemsTable) {
      legacyDb.prepare(`
        CREATE TABLE project_order_items (
          ID INTEGER PRIMARY KEY AUTOINCREMENT,
          OrderID TEXT NOT NULL,
          SrNo INTEGER,
          ItemDescription TEXT,
          DueDate TEXT,
          QtyOrdered REAL,
          UOM TEXT,
          UnitPrice REAL,
          Total REAL,
          AssetID TEXT, -- Optional link to a specific asset if tracked
          Timestamp TEXT,
          Status TEXT DEFAULT 'Pending',
          FOREIGN KEY (OrderID) REFERENCES project_orders(ID)
        )
      `).run();
      console.log('Created project_order_items table');
    } else {
      // Ensure Status column exists for project_order_items
      const cols = legacyDb.prepare("PRAGMA table_info(project_order_items)").all();
      const existing = new Set(cols.map(c => c.name));
      if (!existing.has('Status')) {
        legacyDb.prepare("ALTER TABLE project_order_items ADD COLUMN Status TEXT DEFAULT 'Pending'").run();
        console.log('Added Status column to project_order_items');
      }
    }
  } catch (err) {
    console.error('Migration error (PO tables):', err);
  }
}

if (!isPostgres) {
  try {
    const dcTable = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_challans'").get();
    if (!dcTable) {
      legacyDb.prepare(`
        CREATE TABLE IF NOT EXISTS delivery_challans (
          ID TEXT PRIMARY KEY,
          ChallanNo TEXT,
          CustomerName TEXT,
          DeliveryDate TEXT,
          AssetIds TEXT,
          Status TEXT,
          QRCode TEXT,
          CreatedBy TEXT,
          Timestamp TEXT,
          PayloadJSON TEXT
        )
      `).run();
    } else {
      const cols = legacyDb.prepare("PRAGMA table_info(delivery_challans)").all();
      const hasPayload = cols.some(c => c.name === 'PayloadJSON');
      if (!hasPayload) {
        legacyDb.prepare("ALTER TABLE delivery_challans ADD COLUMN PayloadJSON TEXT").run();
        console.log('Added PayloadJSON column to delivery_challans table');
      }
    }
  } catch (err) {
    console.error('Migration error (delivery_challans PayloadJSON):', err);
  }
}

// Migration for DC Item Mappings (White Labeling)
if (!isPostgres) {
  try {
    const mappingTable = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dc_item_mappings'").get();
    if (!mappingTable) {
      legacyDb.prepare(`
        CREATE TABLE dc_item_mappings (
          ID INTEGER PRIMARY KEY AUTOINCREMENT,
          DC_ID TEXT NOT NULL,
          AssetID TEXT NOT NULL,
          CustomName TEXT,
          CustomDescription TEXT,
          Timestamp TEXT,
          FOREIGN KEY (DC_ID) REFERENCES delivery_challans(ID),
          UNIQUE(DC_ID, AssetID)
        )
      `).run();
      console.log('Created dc_item_mappings table');
    }
  } catch (err) {
    console.error('Migration error (dc_item_mappings):', err);
  }
}

if (!isPostgres) {
  try {
    const cols = legacyDb.prepare("PRAGMA table_info(assets)").all();
    const hasCol = (name) => cols.some((c) => c.name === name);

    if (!hasCol('BoughtAgainstPO')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN BoughtAgainstPO TEXT').run();
    if (!hasCol('SentAgainstDC')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN SentAgainstDC TEXT').run();
    
    if (!hasCol('quantity_parent_id')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_parent_id TEXT').run();
    if (!hasCol('quantity_root_id')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_root_id TEXT').run();
    if (!hasCol('quantity_unit')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_unit TEXT').run();
    if (!hasCol('quantity_total')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_total REAL').run();
    if (!hasCol('quantity_available')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_available REAL').run();
    if (!hasCol('quantity_precision')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_precision INTEGER').run();
    if (!hasCol('quantity_updated_at')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN quantity_updated_at TEXT').run();
    if (!hasCol('conversion_unit')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN conversion_unit TEXT').run();
    if (!hasCol('conversion_factor')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN conversion_factor REAL').run();
    if (!hasCol('conversion_mode')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN conversion_mode TEXT').run();
    if (!hasCol('is_quantity_tracked')) {
      legacyDb.prepare('ALTER TABLE assets ADD COLUMN is_quantity_tracked INTEGER DEFAULT 0').run();
      // Proactively enable it for assets that already have quantity data
      legacyDb.prepare("UPDATE assets SET is_quantity_tracked = 1 WHERE quantity_unit IS NOT NULL OR quantity_total > 0").run();
    }
    if (!hasCol('is_batch')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN is_batch INTEGER DEFAULT 0').run();
    if (!hasCol('linked_po_item_id')) legacyDb.prepare('ALTER TABLE assets ADD COLUMN linked_po_item_id INTEGER').run();
    if (!hasCol('Department')) {
      legacyDb.prepare('ALTER TABLE assets ADD COLUMN Department TEXT').run();
      console.log('Added Department column to assets table');
    }
  } catch (err) {
    console.error('Migration error (assets quantity columns):', err);
  }
}

if (!isPostgres) {
  try {
    const cols = legacyDb.prepare("PRAGMA table_info(asset_kinds)").all();
    const hasIdentifier = cols.some(c => c.name === 'Identifier');
    if (!hasIdentifier) {
      legacyDb.prepare("ALTER TABLE asset_kinds ADD COLUMN Identifier TEXT").run();
      console.log('Added Identifier column to asset_kinds table');
    }
  } catch (err) {
    console.error('Migration error (asset_kinds Identifier):', err);
  }
}

if (!isPostgres) {
  try {
    legacyDb.exec(`
      CREATE TABLE IF NOT EXISTS quantity_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        root_id TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT,
        timestamp TEXT NOT NULL,
        note TEXT,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS quantity_event_lines (
        event_id INTEGER NOT NULL,
        asset_id TEXT NOT NULL,
        unit TEXT,
        delta_available REAL NOT NULL DEFAULT 0,
        delta_total REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (event_id, asset_id),
        FOREIGN KEY (event_id) REFERENCES quantity_events(id)
      );

      CREATE INDEX IF NOT EXISTS idx_quantity_events_root ON quantity_events(root_id);
      CREATE INDEX IF NOT EXISTS idx_quantity_event_lines_asset ON quantity_event_lines(asset_id);
      CREATE INDEX IF NOT EXISTS idx_assets_quantity_root ON assets(quantity_root_id);
      CREATE INDEX IF NOT EXISTS idx_assets_quantity_parent ON assets(quantity_parent_id);
    `);
  } catch (err) {
    console.error('Migration error (quantity events tables):', err);
  }
}

if (!isPostgres) {
  try {
    const cols = legacyDb.prepare("PRAGMA table_info(users)").all();
    const hasCompanyId = cols.some(c => c.name === 'company_id');
    const hasEmployeeId = cols.some(c => c.name === 'employee_id');
    const hasClientId = cols.some(c => c.name === 'client_id');
    if (!hasCompanyId) {
      legacyDb.prepare("ALTER TABLE users ADD COLUMN company_id TEXT").run();
      console.log('Added company_id column to users table');
    }
    if (!hasEmployeeId) {
      legacyDb.prepare("ALTER TABLE users ADD COLUMN employee_id TEXT").run();
      console.log('Added employee_id column to users table');
    }
    if (!hasClientId) {
      legacyDb.prepare("ALTER TABLE users ADD COLUMN client_id TEXT").run();
      console.log('Added client_id column to users table');
    }
    const hasUserDepartment = cols.some(c => c.name === 'department');
    if (!hasUserDepartment) {
      legacyDb.prepare("ALTER TABLE users ADD COLUMN department TEXT").run();
      console.log('Added department column to users table');
    }
    legacyDb.prepare("CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
    let company = legacyDb.prepare("SELECT id FROM companies WHERE name = ?").get(DEFAULT_COMPANY_NAME);
    if (!company) {
      const newId = (crypto.randomUUID && crypto.randomUUID()) || [
        crypto.randomBytes(4).toString('hex'),
        crypto.randomBytes(2).toString('hex'),
        crypto.randomBytes(2).toString('hex'),
        crypto.randomBytes(2).toString('hex'),
        crypto.randomBytes(6).toString('hex')
      ].join('-');
      legacyDb.prepare("INSERT INTO companies (id, name) VALUES (?, ?)").run(newId, DEFAULT_COMPANY_NAME);
      company = { id: newId };
      console.log('Created default company record for', DEFAULT_COMPANY_NAME);
    }
    DEFAULT_COMPANY_ID = company.id;
    legacyDb.prepare("UPDATE users SET company_id = ? WHERE company_id IS NULL OR company_id = ?").run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME);
    legacyDb.prepare("UPDATE users SET client_id = ? WHERE client_id IS NULL OR client_id = ?").run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME);
  } catch (err) {
    console.error('Migration error (users company_id):', err);
  }
}

// --- Soft Delete Migrations ---
if (!isPostgres) {
  try {
    const tablesToUpdate = ['assets', 'projects', 'asset_kinds', 'temporary_assets'];
    tablesToUpdate.forEach(tableName => {
      // Check if table exists
      const tableExists = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(tableName);
      if (tableExists) {
        const tableInfo = legacyDb.prepare(`PRAGMA table_info(${tableName})`).all();
        const existingColumns = new Set(tableInfo.map(c => c.name));
        
        if (!existingColumns.has('is_deleted')) {
          legacyDb.prepare(`ALTER TABLE ${tableName} ADD COLUMN is_deleted INTEGER DEFAULT 0`).run();
          console.log(`Added is_deleted column to ${tableName} table`);
        }
        if (!existingColumns.has('deleted_at')) {
          legacyDb.prepare(`ALTER TABLE ${tableName} ADD COLUMN deleted_at TEXT`).run();
          console.log(`Added deleted_at column to ${tableName} table`);
        }
      }
    });
  } catch (err) {
    console.error('Migration error (soft delete columns):', err);
  }
}

if (!isPostgres) {
  try {
    legacyDb.prepare(`
      CREATE TABLE IF NOT EXISTS network_credentials (
        id TEXT PRIMARY KEY,
        device_name TEXT NOT NULL,
        ip_address TEXT,
        type TEXT,
        username TEXT,
        password TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `).run();
    console.log('Created network_credentials table');
  } catch (err) {
    console.error('Migration error (network_credentials):', err);
  }
}

if (!isPostgres) {
  try {
    legacyDb.prepare(`
      CREATE TABLE IF NOT EXISTS network_contacts (
        id TEXT PRIMARY KEY,
        service TEXT NOT NULL,
        provider TEXT,
        contact TEXT,
        email TEXT,
        created_by TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `).run();
    console.log('Created network_contacts table');
  } catch (err) {
    console.error('Migration error (network_contacts):', err);
  }
}

if (!isPostgres) {
  try {
    legacyDb.prepare(`
      CREATE TABLE IF NOT EXISTS roles (
        name TEXT PRIMARY KEY,
        description TEXT
      )
    `).run();
    legacyDb.prepare(`
      CREATE TABLE IF NOT EXISTS permissions (
        key TEXT PRIMARY KEY,
        description TEXT
      )
    `).run();
    legacyDb.prepare(`
      CREATE TABLE IF NOT EXISTS role_permissions (
        role_name TEXT NOT NULL,
        permission_key TEXT NOT NULL,
        PRIMARY KEY (role_name, permission_key),
        FOREIGN KEY (role_name) REFERENCES roles(name),
        FOREIGN KEY (permission_key) REFERENCES permissions(key)
      )
    `).run();

    const baseRoles = [
      { name: 'superuser', description: 'System owner with full access' },
      { name: 'admin', description: 'Company administrator with full access to modules' },
      { name: 'manager', description: 'Manager with elevated asset and category access' },
      { name: 'user', description: 'Standard internal user' },
      { name: 'client', description: 'External client user' },
      { name: 'it_user', description: 'IT personnel with network access' },
      { name: 'it_manager', description: 'IT manager with network management access' }
    ];
    const insertRole = legacyDb.prepare("INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)");
    baseRoles.forEach(r => insertRole.run(r.name, r.description));

    const basePermissions = [
      { key: 'module.assets.access', description: 'Access asset views and operations' },
      { key: 'module.admin.access', description: 'Access admin area' },
      { key: 'module.settings.access', description: 'Access settings area' },
      { key: 'module.employees.access', description: 'Access employees area' },
      { key: 'module.network_scanner.access', description: 'Access network scanner' },
      { key: 'module.network.access', description: 'Access network tools and credentials' },
      { key: 'asset.view', description: 'View assets' },
      { key: 'asset.create', description: 'Create assets' },
      { key: 'asset.edit', description: 'Edit assets' },
      { key: 'asset.delete', description: 'Delete assets' },
      { key: 'asset.search', description: 'Search assets' },
      { key: 'category.create', description: 'Create categories' },
      { key: 'category.delete', description: 'Delete categories' },
      { key: 'user.manage', description: 'Manage users' },
      { key: 'logs.view', description: 'View change logs' },
      { key: 'asset.view_price', description: 'View asset value/price' },
      { key: 'asset.edit_price', description: 'Edit asset value/price' }
    ];
    const insertPerm = legacyDb.prepare("INSERT OR IGNORE INTO permissions (key, description) VALUES (?, ?)");
    basePermissions.forEach(p => insertPerm.run(p.key, p.description));

    const rolePermissionPairs = [
      ['superuser', 'module.assets.access'],
      ['superuser', 'module.admin.access'],
      ['superuser', 'module.settings.access'],
      ['superuser', 'module.employees.access'],
      ['superuser', 'module.network_scanner.access'],
      ['superuser', 'module.network.access'],
      ['superuser', 'asset.view'],
      ['superuser', 'asset.create'],
      ['superuser', 'asset.edit'],
      ['superuser', 'asset.delete'],
      ['superuser', 'asset.search'],
      ['superuser', 'category.create'],
      ['superuser', 'category.delete'],
      ['superuser', 'user.manage'],
      ['superuser', 'logs.view'],
      ['superuser', 'asset.view_price'],
      ['superuser', 'asset.edit_price'],

      ['admin', 'module.assets.access'],
      ['admin', 'module.admin.access'],
      ['admin', 'module.settings.access'],
      ['admin', 'module.employees.access'],
      ['admin', 'module.network_scanner.access'],
      ['admin', 'module.network.access'],
      ['admin', 'asset.view'],
      ['admin', 'asset.create'],
      ['admin', 'asset.edit'],
      ['admin', 'asset.delete'],
      ['admin', 'asset.search'],
      ['admin', 'category.create'],
      ['admin', 'user.manage'],
      ['admin', 'logs.view'],
      ['admin', 'asset.view_price'],
      ['admin', 'asset.edit_price'],

      ['manager', 'module.assets.access'],
      ['manager', 'asset.view'],
      ['manager', 'asset.create'],
      ['manager', 'asset.edit'],
      ['manager', 'asset.search'],
      ['manager', 'category.create'],
      ['manager', 'asset.view_price'],
      ['manager', 'asset.edit_price'],

      ['user', 'module.assets.access'],
      ['user', 'asset.view'],
      ['user', 'asset.create'],
      ['user', 'asset.edit'],
      ['user', 'asset.search'],

      ['client', 'module.assets.access'],
      ['client', 'asset.view'],
      ['client', 'asset.search'],

      ['it_user', 'module.assets.access'],
      ['it_user', 'module.network_scanner.access'],
      ['it_user', 'module.network.access'],
      ['it_user', 'asset.view'],
      ['it_user', 'asset.search'],

      ['it_manager', 'module.assets.access'],
      ['it_manager', 'module.network_scanner.access'],
      ['it_manager', 'module.network.access'],
      ['it_manager', 'asset.view'],
      ['it_manager', 'asset.create'],
      ['it_manager', 'asset.edit'],
      ['it_manager', 'asset.search'],
      ['it_manager', 'user.manage']
    ];
    const insertRolePerm = legacyDb.prepare("INSERT OR IGNORE INTO role_permissions (role_name, permission_key) VALUES (?, ?)");
    rolePermissionPairs.forEach(([roleName, permKey]) => insertRolePerm.run(roleName, permKey));

    loadRolePermissionsIntoCache().then(() => {
      console.log('Permissions cache initialized');
    });
  } catch (err) {
    console.error('Migration error (RBAC tables):', err);
  }
}
// ---------------------------

// App and middleware initialized at top of file
// const app = express()
// app.use(express.json({ limit: '100mb' }))
// app.use(express.urlencoded({ limit: '100mb', extended: true }))

function parseQtyNumber(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

function normalizeQtyUnit(unit) {
  const u = String(unit || '').trim()
  return u.length ? u : null
}

function getRequestActor(req) {
  return req.headers['x-user'] || 'web'
}

async function getUserFromDb(username) {
  if (!username) return null
  const isPostgres = process.env.DB_CLIENT === 'postgresql';
  if (isPostgres) {
    const user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();
    return normalizeResult(user);
  }
  return legacyDb.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

// Helper to require admin role
async function requireAdmin(req) {
  // Try to use req.user from JWT first
  if (req.user && (req.user.role === 'admin' || req.user.role === 'superuser' || req.user.role === 'it_manager')) {
    return req.user;
  }
  // Fallback to DB lookup via x-user header for backward compatibility
  const username = String(req.headers['x-user'] || '')
  if (!username) return null;
  const user = await getUserFromDb(username)
  if (!user || (user.role !== 'admin' && user.role !== 'superuser' && user.role !== 'it_manager')) return null
  return user
}

// Helper to require superuser role
async function requireSuperuser(req) {
  // Try to use req.user from JWT first
  if (req.user && req.user.role === 'superuser') {
    return req.user;
  }
  // Fallback to DB lookup via x-user header
  const username = String(req.headers['x-user'] || '')
  if (!username) return null;
  const user = await getUserFromDb(username)
  if (!user || user.role !== 'superuser') return null
  return user
}

// User Management Endpoints
app.get('/api/users', authenticateJWT, async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let users;
        if (isPostgres) {
            users = await db('users').select('id', 'username', 'fullname', 'role', 'company_id', 'client_id', 'project_id', 'department', 'designation');
            users = normalizeResult(users);
        } else {
            users = legacyDb.prepare('SELECT id, username, fullname, role, company_id, client_id, project_id, department, designation FROM users').all();
        }
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

        const { username, password, fullname, role, company_id, client_id, project_id, department, designation } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        // Check if user already exists
        let existing;
        if (isPostgres) {
            existing = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();
        } else {
            existing = legacyDb.prepare('SELECT 1 FROM users WHERE LOWER(username) = LOWER(?)').get(username);
        }
        if (existing) return res.status(400).json({ error: 'Username already exists' });

        const passwordHash = await bcrypt.hash(password, 12);
        const userData = {
            username,
            password: passwordHash,
            fullname: fullname || username,
            role: role || 'user',
            company_id: company_id || admin.company_id || DEFAULT_COMPANY_ID,
            client_id: client_id || null,
            project_id: project_id || null,
            department: department || null,
            designation: designation || null
        };

        if (isPostgres) {
            await db('users').insert(normalizeDBData(userData));
        } else {
            const stmt = legacyDb.prepare(`
                INSERT INTO users (username, password, fullname, role, company_id, client_id, project_id, department, designation)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(userData.username, userData.password, userData.fullname, userData.role, userData.company_id, userData.client_id, userData.project_id, userData.department, userData.designation);
        }

        res.json({ success: true, message: 'User created successfully' });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:username', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });

        const { username } = req.params;
        const { password, fullname, role, company_id, client_id, project_id, department, designation } = req.body;

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        const updateData = {
            fullname,
            role,
            company_id,
            client_id,
            project_id,
            department,
            designation
        };

        // Clean undefined
        Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

        if (password) {
            updateData.password = await bcrypt.hash(password, 12);
        }

        if (isPostgres) {
            await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).update(normalizeDBData(updateData));
        } else {
            // Build dynamic SQLite update
            const fields = Object.keys(updateData);
            if (fields.length > 0) {
                const setClause = fields.map(f => `${f} = ?`).join(', ');
                const params = fields.map(f => updateData[f]);
                params.push(username);
                legacyDb.prepare(`UPDATE users SET ${setClause} WHERE username = ?`).run(...params);
            }
        }

        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:username', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireSuperuser(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Superuser access required' });

        const { username } = req.params;
        if (username === admin.username) return res.status(400).json({ error: 'Cannot delete yourself' });

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        if (isPostgres) {
            await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).delete();
        } else {
            legacyDb.prepare('DELETE FROM users WHERE username = ?').run(username);
        }

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/roles', authenticateJWT, async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let roles;
        if (isPostgres) {
            roles = await db('roles').select('*');
            roles = normalizeResult(roles);
        } else {
            roles = legacyDb.prepare('SELECT * FROM roles').all();
        }
        res.json(roles);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/permissions', authenticateJWT, async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let perms;
        if (isPostgres) {
            perms = await db('permissions').select('*');
            perms = normalizeResult(perms);
        } else {
            perms = legacyDb.prepare('SELECT * FROM permissions').all();
        }
        res.json(perms);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/role-permissions', authenticateJWT, async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('role_permissions').select('*');
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare('SELECT * FROM role_permissions').all();
        }
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/role-permissions', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireSuperuser(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Superuser access required' });

        const { role_name, permission_key } = req.body;
        if (!role_name || !permission_key) return res.status(400).json({ error: 'role_name and permission_key required' });

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        if (isPostgres) {
            await db('role_permissions').insert({ role_name, permission_key }).onConflict(['role_name', 'permission_key']).ignore();
        } else {
            legacyDb.prepare('INSERT OR IGNORE INTO role_permissions (role_name, permission_key) VALUES (?, ?)').run(role_name, permission_key);
        }

        await loadRolePermissionsIntoCache();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/role-permissions', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireSuperuser(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Superuser access required' });

        const { role_name, permission_key } = req.body;
        if (!role_name || !permission_key) return res.status(400).json({ error: 'role_name and permission_key required' });

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        if (isPostgres) {
            await db('role_permissions').where({ role_name, permission_key }).delete();
        } else {
            legacyDb.prepare('DELETE FROM role_permissions WHERE role_name = ? AND permission_key = ?').run(role_name, permission_key);
        }

        await loadRolePermissionsIntoCache();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Helper to get quantity-tracked asset (Async)
async function getQuantityAsset(id) {
  const isPostgres = process.env.DB_CLIENT === 'postgresql';
  const assetIdCol = isPostgres ? 'pa.assetid' : 'pa.AssetID';
  const projectIdCol = isPostgres ? 'pa.projectid' : 'pa.ProjectID';

  const asset = await db('assets as a')
    .leftJoin('project_assets as pa', isPostgres ? 'a.id' : 'a.ID', assetIdCol)
    .select(
      isPostgres ? 'a.id as ID' : 'a.ID',
      isPostgres ? 'a.itemname as ItemName' : 'a.ItemName',
      isPostgres ? 'a.status as Status' : 'a.Status',
      isPostgres ? 'a.currentlocation as CurrentLocation' : 'a.CurrentLocation',
      'a.quantity_parent_id',
      'a.quantity_root_id',
      'a.quantity_unit',
      'a.quantity_total',
      'a.quantity_available',
      'a.quantity_precision',
      'a.conversion_unit',
      'a.conversion_factor',
      isPostgres ? 'pa.projectid as ProjectID' : 'pa.ProjectID'
    )
    .whereRaw(isPostgres ? 'LOWER(a.id) = LOWER(?)' : 'LOWER(a.ID) = LOWER(?)', [id])
    .first();
    
  return normalizeResult(asset);
}

const applyQuantityEvent = async (event, externalTrx = null) => {
  const isPostgres = process.env.DB_CLIENT === 'postgresql';
  const runInTrx = async (trx) => {
    const now = new Date().toISOString()
    const root = await getQuantityAsset(event.rootId);
    
    if (!root || !root.quantity_root_id || String(root.quantity_root_id).toLowerCase() !== String(event.rootId).toLowerCase()) {
      throw new Error(`Invalid quantity root: ${event.rootId}. Expected root: ${root ? root.quantity_root_id : 'none'}`)
    }
    const unit = normalizeQtyUnit(root.quantity_unit)
    if (!unit) throw new Error('Root asset is missing quantity unit')

    const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null
    const note = event.note ? String(event.note) : null
    const actor = event.actor ? String(event.actor) : null

    const insertResult = await trx('quantity_events').insert({
      root_id: event.rootId,
      type: event.type,
      actor: actor,
      timestamp: now,
      note: note,
      metadata_json: metadataJson
    }).returning('id');
    
    const eventId = isPostgres ? insertResult[0].id : insertResult[0];

    for (const line of event.lines) {
      const lineUnit = normalizeQtyUnit(line.unit) || unit
      if (lineUnit !== unit) throw new Error('Unit mismatch')

      const deltaAvailable = parseQtyNumber(line.deltaAvailable) ?? 0
      const deltaTotal = parseQtyNumber(line.deltaTotal) ?? 0
      if (!Number.isFinite(deltaAvailable) || !Number.isFinite(deltaTotal)) throw new Error('Invalid quantity delta')

      await trx('quantity_event_lines').insert({
        event_id: eventId,
        asset_id: line.assetId,
        unit: unit,
        delta_available: deltaAvailable,
        delta_total: deltaTotal
      });

      const precision = Number.isFinite(line.precision) ? line.precision : (root.quantity_precision ?? null)
      
      const updateResult = await trx('assets')
        .whereRaw(isPostgres ? 'LOWER(id) = LOWER(?)' : 'LOWER(ID) = LOWER(?)', [line.assetId])
        .andWhereRaw(isPostgres ? 'LOWER(quantity_root_id) = LOWER(?)' : 'LOWER(quantity_root_id) = LOWER(?)', [event.rootId])
        .update({
          quantity_unit: db.raw('COALESCE(quantity_unit, ?)', [unit]),
          quantity_available: db.raw('COALESCE(quantity_available, 0) + ?', [deltaAvailable]),
          quantity_total: db.raw('COALESCE(quantity_total, 0) + ?', [deltaTotal]),
          quantity_updated_at: now,
          quantity_precision: db.raw('COALESCE(quantity_precision, ?)', [precision])
        });

      if (updateResult !== 1) {
        throw new Error(`Quantity update failed: Asset ${line.assetId} not found or mismatch.`)
      }
    }

    return { eventId: Number(eventId), timestamp: now, unit }
  };

  if (externalTrx) {
    return await runInTrx(externalTrx);
  } else {
    return await db.transaction(async (trx) => {
      return await runInTrx(trx);
    });
  }
};

// API Key for external integrations (Zoho, Odoo, etc.)
// In a production environment, this should be moved to an environment variable or database.
const EXTERNAL_API_KEY = process.env.EXTERNAL_API_KEY || 'AM-EXTERNAL-API-KEY-2026';

// Middleware to check for API Key in external routes
const checkApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  if (apiKey && apiKey === EXTERNAL_API_KEY) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized: Invalid or missing API Key' });
};

// API to get recent activity log
app.get('/api/recent-activity', async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('audit_log')
                .select('action as Action', 'user as User', 'assetid as AssetId', 'details as Details', 'timestamp as Timestamp')
                .orderBy('timestamp', 'desc')
                .limit(10);
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare(`
                SELECT Action, User, AssetId, Details, Timestamp 
                FROM audit_log 
                ORDER BY Timestamp DESC 
                LIMIT 10
            `).all();
        }
        res.json(rows);
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity log' });
    }
});

// API to get all audit logs
app.get('/api/audit-logs', async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('audit_log')
                .orderBy('timestamp', 'desc')
                .limit(1000);
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare(`
                SELECT * FROM audit_log 
                ORDER BY Timestamp DESC
                LIMIT 1000
            `).all();
        }
        res.json(rows);
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// API to export audit logs as JSON
app.get('/api/audit-logs/export/json', async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('audit_log').orderBy('timestamp', 'desc');
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC').all();
        }
        
        const filename = 'audit_logs_' + Date.now() + '.json';
        fs.writeFileSync(path.join(exportDir, filename), JSON.stringify(rows, null, 2));

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.json"');
        res.send(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error('Error exporting audit logs JSON:', err);
        res.status(500).json({ error: 'Failed to export logs' });
    }
});

// API to export audit logs as Excel
app.get('/api/audit-logs/export/excel', async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('audit_log').orderBy('timestamp', 'desc');
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC').all();
        }

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        const filename = 'audit_logs_' + Date.now() + '.xlsx';
        fs.writeFileSync(path.join(exportDir, filename), buffer);

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.xlsx"');
        res.send(buffer);
    } catch (err) {
        console.error('Error exporting audit logs Excel:', err);
        res.status(500).json({ error: 'Failed to export logs' });
    }
});

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,x-user,x-api-key,authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// --- Email Notification System ---

/**
 * Sends a warranty expiration notification email
 */
async function sendWarrantyEmail(asset, daysLeft, settings, recipientEmail = null) {
    const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
    const parseRecipients = (value) => {
        if (!value) return [];
        if (Array.isArray(value)) return value.flatMap(v => parseRecipients(v));
        return String(value)
            .split(/[;,]/g)
            .map(s => s.trim())
            .filter(Boolean);
    };

    const recipients = Array.from(new Set(parseRecipients(recipientEmail || settings.notification_email).map(normalizeEmail)))
        .filter(e => e.includes('@') && e.includes('.'));

    console.log(`Attempting to send warranty email for asset ${asset.ID} to ${recipients.join(', ')}`);
    
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass || recipients.length === 0) {
        const missing = [];
        if (!settings.smtp_host) missing.push('SMTP Host');
        if (!settings.smtp_user) missing.push('SMTP User');
        if (!settings.smtp_pass) missing.push('SMTP Pass');
        if (recipients.length === 0) missing.push('Recipient Email');
        console.warn(`Email settings incomplete. Missing: ${missing.join(', ')}`);
        return false;
    }

    const transporter = nodemailer.createTransport({
        host: settings.smtp_host,
        port: settings.smtp_port || 587,
        secure: settings.smtp_port == 465,
        auth: {
            user: settings.smtp_user,
            pass: settings.smtp_pass
        }
    });

    const status = daysLeft < 0 ? 'EXPIRED' : 'EXPIRING SOON';
    const subject = `[WARRANTY ALERT] Asset ${asset.ID} - ${asset.ItemName} is ${status}`;
    
    // Determine Project Context
    let projectContext = '';
    if (asset.ProjectID) {
         const project = legacyDb.prepare('SELECT ProjectName, ClientName FROM projects WHERE ID = ?').get(asset.ProjectID);
         if (project) {
             projectContext = `
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Project:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${project.ProjectName} (${project.ClientName})</td></tr>
             `;
         }
    }

    const html = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: ${daysLeft < 0 ? '#dc3545' : '#ff8c00'};">${status}</h2>
            <p>The warranty for the following asset is ${daysLeft < 0 ? 'already expired' : 'expiring soon'}:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Asset ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.ID}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Item Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.ItemName}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Model:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.Model || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Serial No:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.SrNo || '-'}</td></tr>
                ${projectContext}
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Purchase Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.PurchaseDate || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Warranty:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.warranty_months} months</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Days Remaining:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${Math.round(daysLeft)} days</td></tr>
            </table>
            <p style="margin-top: 30px; font-size: 12px; color: #888;">This is an automated notification from your Asset Management System.</p>
        </div>
    `;

    try {
        const info = await transporter.sendMail({
            from: `"Asset Manager Alerts" <${settings.smtp_user}>`,
            to: recipients,
            subject: subject,
            html: html
        });
        
        const acceptedCount = Array.isArray(info.accepted) ? info.accepted.length : 0;
        const rejectedCount = Array.isArray(info.rejected) ? info.rejected.length : 0;
        const delivered = acceptedCount > 0 || rejectedCount === 0;

        appendAudit({
            Action: 'WARRANTY_ALERT_SENT',
            User: 'SYSTEM',
            AssetId: asset.ID,
            Severity: 'INFO',
            Details: `Sent ${status} email notification to ${recipients.join(', ')}`
        });
        
        console.log(`Notification sent for asset ${asset.ID} to ${recipients.join(', ')}`);
        return delivered;
    } catch (err) {
        console.error(`Failed to send email for asset ${asset.ID} to ${recipients.join(', ')}:`, err);
        return false;
    }
}

/**
 * Main warranty check task
 */
async function checkWarrantyStatuses() {
    console.log('Running daily warranty status check...');
    const dynamic = readDynamic();
    const settings = dynamic.email_settings || {};
    
    if (!settings.enabled) {
        console.log('Warranty notifications are disabled.');
        return;
    }

    try {
        let employeeEmailStmt = null;
        try {
            employeeEmailStmt = legacyDb.prepare(`
                SELECT Email FROM employees
                WHERE Email IS NOT NULL AND trim(Email) != ''
                  AND (
                    ID = ? COLLATE NOCASE OR
                    EmployeeID = ? COLLATE NOCASE OR
                    Name = ? COLLATE NOCASE OR
                    Email = ? COLLATE NOCASE
                  )
            `);
        } catch (e) {
            employeeEmailStmt = null;
        }

        let assetUserIdStmt = null;
        try {
            assetUserIdStmt = legacyDb.prepare('SELECT UserID FROM asset_it_details WHERE AssetID = ?');
        } catch (e) {
            assetUserIdStmt = null;
        }

        const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
        const parseEmails = (value) => {
            if (!value) return [];
            if (Array.isArray(value)) return value.flatMap(v => parseEmails(v));
            return String(value)
                .split(/[;,]/g)
                .map(s => s.trim())
                .filter(Boolean);
        };

        const sendToAdmin = settings.send_to_admin !== false;
        const sendToProjectEmails = settings.send_to_project_emails !== false;
        const sendToEmployeeEmails = settings.send_to_employee_emails !== false;

        // Fetch assets joined with project assignments
        const assets = legacyDb.prepare(`
            SELECT a.*, pa.ProjectID 
            FROM assets a
            LEFT JOIN project_assets pa ON a.ID = pa.AssetID
            WHERE a.isPlaceholder = 0
        `).all();
        
        const now = new Date();
        const thresholdDays = settings.threshold_days || 30;
        
        // Track notified assets in dynamic.json to avoid duplicate emails
        const notified = dynamic.notified_assets || {};
        let changed = false;

        for (const asset of assets) {
            if (!asset.PurchaseDate || !asset.warranty_months) continue;

            const pMonths = parseInt(asset.warranty_months);
            if (isNaN(pMonths)) continue;

            const pDate = new Date(asset.PurchaseDate);
            if (isNaN(pDate.getTime())) continue;

            const expiryDate = new Date(pDate);
            expiryDate.setMonth(pDate.getMonth() + pMonths);
            
            const diffTime = expiryDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            // Notify if expired or expiring within threshold
            if (diffDays <= thresholdDays) {
                const notifiedKey = `${asset.ID}_${expiryDate.getTime()}`;
                
                if (!notified[notifiedKey]) {
                    console.log(`Warranty Alert: Asset ${asset.ID} expires in ${diffDays} days.`);

                    const recipientEmails = [];

                    if (sendToAdmin && settings.notification_email) {
                        recipientEmails.push(settings.notification_email);
                    }

                    if (sendToProjectEmails && asset.ProjectID) {
                        const project = legacyDb.prepare('SELECT OwnerEmail, CoordinatorEmail FROM projects WHERE ID = ?').get(asset.ProjectID);
                        if (project) {
                            if (project.OwnerEmail && project.OwnerEmail.trim() !== '') recipientEmails.push(project.OwnerEmail);
                            if (project.CoordinatorEmail && project.CoordinatorEmail.trim() !== '') recipientEmails.push(project.CoordinatorEmail);
                        }
                    }

                    if (sendToEmployeeEmails && employeeEmailStmt) {
                        const tokens = [];
                        if (asset.AssignedTo && String(asset.AssignedTo).trim() !== '') tokens.push(...parseEmails(asset.AssignedTo));

                        if (assetUserIdStmt) {
                            const it = assetUserIdStmt.get(asset.ID);
                            if (it && it.UserID && String(it.UserID).trim() !== '') tokens.push(...parseEmails(it.UserID));
                        }

                        for (const token of tokens) {
                            const t = String(token).trim();
                            if (!t) continue;

                            if (t.includes('@') && t.includes('.')) {
                                recipientEmails.push(t);
                                continue;
                            }

                            const rows = employeeEmailStmt.all(t, t, t, t);
                            for (const row of rows) {
                                if (row && row.Email) recipientEmails.push(row.Email);
                            }
                        }
                    }

                    const dedupedRecipients = Array.from(new Set(recipientEmails.map(normalizeEmail)))
                        .filter(e => e.includes('@') && e.includes('.'));

                    let emailSent = false;
                    if (dedupedRecipients.length > 0) {
                        emailSent = await sendWarrantyEmail(asset, diffDays, settings, dedupedRecipients);
                    }

                    if (emailSent) {
                        notified[notifiedKey] = new Date().toISOString();
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            dynamic.notified_assets = notified;
            writeDynamic(dynamic);
        }
    } catch (err) {
        console.error('Error checking warranty statuses:', err);
    }
}

// Run daily at 9:00 AM
cron.schedule('0 9 * * *', checkWarrantyStatuses);

// API Endpoints for Email Settings
app.get('/api/settings/email', (req, res) => {
    const dynamic = readDynamic();
    const defaults = {
        enabled: false,
        smtp_host: '',
        smtp_port: 587,
        smtp_user: '',
        smtp_pass: '',
        notification_email: '',
        threshold_days: 30,
        send_to_admin: true,
        send_to_project_emails: true,
        send_to_employee_emails: true
    };
    const settings = { ...defaults, ...(dynamic.email_settings || {}) };
    // Hide password for security
    const safeSettings = { ...settings };
    if (safeSettings.smtp_pass) safeSettings.smtp_pass = '********';
    res.json(safeSettings);
});

app.post('/api/settings/email', (req, res) => {
    const dynamic = readDynamic();
    const newSettings = req.body;
    
    // If password is '********', keep the old password
    if (newSettings.smtp_pass === '********' && dynamic.email_settings) {
        newSettings.smtp_pass = dynamic.email_settings.smtp_pass;
    }
    
    dynamic.email_settings = { ...(dynamic.email_settings || {}), ...(newSettings || {}) };
    writeDynamic(dynamic);
    
    res.json({ success: true, message: 'Email settings saved successfully' });
});

// Test Email Endpoint
app.post('/api/settings/email/test', async (req, res) => {
    const settings = req.body;
    const dynamic = readDynamic();
    
    if (settings.smtp_pass === '********' && dynamic.email_settings) {
        settings.smtp_pass = dynamic.email_settings.smtp_pass;
    }

    const testAsset = {
        ID: 'TEST-ASSET',
        ItemName: 'Test Notification System',
        Model: 'N/A',
        SrNo: 'N/A',
        PurchaseDate: new Date().toISOString().split('T')[0],
        warranty_months: 12
    };

    try {
        const success = await sendWarrantyEmail(testAsset, 365, settings);
        if (success) {
            res.json({ success: true, message: 'Test email sent successfully' });
        } else {
            // Check if it was a config issue or a connection issue
            const missing = [];
            if (!settings.smtp_host) missing.push('SMTP Host');
            if (!settings.smtp_user) missing.push('SMTP User');
            if (!settings.smtp_pass) missing.push('SMTP Password');
            if (!settings.notification_email) missing.push('Notification Email');
            
            let errorMsg = 'Failed to send email.';
            if (missing.length > 0) {
                errorMsg = `Configuration incomplete. Missing: ${missing.join(', ')}`;
            } else {
                errorMsg = 'SMTP Connection failed. Please check your host, port, and credentials. If using Gmail, ensure you use an App Password.';
            }
            res.status(400).json({ success: false, error: errorMsg });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Run Warranty Check Now Endpoint
app.post('/api/settings/email/run-check', async (req, res) => {
    try {
        await checkWarrantyStatuses();
        res.json({ success: true, message: 'Warranty status check completed' });
    } catch (err) {
        console.error('Manual warranty check failed:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Environment-based static file serving
const currentPort = process.env.PORT || 8080;
const distPath = path.join(__dirname, '../asset-manager-frontend/dist');
const indexHtmlPath = path.join(distPath, 'index.html');
const useDist = (currentPort == 8080 && fs.existsSync(indexHtmlPath));

if (useDist) {
    // Port 8080: Serve from DIST (Minified/Obfuscated/Hidden)
    console.log('[ENV] Serving minified assets from DIST folder on port 8080');
    app.use('/js', express.static(path.join(__dirname, '../asset-manager-frontend/dist/js')));
    app.use('/static', express.static(path.join(__dirname, '../asset-manager-frontend/dist/static')));
    app.use(express.static(path.join(__dirname, '../asset-manager-frontend/dist')));
} else {
    // Port 9090 or Dist missing: Serve from source (Easier debugging)
    console.log(`[ENV] Serving source assets from JS/STATIC folders on port ${currentPort}${currentPort == 8080 ? ' (DIST missing)' : ''}`);
    app.use('/js', express.static(path.join(__dirname, '../asset-manager-frontend/js')));
    app.use('/static', express.static(path.join(__dirname, '../asset-manager-frontend/static')));
    app.use(express.static(path.join(__dirname, '../asset-manager-frontend')));
}

app.use('/uploads', express.static(uploadsDir));
app.use('/input', express.static(uploadsDir));
app.use('/icons', express.static(path.join(__dirname, '../asset-manager-frontend/dist/assets/icons')));

const iconsDir = path.join(__dirname, '../asset-manager-frontend/dist/assets/icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

app.get('/api/icons', (req, res) => {
  if (!fs.existsSync(iconsDir)) {
    return res.json([]);
  }
  const files = fs.readdirSync(iconsDir).filter(f => f.endsWith('.png') || f.endsWith('.jpg') || f.endsWith('.svg') || f.endsWith('.webp'));
  res.json(files.map(f => `/icons/${f}`));
});

app.post('/api/icons/upload', upload.single('icon'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  
  const tempPath = req.file.path;
  const targetPath = path.join(iconsDir, req.file.originalname);
  
  fs.rename(tempPath, targetPath, err => {
    if (err) {
      console.error('Failed to move icon:', err);
      return res.status(500).send('Error saving icon');
    }
    res.json({ success: true, path: `/icons/${req.file.originalname}` });
  });
});

app.post('/api/asset_kinds/upload-image', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded');
  }
  res.json({ success: true, url: `/uploads/${req.file.filename}` });
});

app.get('/', (req, res) => {
  const rootPath = useDist ? '../asset-manager-frontend/dist' : '../asset-manager-frontend';
  res.sendFile(path.join(__dirname, rootPath, 'index.html'));
});

// Serve Asset Details View
app.get('/asset/:id', (req, res) => {
    const rootPath = useDist ? '../asset-manager-frontend/dist' : '../asset-manager-frontend';
    const filePath = path.join(__dirname, rootPath, 'asset-view.html');
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).send('Asset View file not found on server.');
    }
});


// Helper to check asset assignment status
async function getAssetAssignmentStatus(assetId) {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    // 1. Check user assignment
    let asset;
    if (isPostgres) {
        asset = await db('assets').where('id', assetId).select('assignedto').first();
    } else {
        asset = legacyDb.prepare('SELECT AssignedTo FROM assets WHERE ID = ?').get(assetId);
    }
    
    const assignedTo = asset ? (asset.assignedto || asset.AssignedTo) : null;
    if (assignedTo && assignedTo.trim() !== '') {
        return { type: 'user', assignedTo };
    }

    // 2. Check project assignment
    let projectLink;
    if (isPostgres) {
        projectLink = await db('project_assets as pa')
            .join('projects as p', 'pa.projectid', 'p.id')
            .where('pa.assetid', assetId)
            .select('pa.projectid as ProjectID', 'p.projectname as ProjectName', 'p.status as Status')
            .first();
    } else {
        projectLink = legacyDb.prepare(`
            SELECT pa.ProjectID, p.ProjectName, p.Status
            FROM project_assets pa
            JOIN projects p ON pa.ProjectID = p.ID
            WHERE pa.AssetID = ?
        `).get(assetId);
    }

    if (projectLink) {
        return { 
            type: 'project', 
            projectId: projectLink.ProjectID, 
            projectName: projectLink.ProjectName,
            status: projectLink.Status 
        };
    }

    return null;
}

// --- Public Asset View API ---
// This endpoint is for client-facing barcode scans. 
// It redacts sensitive internal information.
app.get('/api/public/assets/:label', async (req, res) => {
    try {
        const { label } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        const asset = await db('assets as a')
            .leftJoin('project_assets as pa', isPostgres ? 'a.id' : 'a.ID', isPostgres ? 'pa.assetid' : 'pa.AssetID')
            .leftJoin('projects as p', isPostgres ? 'pa.projectid' : 'pa.ProjectID', isPostgres ? 'p.id' : 'p.ID')
            .whereRaw('LOWER(a.client_label) = LOWER(?)', [label])
            .select(
                'a.*',
                isPostgres ? 'p.projectname as project_name' : 'p.ProjectName as project_name'
            )
            .first();

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        // Redact internal data
        const publicAsset = {
            ID: asset.id || asset.ID,
            ClientLabel: asset.client_label,
            ItemName: asset.itemname || asset.ItemName,
            ItemDescription: asset.itemdescription || asset.ItemDescription,
            Make: asset.make || asset.Make,
            Model: asset.model || asset.Model,
            SerialNo: asset.serialno || asset.SerialNo || asset.srno || asset.SrNo,
            Type: asset.type || asset.Type,
            Category: asset.category || asset.Category,
            AssignedProject: asset.project_name || 'N/A',
            CurrentLocation: asset.currentlocation || asset.CurrentLocation,
            WarrantyMonths: asset.warranty_months || asset.Warranty_Months,
            Department: asset.department || asset.Department,
            // Include specifications but exclude pricing/vendors
            Specifications: asset.remarks || asset.Remarks
        };

        res.json(publicAsset);
    } catch (err) {
        console.error('Public asset fetch error:', err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/assets', authenticateJWT, async (req, res) => {
  try {
    const { projectId, all } = req.query;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    const hasViewPrice = hasPermission(req.user.role, 'asset.view_price');
    const userDept = req.user.department;

    // 1. Try Cache First
    const cacheKey = `assets:list:${hasViewPrice}:${projectId || 'all'}`;
    const cachedData = await cache.get(cacheKey);
    if (cachedData) {
        console.log(`[CACHE] Serving assets from cache for key: ${cacheKey}`);
        return res.json(cachedData);
    }

    // Helper for processing assets (decrypting and redacting)
    const processAssets = async (assets) => {
      console.log(`[DB] Processing ${assets.length} assets. Using DB: ${process.env.DB_NAME || 'default'}`);
      try {
        const components = await db('components').select('id');
        const componentIds = new Set(components.map(c => c.id));
        
        return assets.map(a => {
          const isTrueComponent = componentIds.has(a.id);
          const hasParent = a.parentid !== null && a.parentid !== undefined && a.parentid !== '';
          
          // Comprehensive mapping from lowercase Postgres columns to CamelCase/PascalCase frontend keys
          const decrypted = {
            ...a,
            ID: a.id,
            ItemName: a.itemname,
            Category: a.category,
            Status: a.status || 'In Store',
            Make: a.make,
            Model: a.model,
            Type: a.type,
            ParentId: a.parentid,
            LastUpdated: a.lastupdated,
            SrNo: a.srno,
            SerialNo: a.serialno,
            CurrentLocation: a.currentlocation,
            AssignedTo: a.assignedto,
            ProjectID: a.projectid,
            // isComponent should ONLY be true for items in the components table
            // Items with a parentid but NOT in the components table are "Split Assets" or "Sub-Assets"
            // which should be counted as real assets in the dashboard.
            isComponent: isTrueComponent,
            isSplitChild: hasParent && !isTrueComponent,
            isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
          };
          
          // Decrypt sensitive fields
          try {
              if (a.serialno) decrypted.SerialNo = encryptionService.universalDecrypt(a.serialno);
              if (a.srno) decrypted.SrNo = encryptionService.universalDecrypt(a.srno);
              if (a.macaddress) decrypted.MACAddress = encryptionService.universalDecrypt(a.macaddress);
              if (a.ipaddress) decrypted.IPAddress = encryptionService.universalDecrypt(a.ipaddress);
              if (a.socketid) decrypted.SocketID = encryptionService.universalDecrypt(a.socketid);
          } catch (e) {
              // Only log if it looks like it should have been encrypted but failed
              if (a.serialno && a.serialno.includes(':')) {
                console.warn(`[ENCRYPT] Failed to decrypt asset ${a.id}:`, e.message);
              }
          }
          
          // Redact Price if unauthorized
          if (!hasViewPrice) {
            delete decrypted.asset_value;
            delete decrypted.unitprice;
            delete decrypted.currency;
            delete decrypted.UnitPrice;
            delete decrypted.Currency;
          } else {
            decrypted.UnitPrice = a.unitprice;
            decrypted.Currency = a.currency;
          }
          return decrypted;
        });
      } catch (err) {
        console.error('[DB] Error in processAssets:', err.message);
        return assets.map(a => {
            const hasParent = a.parentid !== null && a.parentid !== '';
            return {
                ...a,
                ID: a.id,
                ItemName: a.itemname,
                Category: a.category,
                Status: a.status || 'In Store',
                ParentId: a.parentid,
                isComponent: false, // In fallback, we don't know for sure, so don't exclude
                isSplitChild: hasParent,
                isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
            };
        });
      }
    };

    // If 'all' is requested, return all assets (flat array) for global cache
    if (all === 'true') {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        let assets;
        if (isPostgres) {
            let query = db('assets as a')
              .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
              .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
              .leftJoin('projects as p', 'pa.projectid', 'p.id')
              .where(function() {
                this.where('a.is_deleted', 0).orWhereNull('a.is_deleted');
              });
            
            if (projectId) {
                query.where('pa.projectid', projectId);
            }

            // Apply Department Segregation for non-admins
            if (!isAdmin && userDept) {
                query.where(function() {
                  this.where('a.department', userDept).orWhereNull('a.department').orWhere('a.department', '');
                });
            }

            assets = await query
              .select(
                'a.*',
                'it.macaddress', 
                'it.ipaddress', 
                'it.networktype', 
                'it.physicalport', 
                'it.vlan', 
                'it.socketid', 
                'it.userid', 
                'p.projectname as AssignedProjectName', 
                'p.id as AssignedProjectID'
              )
              .orderBy('a.lastupdated', 'desc');
            
            const processed = await processAssets(assets);
            return res.json(processed);
        } else {
            // Legacy SQLite fallback (should not be reached in Docker)
            assets = legacyDb.prepare('SELECT * FROM assets WHERE is_deleted = 0 OR is_deleted IS NULL').all();
            return res.json(assets);
        }
    }

    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 50;
    
    // Tabulator sends sorters and filters
    let sorters = req.query.sorters || [];
    if (typeof sorters === 'string') sorters = JSON.parse(sorters);
    let filters = req.query.filters || [];
    if (typeof filters === 'string') filters = JSON.parse(filters);

    // Build the dynamic query using Knex
    let query = db('assets as a')
      .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
      .leftJoin(
        db('project_assets')
          .select('assetid')
          .max('projectid as projectid')
          .groupBy('assetid')
          .as('pa_raw'),
        'a.id',
        'pa_raw.assetid'
      )
      .leftJoin('projects as p', 'pa_raw.projectid', 'p.id')
      .where(function() {
        this.where('a.is_deleted', 0).orWhereNull('a.is_deleted');
      });

    // Apply Department Segregation for non-admins
    if (!isAdmin && userDept) {
        query.where(function() {
          this.where('a.department', userDept).orWhereNull('a.department').orWhere('a.department', '');
        });
    }

    // 1. Project Filter
    if (projectId) {
      query.where('pa_raw.projectid', projectId);
    }

    // 1.2 Status Filter
    const statusFilter = req.query.status;
    if (statusFilter) {
        const statuses = statusFilter.split(',').map(s => s.trim());
        query.whereIn('a.status', statuses);
    }

    // 1.5 Global Search
    const search = req.query.search;
    if (search) {
        const terms = search.trim().split(/\s+/);
        terms.forEach(term => {
            const searchParam = `%${term}%`;
            const encryptedTerm = encryptionService.encryptDeterministic(term);
            query.where(function() {
              this.where('a.id', 'like', searchParam)
                  .orWhere('a.itemname', 'like', searchParam)
                  .orWhere('a.make', 'like', searchParam)
                  .orWhere('a.model', 'like', searchParam)
                  .orWhere('a.srno', 'like', searchParam)
                  .orWhere('a.srno', encryptedTerm)
                  .orWhere('it.ipaddress', encryptedTerm)
                  .orWhere('a.currentlocation', 'like', searchParam)
                  .orWhere('a.assignedto', 'like', searchParam)
                  .orWhere('a.type', 'like', searchParam)
                  .orWhere('a.category', 'like', searchParam)
                  .orWhere('a.status', 'like', searchParam);
            });
        });
    }

    // 2. Apply Tabulator Filters
    if (Array.isArray(filters)) {
      filters.forEach(f => {
        const { field, value, type } = f;
        const allowedFields = ['id', 'itemname', 'status', 'type', 'category', 'make', 'model', 'serialno', 'currentlocation', 'assignedto'];
        const lowerField = field.toLowerCase();
        if (allowedFields.includes(lowerField)) {
            if (type === 'like') {
              query.where(`a.${lowerField}`, 'like', `%${value}%`);
            } else if (type === '=') {
              query.where(`a.${lowerField}`, value);
            } else if (type === '!=') {
              query.where(`a.${lowerField}`, '!=', value);
            }
        }
      });
    }

    // 3. Count Total for Pagination
    const countResult = await query.clone().count('* as count').first();
    const totalRecords = countResult ? parseInt(countResult.count) : 0;
    const last_page = Math.ceil(totalRecords / size);

    // 4. Apply Sorters
    if (Array.isArray(sorters) && sorters.length > 0) {
        sorters.forEach(s => {
            const field = s.field.toLowerCase();
            const dir = s.dir.toUpperCase() === 'DESC' ? 'desc' : 'asc';
            if (/^[a-zA-Z0-9_]+$/.test(field)) {
                query.orderBy(`a.${field}`, dir);
            }
        });
    } else {
        query.orderBy('a.lastupdated', 'desc');
    }

    // 5. Fetch Data with Pagination
    const offset = (page - 1) * size;
    const assets = await query
      .select('a.*', 'it.macaddress', 'it.ipaddress', 'it.networktype', 'it.physicalport', 'it.vlan', 'it.socketid', 'it.userid', 'p.projectname as AssignedProjectName', 'p.id as AssignedProjectID')
      .limit(size)
      .offset(offset);

    const processedAssets = await processAssets(assets);

    res.json({
        last_page: last_page,
        data: processedAssets,
        total_records: totalRecords
    });

  } catch (err) {
    console.error('Failed to fetch assets:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/asset-details/:id', async (req, res) => {
  const id = req.params.id;
  
  // Try to authenticate but don't fail if token is missing
  let user = null;
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization;
    let token = null;
    if (authHeader && typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
      token = authHeader.slice(7).trim();
    }
    if (!token) {
      const cookies = parseCookies(req.headers.cookie || '');
      if (cookies[JWT_COOKIE_NAME]) token = cookies[JWT_COOKIE_NAME];
    }
    if (token) {
      user = jwt.verify(token, JWT_SECRET);
    }
  } catch (err) {
    // Ignore invalid tokens for this endpoint to allow guest view
    console.warn(`[API] Guest access for ${id} (Invalid token)`);
  }

  const role = user ? user.role : 'guest';
  const hasViewPrice = hasPermission(role, 'asset.view_price');
  console.log(`[API] Fetching details for ID: ${id} (Role: ${role})`);
  
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let asset;

    if (isPostgres) {
        asset = await db('assets as a')
          .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
          .select('a.*', 'it.macaddress', 'it.ipaddress', 'it.networktype', 'it.physicalport', 'it.vlan', 'it.socketid', 'it.userid')
          .where('a.id', id)
          .first();
          
        if (!asset) {
            asset = await db('components').where('id', id).first();
            if (asset) asset.isComponent = true;
        }
        asset = normalizeResult(asset);
    } else {
        asset = legacyDb.prepare(`
          SELECT a.*, 
                 it.MACAddress, it.IPAddress, it.NetworkType, 
                 it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
          FROM assets a
          LEFT JOIN asset_it_details it ON a.ID = it.AssetID
          WHERE a.ID = ?
        `).get(id);

        if (!asset) {
          asset = legacyDb.prepare('SELECT * FROM components WHERE ID = ?').get(id);
          if (asset) asset.isComponent = true;
        }
    }

    if (!asset) {
      console.warn(`[API] Asset/Component not found: ${id}`);
      return res.status(404).send('Asset not found');
    }

    // Redact Price if unauthorized
    if (!hasViewPrice) {
      delete asset.AssetValue;
      delete asset.UnitPrice;
      delete asset.Currency;
    }

    // Decrypt sensitive fields
    try {
        if (asset.SerialNo) asset.SerialNo = encryptionService.universalDecrypt(asset.SerialNo);
        if (asset.SrNo) asset.SrNo = encryptionService.universalDecrypt(asset.SrNo);
        if (asset.MACAddress) asset.MACAddress = encryptionService.universalDecrypt(asset.MACAddress);
        if (asset.IPAddress) asset.IPAddress = encryptionService.universalDecrypt(asset.IPAddress);
        if (asset.SocketID) asset.SocketID = encryptionService.universalDecrypt(asset.SocketID);
    } catch (e) {
        console.warn(`[ENCRYPT] Failed to decrypt sensitive fields for ${id}:`, e.message);
    }

    let children, auditHistory, structuredHistory, parent;
    
    if (isPostgres) {
        // Fetch True Components (from components table)
        const trueComponents = await db('components').where('parentid', id);
        // Fetch Split Children (from assets table where parentid is this id)
        const splitChildren = await db('assets').where('parentid', id);
        
        children = [
            ...normalizeResult(trueComponents).map(c => ({ ...c, isComponent: true })),
            ...normalizeResult(splitChildren).map(c => ({ ...c, isComponent: false, isSplitChild: true }))
        ];

        auditHistory = await db('audit_log').where('assetid', id).orderBy('timestamp', 'desc');
        structuredHistory = await db('asset_history').where('assetid', id).orderBy('timestamp', 'desc');
        parent = asset.ParentId ? await db('assets').where('id', asset.ParentId).first() : null;
        
        auditHistory = normalizeResult(auditHistory);
        structuredHistory = normalizeResult(structuredHistory);
        parent = normalizeResult(parent);
    } else {
        const trueComponents = legacyDb.prepare('SELECT * FROM components WHERE ParentId = ?').all(id);
        const splitChildren = legacyDb.prepare('SELECT * FROM assets WHERE ParentId = ?').all(id);
        
        children = [
            ...trueComponents.map(c => ({ ...c, isComponent: true })),
            ...splitChildren.map(c => ({ ...c, isComponent: false, isSplitChild: true }))
        ];

        auditHistory = legacyDb.prepare('SELECT * FROM audit_log WHERE AssetId = ? ORDER BY Timestamp DESC').all(id);
        structuredHistory = legacyDb.prepare('SELECT * FROM asset_history WHERE AssetID = ? ORDER BY Timestamp DESC').all(id);
        parent = asset.ParentId ? legacyDb.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.ParentId) : null;
    }

    let quantity = null
    let quantityChildren = []
    let quantityParent = null
    let quantityRoot = null
    let quantityEvents = []
    
    if (asset.quantity_root_id) {
      quantity = {
        rootId: asset.quantity_root_id,
        parentId: asset.quantity_parent_id || null,
        unit: asset.quantity_unit || null,
        total: asset.quantity_total ?? null,
        available: asset.quantity_available ?? null,
        precision: asset.quantity_precision ?? null
      }

      if (isPostgres) {
          quantityChildren = await db('assets').where('quantity_parent_id', id).orderBy('lastupdated', 'desc');
          quantityParent = asset.quantity_parent_id ? await db('assets').where('id', asset.quantity_parent_id).first() : null;
          quantityRoot = asset.quantity_root_id ? await db('assets').where('id', asset.quantity_root_id).first() : null;
          
          quantityEvents = await db('quantity_events')
            .where('root_id', asset.quantity_root_id)
            .orderBy('timestamp', 'desc')
            .limit(50);
            
          quantityChildren = normalizeResult(quantityChildren);
          quantityParent = normalizeResult(quantityParent);
          quantityRoot = normalizeResult(quantityRoot);
          quantityEvents = normalizeResult(quantityEvents);
      } else {
          quantityChildren = legacyDb.prepare('SELECT * FROM assets WHERE quantity_parent_id = ? ORDER BY LastUpdated DESC').all(id)
          quantityParent = asset.quantity_parent_id ? legacyDb.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.quantity_parent_id) : null
          quantityRoot = asset.quantity_root_id ? legacyDb.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.quantity_root_id) : null
          quantityEvents = legacyDb.prepare(`
            SELECT id, root_id, type, actor, timestamp, note, metadata_json
            FROM quantity_events
            WHERE root_id = ?
            ORDER BY timestamp DESC
            LIMIT 50
          `).all(asset.quantity_root_id).map(e => ({
            ...e,
            metadata: e.metadata_json ? JSON.parse(e.metadata_json) : null
          }));
      }
    }

    console.log(`[API] Successfully fetched details for ${id}`);
    const payload = { 
      asset, 
      children: children || [], 
      history: auditHistory || [], 
      structuredHistory: structuredHistory || [],
      parent: parent || null, 
      quantity: quantity || null, 
      quantityChildren: quantityChildren || [], 
      quantityParent: quantityParent || null, 
      quantityRoot: quantityRoot || null, 
      quantityEvents: quantityEvents || [] 
    };
    res.json(payload);
  } catch (err) {
    console.error(`[API] Error fetching asset details for ${id}:`, err);
    res.status(500).json({ error: 'Database error', message: err.message });
  }
});

const QRCode = require('qrcode')

// Tally Settings Endpoints
app.get('/api/settings/tally', (req, res) => {
    try {
        const config = getTallyConfig();
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings/tally', (req, res) => {
    try {
        const { host, port } = req.body;
        if (!host || !port) return res.status(400).json({ error: 'Host and port are required' });
        
        const dynamic = readDynamic();
        dynamic.tally_settings = { host, port: parseInt(port) };
        writeDynamic(dynamic);
        
        res.json({ success: true, message: 'Tally settings saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Tally Sync Endpoint
app.post('/api/tally/sync', async (req, res) => {
  try {
    const { reportName = 'Stock Summary' } = req.body;
    
    // Construct Tally XML Request
    const xmlRequest = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export Data</TALLYREQUEST>
        </HEADER>
        <BODY>
          <EXPORTDATA>
            <REQUESTDESC>
              <REPORTNAME>${reportName}</REPORTNAME>
              <STATICVARIABLES>
                <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
              </STATICVARIABLES>
            </REQUESTDESC>
          </EXPORTDATA>
        </BODY>
      </ENVELOPE>
    `;

    const config = getTallyConfig();
    console.log(`Syncing with Tally server at ${config.host}:${config.port}...`);
    const tallyResponse = await sendTallyRequest(xmlRequest);
    
    // Parse Stock Items (Tally typically uses <STOCKITEM> tags in Stock Summary)
    // Note: Tag names might vary depending on the specific Tally report/version
    const stockItems = parseTallyXml(tallyResponse, 'STOCKITEM');
    
    if (stockItems.length === 0) {
      // Try alternative tags if STOCKITEM not found
      const ledgers = parseTallyXml(tallyResponse, 'LEDGER');
      if (ledgers.length > 0) {
        return res.json({ message: 'Sync successful (Ledgers)', count: ledgers.length, data: ledgers });
      }
      return res.status(404).json({ message: 'No data found in Tally response', raw: tallyResponse.substring(0, 500) });
    }

    // Process and save items to database
    let importedCount = 0;
    const existingIds = new Set(legacyDb.prepare('SELECT ID FROM assets').all().map(a => a.ID));
    
    const insertStmt = legacyDb.prepare(`
      INSERT OR IGNORE INTO assets (
        ID, ItemName, Status, Type, Category, LastUpdated, Remarks
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stockItems.forEach(item => {
      const name = item.NAME || item.NAME_ATTRIBUTE || 'Unknown Tally Item';
      const id = `TALLY_${name.replace(/\s+/g, '_')}`;
      
      if (!existingIds.has(id)) {
        insertStmt.run(
          id,
          name,
          'In Store',
          'Tally Item',
          'Imported',
          new Date().toISOString(),
          `Imported from Tally (${reportName})`
        );
        importedCount++;
      }
    });

    appendAudit({ 
      Action: 'TALLY_SYNC', 
      User: req.headers['x-user'] || 'system', 
      AssetId: 'N/A', 
      Severity: 'INFO', 
      Details: `Synced ${stockItems.length} items from Tally (${importedCount} new)` 
    });

    res.json({ 
      success: true, 
      message: `Sync successful. Imported ${importedCount} new items from ${stockItems.length} total.`,
      items: stockItems.slice(0, 10) // Return first 10 for preview
    });

  } catch (error) {
    console.error('Tally Sync Error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to sync with Tally server', 
      error: error.message,
      tip: 'Ensure Tally is running and its HTTP server is enabled (usually port 9000)'
    });
  }
});

// HSN Endpoints
app.get('/api/hsn', async (req, res) => {
    try {
        const query = req.query.q || '';
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;

        if (isPostgres) {
            let q = db('hsn_codes');
            if (query) {
                const searchParam = `%${query}%`;
                q.where('code', 'ilike', searchParam).orWhere('description', 'ilike', searchParam);
            }
            rows = await q.orderBy('code', 'asc').limit(50);
            rows = normalizeResult(rows);
        } else {
            let sql = 'SELECT * FROM hsn_codes';
            const params = [];
            if (query) {
                sql += ' WHERE code LIKE ? OR description LIKE ?';
                params.push(`%${query}%`, `%${query}%`);
            }
            sql += ' ORDER BY code ASC LIMIT 50';
            rows = legacyDb.prepare(sql).all(...params);
        }
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('HSN Fetch Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delivery Challan Endpoints
app.get('/api/dc', async (req, res) => {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let dcs;
    if (isPostgres) {
        dcs = await db('delivery_challans').orderBy('timestamp', 'desc');
        dcs = normalizeResult(dcs);
    } else {
        dcs = legacyDb.prepare('SELECT * FROM delivery_challans ORDER BY Timestamp DESC').all();
    }
    res.json(dcs);
  } catch (err) {
    console.error('DC Fetch Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/dc/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let row;

    if (isPostgres) {
        row = await db('delivery_challans')
          .where('id', id)
          .orWhere('challanno', id)
          .first();
        row = normalizeResult(row);
    } else {
        row = legacyDb.prepare('SELECT * FROM delivery_challans WHERE ID = ? OR ChallanNo = ?').get(id, id);
    }

    if (!row) return res.status(404).json({ success: false, error: 'DC not found' });

    let payload = null;
    try {
      payload = row.PayloadJSON ? (typeof row.PayloadJSON === 'string' ? JSON.parse(row.PayloadJSON) : row.PayloadJSON) : null;
    } catch {
      payload = null;
    }

    let assetIds = [];
    try {
      assetIds = row.AssetIds ? (typeof row.AssetIds === 'string' ? JSON.parse(row.AssetIds) : row.AssetIds) : [];
    } catch {
      assetIds = [];
    }

    res.json({
      success: true,
      dc: row,
      payload,
      assetIds
    });
  } catch (error) {
    console.error('DC Fetch Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/dc', async (req, res) => {
  try {
    const { CustomerName, DeliveryDate, AssetIds, CreatedBy, POReference, payload } = req.body || {};
    // 1. Prepare Data (Sync)
    const normalizedAssetIds = Array.isArray(AssetIds) ? AssetIds : [];
    const assetsForDc = normalizedAssetIds.map((assetId) => {
      const row = legacyDb.prepare(`
        SELECT ID, ItemName, quantity_root_id, quantity_parent_id, quantity_unit, quantity_total, quantity_available, quantity_precision
        FROM assets
        WHERE ID = ?
      `).get(assetId)
      return row || { ID: assetId }
    });

    // 2. Atomic Transaction: Get Next ID -> Insert Placeholder -> Update Assets & PO
    const createResult = legacyDb.transaction(() => {
        const now = new Date();
        const fullYear = now.getFullYear();
        const shortYear = String(fullYear).slice(-2); // e.g. "25" for 2025
        let nextSeq = 1;

        try {
            const lastDc = legacyDb.prepare(`SELECT ChallanNo FROM delivery_challans WHERE ChallanNo LIKE '${shortYear}/%' ORDER BY Timestamp DESC LIMIT 1`).get();
            if (lastDc && lastDc.ChallanNo) {
                const parts = lastDc.ChallanNo.split('/');
                if (parts.length === 2) {
                    const lastSeq = parseInt(parts[1], 10);
                    if (!isNaN(lastSeq)) {
                        nextSeq = lastSeq + 1;
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching last DC number:', err);
            nextSeq = Math.floor(1000 + Math.random() * 9000); 
        }
        
        const challanNo = `${shortYear}/${String(nextSeq).padStart(4, '0')}`;
        const id = `DC${Date.now()}`;
        
        // Update Assets with PO and DC reference
        if (normalizedAssetIds.length > 0) {
            const updateAsset = legacyDb.prepare(`
                UPDATE assets 
                SET SentAgainstDC = ?, 
                    BoughtAgainstPO = COALESCE(BoughtAgainstPO, ?) 
                WHERE ID = ?
            `);
            
            normalizedAssetIds.forEach(assetId => {
                // Update asset assignment (bought against PO and sent against DC)
                updateAsset.run(challanNo, POReference ? POReference.PONumber : null, assetId);
                
                // Manual Checklist Mode: We only link the AssetID to the PO row for traceability, 
                // but we DO NOT automatically mark it as 'Shipped' to allow for partial shipments across multiple DCs.
                if (POReference) {
                    const itemName = assetsForDc.find(a => a.ID === assetId)?.ItemName || '';
                    
                    // Try to find a matching PO item row for this description
                    const matchingItem = legacyDb.prepare(`
                        SELECT SrNo FROM project_order_items 
                        WHERE OrderID = ? 
                        AND (ItemDescription = ? OR ItemDescription LIKE ?)
                        LIMIT 1
                    `).get(
                        POReference.OrderID, 
                        itemName,
                        '%' + itemName + '%'
                    );

                    if (matchingItem) {
                        legacyDb.prepare(`
                            UPDATE project_order_items 
                            SET AssetID = ?
                            WHERE OrderID = ? AND SrNo = ?
                        `).run(assetId, POReference.OrderID, matchingItem.SrNo);
                        console.log(`[DC] Linked Asset ${assetId} to PO item: ${itemName} (SrNo: ${matchingItem.SrNo}) for PO: ${POReference.PONumber}`);
                    }
                }
            });
        }

        // Initial Payload (without QR)
        const initialPayload = payload && typeof payload === 'object' ? payload : {
          company: {},
          consignee: { name: CustomerName || '' },
          buyer: { name: CustomerName || '' },
          meta: {
            deliveryNoteNo: challanNo,
            dated: DeliveryDate || ''
          },
          items: assetsForDc.map((a) => ({
            assetId: a.ID,
            description: a.ItemName || a.ID,
            hsn: '',
            qty: 1,
            per: 'NO',
            rate: '',
            amount: '',
            quantity: a.quantity_root_id ? {
              rootId: a.quantity_root_id,
              parentId: a.quantity_parent_id || null,
              unit: a.quantity_unit || null,
              available: a.quantity_available ?? null,
              total: a.quantity_total ?? null,
              precision: a.quantity_precision ?? null
            } : null
          }))
        };

        legacyDb.prepare(`
          INSERT INTO delivery_challans (ID, ChallanNo, CustomerName, DeliveryDate, AssetIds, Status, QRCode, CreatedBy, Timestamp, PayloadJSON)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          challanNo,
          CustomerName || '',
          DeliveryDate || '',
          JSON.stringify(normalizedAssetIds),
          'Initializing', 
          '', 
          CreatedBy || 'System',
          new Date().toISOString(),
          JSON.stringify(initialPayload)
        );

        return { id, challanNo, payload: initialPayload };
    })();

        const { id, challanNo, payload: dcPayload } = createResult;

        // 3. Check for Project Association (via Reference No or explicit field)
        // If "Reference No" matches a Project Name, link these assets to that project
        try {
            const refNo = dcPayload.meta?.referenceNo;
            if (refNo) {
                const project = legacyDb.prepare('SELECT ID FROM projects WHERE ProjectName = ?').get(refNo);
                if (project) {
                    console.log(`Linking DC assets to Project: ${project.ID} (${refNo})`);
                    
                    const assignStmt = legacyDb.prepare(`
                        INSERT OR REPLACE INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
                        VALUES (?, ?, ?, ?)
                    `);
                    
                    const updateAssetStmt = legacyDb.prepare(`
                        UPDATE assets SET AssignedTo = ?, CurrentLocation = 'On Site' WHERE ID = ?
                    `);

                    legacyDb.transaction(() => {
                        normalizedAssetIds.forEach(assetId => {
                            // Check if already assigned to a DIFFERENT project
                            const existing = legacyDb.prepare('SELECT ProjectID FROM project_assets WHERE AssetID = ?').get(assetId);
                            if (existing && existing.ProjectID !== project.ID) {
                                console.warn(`Skipping auto-assignment for ${assetId}: Already assigned to ${existing.ProjectID}`);
                                return; 
                            }

                            // 1. Add to project_assets table
                            assignStmt.run(project.ID, assetId, new Date().toISOString(), 'DC');
                            
                            // 2. Update main assets table to reflect assignment
                            updateAssetStmt.run(`Project: ${refNo}`, assetId);

                            // 3. Log to asset history
                            logAssetHistory(assetId, 'PROJECT_CHANGE', 'General Stock', `Project: ${refNo}`, CreatedBy || 'System', `Assigned via Delivery Challan ${challanNo}`);
                        });
                    })();
                }
            }
        } catch (linkErr) {
            console.error('Error linking DC assets to project:', linkErr);
            // Non-blocking error, continue with DC generation
        }

        // 4. Generate QR Code (Async)
        const qrData = JSON.stringify({
      id: id,
      no: challanNo,
      customer: CustomerName,
      date: DeliveryDate,
      assets: normalizedAssetIds,
      quantityLinks: assetsForDc
        .filter((a) => a.quantity_root_id)
        .map((a) => ({ assetId: a.ID, rootId: a.quantity_root_id, parentId: a.quantity_parent_id || null, unit: a.quantity_unit || null })),
      Type: "DC",
      ID: id
    });
    
    const qrCode = await qrcode.toDataURL(qrData);

        // Update Record with QR Code & Final Status
        legacyDb.prepare(`UPDATE delivery_challans SET QRCode = ?, Status = 'Pending' WHERE ID = ?`).run(qrCode, id);

        // 5. SOLID: Update PO Item Status to 'Shipped' ONLY NOW
        if (POReference && POReference.OrderID) {
            normalizedAssetIds.forEach(assetId => {
                const asset = legacyDb.prepare('SELECT linked_po_item_id FROM assets WHERE ID = ?').get(assetId);
                if (asset && asset.linked_po_item_id) {
                    legacyDb.prepare("UPDATE project_order_items SET Status = 'Shipped' WHERE ID = ?").run(asset.linked_po_item_id);
                    console.log(`[DC] Explicitly marked PO Item ${asset.linked_po_item_id} as Shipped via DC ${challanNo}`);
                }
            });
        }

        appendAudit({ 
      Action: 'DC_CREATED', 
      User: CreatedBy || 'System', 
      AssetId: id, 
      Severity: 'INFO', 
      Details: `Created Delivery Challan ${challanNo} for ${CustomerName}` 
    });

    res.json({ success: true, id, challanNo, qrCode, payload: dcPayload });
  } catch (error) {
    console.error('DC Creation Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// --- Logo Upload Endpoint ---
app.post('/api/upload-logo', upload.single('logo'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, error: 'No logo file uploaded' });
    }
    // Correct URL mapping: /input/ filename, since the static middleware maps /input to ../../input
    const logoUrl = `/input/${req.file.filename}`;
    res.json({ success: true, url: logoUrl });
});

// DC Remark Templates Endpoints
app.get('/api/dc-remarks', (req, res) => {
    try {
        const table = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dc_remark_templates'").get();
        if (!table) {
            legacyDb.prepare(`
                CREATE TABLE dc_remark_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT,
                    updated_at TEXT
                )
            `).run();
        }
        const templates = legacyDb.prepare('SELECT * FROM dc_remark_templates ORDER BY title ASC').all();
        res.json({ success: true, templates });
    } catch (err) {
        console.error('Error fetching remark templates:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/dc-remarks', (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }
        const stmt = legacyDb.prepare('INSERT INTO dc_remark_templates (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)');
        const now = new Date().toISOString();
        const info = stmt.run(title, content, now, now);
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Error creating remark template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/dc-remarks/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }
        const stmt = legacyDb.prepare('UPDATE dc_remark_templates SET title = ?, content = ?, updated_at = ? WHERE id = ?');
        const now = new Date().toISOString();
        const info = stmt.run(title, content, now, id);
        if (info.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Template not found' });
        }
    } catch (err) {
        console.error('Error updating remark template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/dc-remarks/:id', (req, res) => {
    try {
        const { id } = req.params;
        const stmt = legacyDb.prepare('DELETE FROM dc_remark_templates WHERE id = ?');
        const info = stmt.run(id);
        if (info.changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Template not found' });
        }
    } catch (err) {
        console.error('Error deleting remark template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Employee API Endpoints
app.get('/api/employees', async (req, res) => {
  try {
    const { page, size, search, all, department } = req.query;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    // 1. Try Cache First for "all" request
    if (all === 'true') {
        const port = process.env.PORT || 8080;
        const cacheKey = `employees:all:${port}`;
        const cached = await cache.get(cacheKey);
        if (cached) {
            console.log(`[CACHE] Serving all employees from cache for port ${port}`);
            return res.json(cached);
        }

        let employees;
        if (isPostgres) {
            employees = await db('employees')
                .select('id as ID', 'employeeid as EmployeeID', 'name as Name', 'department as Department', 'designation as Designation', 'email as Email', 'phone as Phone', 'status as Status', 'lastupdated as LastUpdated')
                .orderBy('name', 'asc');
        } else {
            employees = legacyDb.prepare('SELECT * FROM employees ORDER BY Name ASC').all();
        }
        
        console.log(`[DB] Fetched ${employees.length} employees for port ${port}`);
        await cache.set(cacheKey, employees, 3600); // Cache for 1 hour
        return res.json(employees);
    }

    // Pagination logic
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 20; // Default to 20 for cards view
    const offset = (pageNum - 1) * sizeNum;
    
    if (isPostgres) {
        let query = db('employees');
        
        if (search) {
            const searchParam = `%${search}%`;
            query.where(function() {
                this.where('name', 'ilike', searchParam)
                    .orWhere('employeeid', 'ilike', searchParam)
                    .orWhere('department', 'ilike', searchParam)
                    .orWhere('designation', 'ilike', searchParam);
            });
        }

        if (department && department !== 'all') {
            query.where('department', department);
        }

        const countResult = await query.clone().count('* as count').first();
        const totalRecords = countResult ? parseInt(countResult.count) : 0;
        const lastPage = Math.ceil(totalRecords / sizeNum);

        const employees = await query
            .select('id as ID', 'employeeid as EmployeeID', 'name as Name', 'department as Department', 'designation as Designation', 'email as Email', 'phone as Phone', 'status as Status', 'lastupdated as LastUpdated')
            .orderBy('name', 'asc')
            .limit(sizeNum)
            .offset(offset);

        return res.json({
            data: employees,
            last_page: lastPage,
            total_records: totalRecords,
            page: pageNum,
            size: sizeNum
        });
    } else {
        let baseQuery = 'FROM employees';
        let whereClauses = [];
        let params = [];

        if (search) {
            whereClauses.push('(Name LIKE ? OR EmployeeID LIKE ? OR Department LIKE ? OR Designation LIKE ?)');
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam);
        }

        if (department && department !== 'all') {
            whereClauses.push('Department = ?');
            params.push(department);
        }

        let whereSql = '';
        if (whereClauses.length > 0) {
            whereSql = ' WHERE ' + whereClauses.join(' AND ');
        }

        // Count total
        const countSql = `SELECT COUNT(*) as count ${baseQuery} ${whereSql}`;
        const totalResult = legacyDb.prepare(countSql).get(...params);
        const totalRecords = totalResult ? totalResult.count : 0;
        const lastPage = Math.ceil(totalRecords / sizeNum);

        // Fetch data
        const dataSql = `SELECT * ${baseQuery} ${whereSql} ORDER BY Name ASC LIMIT ? OFFSET ?`;
        params.push(sizeNum, offset);
        
        const employees = legacyDb.prepare(dataSql).all(...params);

        return res.json({
            data: employees,
            last_page: lastPage,
            total_records: totalRecords,
            page: pageNum,
            size: sizeNum
        });
    }

  } catch (err) {
    console.error('Failed to fetch employees:', err);
    res.status(500).send('Database error');
  }
});

// --- Department Quotas ---
legacyDb.prepare(`
    CREATE TABLE IF NOT EXISTS department_quotas (
        Department TEXT,
        Category TEXT,
        Quota INTEGER,
        PRIMARY KEY (Department, Category)
    )
`).run();

app.get('/api/quotas', (req, res) => {
    try {
        const quotas = legacyDb.prepare('SELECT * FROM department_quotas').all();
        res.json(quotas);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/quotas', (req, res) => {
    const { department, category, quota } = req.body;
    try {
        const stmt = legacyDb.prepare('INSERT OR REPLACE INTO department_quotas (Department, Category, Quota) VALUES (?, ?, ?)');
        stmt.run(department, category, quota);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/api/quotas/:dept/:cat', (req, res) => {
    try {
        const stmt = legacyDb.prepare('DELETE FROM department_quotas WHERE Department = ? AND Category = ?');
        stmt.run(req.params.dept, req.params.cat);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Get employee asset history
app.get('/api/employees/:name/history', async (req, res) => {
    const name = req.params.name;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    console.log(`[DEBUG] Fetching history for employee: [${name}]`);
    try {
        let history;
        if (isPostgres) {
            history = await db('audit_log as a')
                .leftJoin('assets as assets', 'a.assetid', 'assets.id')
                .where(function() {
                    this.whereIn('a.action', ['ASSIGN', 'BULK_ASSIGN', 'RETURN']);
                })
                .andWhere(function() {
                    const searchParam = `%${name}%`;
                    const searchParam2 = `% "${name}" %`;
                    this.where('a.details', 'ilike', searchParam)
                        .orWhere('a.details', 'ilike', searchParam2);
                })
                .select('a.assetid as AssetId', 'a.timestamp as Timestamp', 'a.details as Details', 'assets.itemname as ItemName', 'assets.model as Model')
                .orderBy('a.timestamp', 'desc');
        } else {
            const stmt = legacyDb.prepare(`
                SELECT a.AssetId, a.Timestamp, a.Details, assets.ItemName, assets.Model
                FROM audit_log a
                LEFT JOIN assets ON a.AssetId = assets.ID
                WHERE (a.Action = 'ASSIGN' OR a.Action = 'BULK_ASSIGN' OR a.Action = 'RETURN')
                AND (a.Details LIKE ? OR a.Details LIKE ?)
                ORDER BY a.Timestamp DESC
            `);
            history = stmt.all(`%${name}%`, `% "${name}" %`);
        }
        
        console.log(`[DEBUG] Found ${history.length} history records for employee: ${name}`);
        res.json(history);
    } catch (err) {
        console.error('[ERROR] Error fetching employee history:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;
    if (!Name || !EmployeeID) return res.status(400).send('Name and EmployeeID are required');

    const id = `EMP${Date.now()}`;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    if (isPostgres) {
        await db('employees').insert(normalizeDBData({
            ID: id,
            EmployeeID,
            Name,
            Department: Department || '',
            Designation: Designation || '',
            Email: Email || '',
            Phone: Phone || '',
            Status: Status || 'ACTIVE',
            LastUpdated: new Date().toISOString()
        }));
    } else {
        const stmt = legacyDb.prepare(`
          INSERT INTO employees (ID, EmployeeID, Name, Department, Designation, Email, Phone, Status, LastUpdated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, EmployeeID, Name, Department || '', Designation || '', Email || '', Phone || '', Status || 'ACTIVE', new Date().toISOString());
    }
    res.json({ success: true, id });
  } catch (err) {
    console.error('Failed to create employee:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/api/employees/bulk', async (req, res) => {
  try {
    const employees = req.body;
    if (!Array.isArray(employees)) {
      return res.status(400).send('Expected an array of employees');
    }

    const timestamp = new Date().toISOString();
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    if (isPostgres) {
        const empToInsert = employees.map((emp, index) => normalizeDBData({
            ID: `EMP${Date.now()}${index}`,
            EmployeeID: emp.EmployeeID || '',
            Name: emp.Name || '',
            Department: emp.Department || '',
            Designation: emp.Designation || '',
            Email: emp.Email || '',
            Phone: emp.Phone || '',
            Status: emp.Status || 'ACTIVE',
            LastUpdated: timestamp
        }));
        
        // Chunk inserts to avoid large payload issues
        const chunkSize = 50;
        for (let i = 0; i < empToInsert.length; i += chunkSize) {
            await db('employees').insert(empToInsert.slice(i, i + chunkSize));
        }
    } else {
        const insertStmt = legacyDb.prepare(`
          INSERT INTO employees (ID, EmployeeID, Name, Department, Designation, Email, Phone, Status, LastUpdated)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const transaction = legacyDb.transaction((empList) => {
          let count = 0;
          for (const emp of empList) {
            const id = `EMP${Date.now()}${count++}`;
            insertStmt.run(
              id,
              emp.EmployeeID || '',
              emp.Name || '',
              emp.Department || '',
              emp.Designation || '',
              emp.Email || '',
              emp.Phone || '',
              emp.Status || 'ACTIVE',
              timestamp
            );
          }
        });
        transaction(employees);
    }
    res.json({ success: true, count: employees.length });
  } catch (err) {
    console.error('Bulk employee upload error:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    if (isPostgres) {
        const result = await db('employees')
            .where('id', id)
            .update(normalizeDBData({
                EmployeeID,
                Name,
                Department,
                Designation,
                Email,
                Phone,
                Status,
                LastUpdated: new Date().toISOString()
            }));
        if (result === 0) return res.status(404).send('Employee not found');
    } else {
        const stmt = legacyDb.prepare(`
          UPDATE employees SET
            EmployeeID = ?,
            Name = ?,
            Department = ?,
            Designation = ?,
            Email = ?,
            Phone = ?,
            Status = ?,
            LastUpdated = ?
          WHERE ID = ?
        `);
        const result = stmt.run(EmployeeID, Name, Department, Designation, Email, Phone, Status, new Date().toISOString(), id);
        if (result.changes === 0) return res.status(404).send('Employee not found');
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update employee:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    let changes = 0;
    if (isPostgres) {
        changes = await db('employees').where('id', id).del();
    } else {
        const result = legacyDb.prepare('DELETE FROM employees WHERE ID = ?').run(id);
        changes = result.changes;
    }
    if (changes === 0) return res.status(404).send('Employee not found');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete employee:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/asset_kinds', async (req, res) => {
  try {
    const cacheKey = 'asset:kinds';
    const cached = await cache.get(cacheKey);
    if (cached) {
        console.log('[CACHE] Serving asset kinds from cache');
        return res.json(cached);
    }

    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let kinds;
    if (isPostgres) {
        kinds = await db('asset_kinds')
            .where(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            })
            .orderBy('name', 'asc');
        kinds = normalizeResult(kinds);
    } else {
        kinds = legacyDb.prepare('SELECT * FROM asset_kinds WHERE (is_deleted = 0 OR is_deleted IS NULL) ORDER BY Name ASC').all();
    }
    
    await cache.set(cacheKey, kinds, 86400); // Cache for 24 hours
    res.json(kinds);
  } catch (err) {
    console.error('Failed to fetch asset kinds:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/asset_kinds/:name', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date().toISOString();
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    let changes = 0;
    if (isPostgres) {
        changes = await db('asset_kinds').where('name', name).update({ is_deleted: 1, deleted_at: now });
    } else {
        const result = legacyDb.prepare("UPDATE asset_kinds SET is_deleted = 1, deleted_at = ? WHERE Name = ?").run(now, name);
        changes = result.changes;
    }

    if (changes > 0) {
      res.json({ success: true, message: 'Asset Category marked for deletion' });
    } else {
      res.status(404).json({ error: 'Asset Category not found' });
    }
  } catch (err) {
    console.error('Failed to delete asset kind:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/folders', async (req, res) => {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let folders;
    if (isPostgres) {
        folders = await db('folders').orderBy('id', 'asc');
        folders = normalizeResult(folders);
    } else {
        folders = legacyDb.prepare('SELECT * FROM folders ORDER BY "Order" ASC').all();
    }
    res.json(folders);
  } catch (err) {
    console.error('Failed to fetch folders:', err);
    res.status(500).send('Database error');
  }
});

app.post('/api/folders', (req, res) => {
  try {
    const { ID, Name, ParentID, Icon, Module, Order } = req.body;
    if (!Name) return res.status(400).send('Name is required');
    
    const id = ID || `F${Date.now()}`;
    const stmt = legacyDb.prepare(`
      INSERT INTO folders (ID, Name, ParentID, Icon, Module, "Order", LastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ID) DO UPDATE SET
        Name=excluded.Name,
        ParentID=excluded.ParentID,
        Icon=excluded.Icon,
        Module=excluded.Module,
        "Order"=excluded."Order",
        LastUpdated=excluded.LastUpdated
    `);
    
    stmt.run(id, Name, ParentID || null, Icon || '📂', Module || 'IT', Order || 0, new Date().toISOString());
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Failed to save folder:', err);
    res.status(500).send('Database error');
  }
});

app.post('/api/asset_kinds', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager'), (req, res) => {
  try {
    const { Name, Module, Icon, ParentName, DisplayImage, Identifier } = req.body;
    
    if (!Name) return res.status(400).send('Name is required');

    const stmt = legacyDb.prepare(`
      INSERT INTO asset_kinds (Name, Module, Icon, ParentName, LastUpdated, DisplayImage, Identifier)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(Name) DO UPDATE SET
        Module=excluded.Module,
        Icon=excluded.Icon,
        ParentName=excluded.ParentName,
        LastUpdated=excluded.LastUpdated,
        DisplayImage=excluded.DisplayImage,
        Identifier=excluded.Identifier
    `);
    
    stmt.run(Name, Module || '', Icon || '📦', ParentName || null, new Date().toISOString(), DisplayImage || null, Identifier || null);
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save asset kind:', err);
    res.status(500).send('Database error');
  }
});

// Projects API
app.get('/api/projects', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager', 'user', 'it_user', 'it_manager'), async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
        const userDept = req.user.department;
        const userProjectId = req.user.projectId; 
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        let query = db('projects').where(function() {
            this.where('is_deleted', 0).orWhereNull('is_deleted');
        });

        // Apply Department/Project Segregation for non-admins
        if (!isAdmin) {
            if (userProjectId) {
                query.where(isPostgres ? 'id' : 'ID', userProjectId);
            } else if (userDept) {
                query.where(function() {
                    const locCol = isPostgres ? 'location' : 'Location';
                    this.where(locCol, userDept).orWhereNull(locCol).orWhere(locCol, '');
                });
            }
        }

        const projects = await query.orderBy(isPostgres ? 'timestamp' : 'Timestamp', 'desc');
        
        // Normalize for frontend
        const normalized = projects.map(p => ({
            ...p,
            ID: p.id || p.ID,
            ProjectName: p.projectname || p.ProjectName,
            Name: p.projectname || p.ProjectName, // Frontend uses both
            ClientName: p.clientname || p.ClientName,
            Location: p.location || p.Location,
            Status: p.status || p.Status,
            Timestamp: p.timestamp || p.Timestamp
        }));

        res.json(normalized);
    } catch (err) {
        console.error('Failed to fetch projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

app.delete('/api/projects/:id', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date().toISOString();
        const result = await db('projects')
            .where('id', id)
            .update({ is_deleted: 1, deleted_at: now });
            
        if (result > 0) {
            res.json({ success: true, message: 'Project marked for deletion' });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (err) {
        console.error('Failed to delete project:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager'), async (req, res) => {
    try {
        const { 
            ProjectName, ClientName, Description, Status, StartDate, EndDate, 
            OwnerEmail, CoordinatorEmail, ConsigneeName, ConsigneeAddress, 
            ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode, 
            BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode, 
            Location, Currency, Initials 
        } = req.body;
        
        if (!ProjectName || !ClientName) {
            return res.status(400).json({ error: 'Project Name and Client Name are required' });
        }

        // Auto-generate initials if not provided
        let projectInitials = Initials;
        if (!projectInitials) {
            projectInitials = ProjectName.split(/\s+/).map(word => word[0]).join('').toUpperCase().slice(0, 5);
        }

        // Use standardized ID generator if available
        let id;
        if (typeof generateProjectId === 'function') {
            id = generateProjectId(Location || 'MUMBAI');
        } else {
            id = 'PRJ' + Date.now();
        }

        const timestamp = new Date().toISOString();
        const createdBy = req.user ? req.user.fullname || req.user.username || req.user.user_id : 'System';

        // Generate QR Code if possible
        let qrCode = null;
        try {
            if (typeof generateProjectQRPayload === 'function' && typeof qrcode !== 'undefined') {
                const ip = getLocalIP();
                const port = process.env.PORT || 9090;
                const qrPayload = generateProjectQRPayload({
                    ID: id,
                    Name: ProjectName,
                    Client: ClientName,
                    Status: Status || 'Planning',
                    Location: Location || 'MUMBAI',
                    Description: Description || '',
                    StartDate: StartDate || '',
                    EndDate: EndDate || '',
                    OwnerEmail: OwnerEmail || '',
                    CoordinatorEmail: CoordinatorEmail || ''
                }, ip, port);
                qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });
            }
        } catch (qrErr) {
            console.error('QR Generation failed:', qrErr);
        }

        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        console.log(`[API] Creating project. DB_CLIENT: ${process.env.DB_CLIENT}, isPostgres: ${isPostgres}`);
        
        const projectRecord = {
            id: id, 
            projectname: ProjectName, 
            clientname: ClientName, 
            description: Description || null, 
            status: Status || 'Planning', 
            startdate: StartDate || null, 
            enddate: EndDate || null, 
            createdby: createdBy, 
            timestamp: timestamp, 
            owneremail: OwnerEmail || null, 
            coordinatoremail: CoordinatorEmail || null,
            consigneename: ConsigneeName || null, 
            consigneeaddress: ConsigneeAddress || null, 
            consigneegstin: ConsigneeGSTIN || null, 
            consigneestate: ConsigneeState || null, 
            consigneestatecode: ConsigneeStateCode || null,
            buyername: BuyerName || null, 
            buyeraddress: BuyerAddress || null, 
            buyergstin: BuyerGSTIN || null, 
            buyerstate: BuyerState || null, 
            buyerstatecode: BuyerStateCode || null, 
            location: Location || 'MUMBAI', 
            qrcode: qrCode, 
            currency: Currency || 'INR',
            initials: projectInitials
        };

        if (!isPostgres) {
            // Map to PascalCase for SQLite
            const sqliteRecord = {};
            Object.keys(projectRecord).forEach(key => {
                const pascalKey = key === 'id' ? 'ID' : key.charAt(0).toUpperCase() + key.slice(1);
                // Handle special cases
                let finalKey = pascalKey;
                if (key === 'projectname') finalKey = 'ProjectName';
                if (key === 'clientname') finalKey = 'ClientName';
                if (key === 'createdby') finalKey = 'CreatedBy';
                if (key === 'owneremail') finalKey = 'OwnerEmail';
                if (key === 'coordinatoremail') finalKey = 'CoordinatorEmail';
                if (key === 'consigneename') finalKey = 'ConsigneeName';
                if (key === 'consigneeaddress') finalKey = 'ConsigneeAddress';
                if (key === 'consigneegstin') finalKey = 'ConsigneeGSTIN';
                if (key === 'consigneestate') finalKey = 'ConsigneeState';
                if (key === 'consigneestatecode') finalKey = 'ConsigneeStateCode';
                if (key === 'buyername') finalKey = 'BuyerName';
                if (key === 'buyeraddress') finalKey = 'BuyerAddress';
                if (key === 'buyergstin') finalKey = 'BuyerGSTIN';
                if (key === 'buyerstate') finalKey = 'BuyerState';
                if (key === 'buyerstatecode') finalKey = 'BuyerStateCode';
                if (key === 'qrcode') finalKey = 'QRCode';
                
                sqliteRecord[finalKey] = projectRecord[key];
            });
            await db('projects').insert(sqliteRecord);
        } else {
            await db('projects').insert(normalizeDBData(projectRecord));
        }

        // Record project history if table exists
        try {
            const hasHistoryTable = await db.schema.hasTable('project_history');
            if (hasHistoryTable) {
                const historyRecord = {
                    projectid: id, 
                    status: Status || 'Planning', 
                    note: 'Project initialized', 
                    timestamp: timestamp
                };
                await db('project_history').insert(normalizeDBData(historyRecord));
            }
        } catch (histErr) {
            console.warn('Could not record project history:', histErr.message);
        }
        
        res.json({ success: true, id, message: 'Project created successfully' });
    } catch (err) {
        console.error('Failed to create project:', err);
        res.status(500).json({ error: 'Failed to create project: ' + err.message });
    }
});

app.get('/api/tenant/users', authenticateJWT, authorizeRoles('admin', 'manager', 'superuser'), requirePermission('user.manage'), async (req, res) => {
  try {
    const companyId = req.user.company_id;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    let users;
    if (isPostgres) {
        users = await db('users')
            .where('company_id', companyId)
            .select('username', 'fullname', 'role');
    } else {
        users = legacyDb.prepare('SELECT username, fullname, role FROM users WHERE company_id = ?').all(companyId);
    }
    
    return res.json({ ok: true, users });
  } catch (err) {
    console.error('Tenant users error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/tenant/users', authenticateJWT, authorizeRoles('admin', 'superuser'), requirePermission('user.manage'), async (req, res) => {
  try {
    const { username, password, fullname, role, employeeId } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ ok: false, message: 'Username and password are required' });
    }
    const requestedRole = role || 'user';
    if (requestedRole === 'superuser' && req.user.role !== 'superuser') {
      return res.status(403).json({ ok: false, message: 'Only superuser can create superuser accounts' });
    }
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let existing;
    if (isPostgres) {
        existing = await db('users').where('username', username).first();
    } else {
        existing = legacyDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    }

    if (existing) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    
    if (isPostgres) {
        await db('users').insert(normalizeDBData({
            username,
            password: passwordHash,
            fullname: fullname || username,
            role: requestedRole,
            employee_id: employeeId || null,
            company_id: companyId,
            client_id: companyId
        }));
    } else {
        legacyDb.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(username, passwordHash, fullname || username, requestedRole, employeeId || null, companyId, companyId);
    }
    
    appendAudit({
        Action: 'USER_CREATE',
        User: req.user.user_id,
        AssetId: username,
        Severity: 'INFO',
        Details: `Created user ${username} with role ${requestedRole}`
    });

    return res.json({ ok: true, message: 'User created successfully' });
  } catch (err) {
    console.error('Tenant user create error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while creating user' });
  }
});

app.put('/api/tenant/users/:username/role', authenticateJWT, authorizeRoles('admin', 'superuser'), requirePermission('user.manage'), async (req, res) => {
  try {
    const targetUsername = req.params.username;
    const { role } = req.body || {};
    if (!targetUsername || !role) {
      return res.status(400).json({ ok: false, message: 'Username and role are required' });
    }
    const companyId = req.user.company_id;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    if (role === 'superuser' && req.user.role !== 'superuser' && String(targetUsername) !== String(req.user.user_id)) {
      let existingSuper;
      if (isPostgres) {
          existingSuper = await db('users').where({ company_id: companyId, role: 'superuser' }).first();
      } else {
          existingSuper = legacyDb.prepare('SELECT username FROM users WHERE company_id = ? AND role = ? LIMIT 1').get(companyId, 'superuser');
      }

      if (existingSuper) {
        return res.status(403).json({ ok: false, message: 'Only an existing superuser can assign superuser role' });
      }
    }

    let changes = 0;
    if (isPostgres) {
        changes = await db('users').where('username', targetUsername).update({ role });
    } else {
        const info = legacyDb.prepare('UPDATE users SET role = ? WHERE username = ?').run(role, targetUsername);
        changes = info.changes;
    }

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }

    appendAudit({
        Action: 'USER_ROLE_UPDATE',
        User: req.user.user_id,
        AssetId: targetUsername,
        Severity: 'WARN',
        Details: `Updated role for ${targetUsername} to ${role}`
    });

    return res.json({ ok: true, message: 'Role updated successfully' });
  } catch (err) {
    console.error('Tenant user role update error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while updating role' });
  }
});

app.delete('/api/tenant/users/:username', authenticateJWT, authorizeRoles('admin', 'superuser'), requirePermission('user.manage'), async (req, res) => {
  try {
    const targetUsername = req.params.username;
    if (!targetUsername) {
      return res.status(400).json({ ok: false, message: 'Username is required' });
    }
    if (String(req.user.user_id) === String(targetUsername)) {
      return res.status(400).json({ ok: false, message: 'You cannot delete your own account' });
    }
    const companyId = req.user.company_id;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    let changes = 0;
    if (isPostgres) {
        changes = await db('users').where({ username: targetUsername, company_id: companyId }).del();
    } else {
        const info = legacyDb.prepare('DELETE FROM users WHERE username = ? AND company_id = ?')
          .run(targetUsername, companyId);
        changes = info.changes;
    }
    
    if (!changes) {
      return res.status(404).json({ ok: false, message: 'User not found for this company' });
    }

    appendAudit({
        Action: 'USER_DELETE',
        User: req.user.user_id,
        AssetId: targetUsername,
        Severity: 'WARN',
        Details: `Deleted user ${targetUsername}`
    });

    return res.json({ ok: true, message: 'User deleted successfully' });
  } catch (err) {
    console.error('Tenant user delete error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while deleting user' });
  }
});

app.get('/api/company', authenticateJWT, async (req, res) => {
  try {
    const companyId = req.user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, message: 'Missing company id in token' });
    }
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let row;
    if (isPostgres) {
        row = await db('companies').where('id', companyId).first();
        row = normalizeResult(row);
    } else {
        row = legacyDb.prepare('SELECT name, created_at FROM companies WHERE id = ?').get(companyId);
    }
    
    if (!row) {
      return res.json({
        ok: true,
        company: { name: DEFAULT_COMPANY_NAME }
      });
    }
    return res.json({
      ok: true,
      company: {
        name: row.Name || row.name,
        createdAt: row.CreatedAt || row.created_at
      }
    });
  } catch (err) {
    console.error('Company lookup error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while fetching company' });
  }
});

app.post('/api/signup', async (req, res) => {
  const { username, password, email, employeeId } = req.body;
  console.log(`Signup attempt for user: ${username}`);
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Username and password are required' });
  }
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let existingUser;
    if (isPostgres) {
        existingUser = await db('users').where('username', username).first();
    } else {
        existingUser = legacyDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    }

    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const fullname = email || username;
    const role = 'user';
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    
    if (isPostgres) {
        await db('users').insert({
            username,
            password: passwordHash,
            fullname,
            role,
            employee_id: employeeId || null,
            company_id: companyId,
            client_id: companyId
        });
    } else {
        const stmt = legacyDb.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(username, passwordHash, fullname, role, employeeId || null, companyId, companyId);
    }
    
    console.log(`User ${username} created successfully`);
    res.json({ ok: true, message: 'User registered successfully' });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ ok: false, message: err.message });
  }
});

// Network Credentials API
app.get('/api/network/credentials', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let creds;
    if (isPostgres) {
        creds = await db('network_credentials').orderBy('device_name', 'asc');
        creds = normalizeResult(creds);
    } else {
        creds = legacyDb.prepare('SELECT * FROM network_credentials ORDER BY device_name').all();
    }
    res.json({ ok: true, credentials: creds });
  } catch (err) {
    console.error('Error fetching credentials:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/network/credentials', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const { device_name, ip_address, type, username, password, notes } = req.body;
    if (!device_name) {
      return res.status(400).json({ ok: false, message: 'Device name is required' });
    }
    const id = 'NC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    
    legacyDb.prepare(`
      INSERT INTO network_credentials (id, device_name, ip_address, type, username, password, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, device_name, ip_address, type, username, password, notes, req.user.user_id, now, now);

    appendAudit({
      Action: 'NETWORK_CRED_CREATE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'INFO',
      Details: `Created network credential for ${device_name}`
    });

    res.json({ ok: true, message: 'Credential created', id });
  } catch (err) {
    console.error('Error creating credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.put('/api/network/credentials/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { device_name, ip_address, type, username, password, notes } = req.body;
    const now = new Date().toISOString();

    const info = legacyDb.prepare(`
      UPDATE network_credentials 
      SET device_name = ?, ip_address = ?, type = ?, username = ?, password = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(device_name, ip_address, type, username, password, notes, now, id);

    if (!info.changes) {
      return res.status(404).json({ ok: false, message: 'Credential not found' });
    }

    appendAudit({
      Action: 'NETWORK_CRED_UPDATE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'INFO',
      Details: `Updated network credential for ${device_name}`
    });

    res.json({ ok: true, message: 'Credential updated' });
  } catch (err) {
    console.error('Error updating credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.delete('/api/network/credentials/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_manager'), (req, res) => {
  try {
    const { id } = req.params;
    const info = legacyDb.prepare('DELETE FROM network_credentials WHERE id = ?').run(id);

    if (!info.changes) {
      return res.status(404).json({ ok: false, message: 'Credential not found' });
    }

    appendAudit({
      Action: 'NETWORK_CRED_DELETE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'WARN',
      Details: `Deleted network credential ${id}`
    });

    res.json({ ok: true, message: 'Credential deleted' });
  } catch (err) {
    console.error('Error deleting credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// Network Contacts API
app.get('/api/network/contacts', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const contacts = legacyDb.prepare('SELECT * FROM network_contacts ORDER BY service').all();
    res.json({ ok: true, contacts: contacts });
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/network/contacts', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const { service, provider, contact, email } = req.body;
    if (!service) {
      return res.status(400).json({ ok: false, message: 'Service name is required' });
    }
    const id = 'NC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    
    legacyDb.prepare(`
      INSERT INTO network_contacts (id, service, provider, contact, email, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, service, provider, contact, email, req.user.user_id, now, now);

    appendAudit({
      Action: 'NETWORK_CONTACT_CREATE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'INFO',
      Details: `Created network contact for ${service}`
    });

    res.json({ ok: true, message: 'Contact created', id });
  } catch (err) {
    console.error('Error creating contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.put('/api/network/contacts/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const { id } = req.params;
    const { service, provider, contact, email } = req.body;
    const now = new Date().toISOString();

    const info = legacyDb.prepare(`
      UPDATE network_contacts 
      SET service = ?, provider = ?, contact = ?, email = ?, updated_at = ?
      WHERE id = ?
    `).run(service, provider, contact, email, now, id);

    if (!info.changes) {
      return res.status(404).json({ ok: false, message: 'Contact not found' });
    }

    appendAudit({
      Action: 'NETWORK_CONTACT_UPDATE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'INFO',
      Details: `Updated network contact for ${service}`
    });

    res.json({ ok: true, message: 'Contact updated' });
  } catch (err) {
    console.error('Error updating contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.delete('/api/network/contacts/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_manager'), (req, res) => {
  try {
    const { id } = req.params;
    const info = legacyDb.prepare('DELETE FROM network_contacts WHERE id = ?').run(id);

    if (!info.changes) {
      return res.status(404).json({ ok: false, message: 'Contact not found' });
    }

    appendAudit({
      Action: 'NETWORK_CONTACT_DELETE',
      User: req.user.user_id,
      AssetId: id,
      Severity: 'WARN',
      Details: `Deleted network contact ${id}`
    });

    res.json({ ok: true, message: 'Contact deleted' });
  } catch (err) {
    console.error('Error deleting contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// --- Company Template API ---
// (Moved to later in the file to prevent conflicts)

// --- Project Search API for DC ---

app.get('/api/projects/search', authenticateJWT, (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json({ success: true, projects: [] });
        }

        const searchTerm = `%${q}%`;
        // Search by ProjectName or ID (Project ID is usually stored in ID column, but sometimes users refer to 'ProjectName' as ID if it's a code)
        // We will select relevant columns for DC population
        const projects = legacyDb.prepare(`
            SELECT 
                ID, ProjectName, 
                BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode,
                ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode
            FROM projects 
            WHERE ProjectName LIKE ? OR ID LIKE ?
            LIMIT 10
        `).all(searchTerm, searchTerm);

        res.json({ success: true, projects });
    } catch (err) {
        console.error('Error searching projects:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- User Management API ---
app.post('/api/users/create', authenticateJWT, authorizeRoles('admin', 'superuser'), async (req, res) => {
  const { username, password, fullname, role, employeeId } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Username and password are required' });
  }
  const requestedRole = role || 'user';
  if (requestedRole === 'superuser' && req.user.role !== 'superuser') {
    return res.status(403).json({ ok: false, message: 'Only superuser can create superuser accounts' });
  }
  try {
    const existingUser = legacyDb.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    const stmt = legacyDb.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(username, passwordHash, fullname || username, requestedRole, employeeId || null, companyId, companyId);
    return res.json({ ok: true, message: 'User created successfully' });
  } catch (err) {
    console.error('Error creating user:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while creating user' });
  }
});

app.get('/api/users', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
    try {
        const users = await db('users').select('username', 'fullname', 'role', 'department');
        res.json({ ok: true, users });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ ok: false, message: 'Database error' });
    }
});

app.post('/api/users/update-role', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
    const { username, role } = req.body;
    if (!username || !role) {
        return res.status(400).json({ ok: false, message: 'Username and role are required' });
    }
    
    try {
        const result = await db('users').where('username', username).update({ role });
        
        if (result > 0) {
            res.json({ ok: true, message: 'Role updated successfully' });
        } else {
            res.status(404).json({ ok: false, message: 'User not found' });
        }
    } catch (err) {
        console.error('Error updating role:', err);
        res.status(500).json({ ok: false, message: 'Database error' });
    }
});
app.get('/api/qr/generate/:text', async (req, res) => {
  try {
    const text = req.params.text;
    const size = parseInt(req.query.size) || 300; // Allow size override
    const qrImage = await qrcode.toDataURL(text, { width: size, margin: 2 });
    // Convert base64 to binary
    const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");
    const img = Buffer.from(base64Data, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(img);
  } catch (err) {
    console.error('QR API error:', err);
    res.status(500).send('Error generating QR');
  }
});

const STATIC_IP = process.env.STATIC_IP; // User preferred static IP (optional)

app.get('/api/qr/dynamic/asset/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Prefer the current host header for dynamic links, or fallback to STATIC_IP / detected IP
    const host = req.get('host') || STATIC_IP || `${getLocalIP()}:${process.env.PORT || 8080}`;
    
    // Generate URL-based QR code for compatibility with standard camera apps
    const urlText = `http://${host}/asset/${encodeURIComponent(id)}`;
    
    const size = parseInt(req.query.size) || 300;
    const qrImage = await qrcode.toDataURL(urlText, { width: size, margin: 2 });
    
    const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");
    const img = Buffer.from(base64Data, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(img);
  } catch (err) {
    console.error('Dynamic QR API error:', err);
    res.status(500).send('Error generating dynamic QR');
  }
});

app.get('/api/qr/dynamic/project/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Prefer the current host header for dynamic links
    const host = req.get('host') || STATIC_IP || `${getLocalIP()}:${process.env.PORT || 8080}`;
    
    // URL for project details (Public View)
    const urlText = `http://${host}/project/${encodeURIComponent(id)}`;
    
    const size = parseInt(req.query.size) || 300;
    const qrImage = await qrcode.toDataURL(urlText, { width: size, margin: 2 });
    
    const base64Data = qrImage.replace(/^data:image\/png;base64,/, "");
    const img = Buffer.from(base64Data, 'base64');
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': img.length,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
    });
    res.end(img);
  } catch (err) {
    console.error('Dynamic Project QR API error:', err);
    res.status(500).send('Error generating dynamic Project QR');
  }
});

app.post('/api/assets', authenticateJWT, async (req, res) => {
  try {
    const asset = req.body;
    const hasEditPrice = hasPermission(req.user.role, 'asset.edit_price');
    const userDept = req.user.department;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';

    // RBAC: Force department if not admin
    if (!isAdmin && userDept) {
        asset.Department = userDept;
    }

    // RBAC: Clear price if not allowed to set it
    if (!hasEditPrice) {
        asset.asset_value = 0;
        asset.UnitPrice = 0;
    }
    
    // Basic Validation
    if (!asset.ItemName || asset.ItemName.trim() === '') {
      return res.status(400).json({ success: false, error: 'Item Name is required' });
    }
    if (!asset.Category || asset.Category.trim() === '') {
      return res.status(400).json({ success: false, error: 'Category is required' });
    }
    if (!asset.Type || asset.Type.trim() === '') {
      return res.status(400).json({ success: false, error: 'Type (Kind) is required' });
    }

    console.log('Adding new asset:', asset.ItemName);
    
    // Generate unique ID if not present
    let newId = asset.ID || asset.Id;
    if (!newId) {
      newId = generateModernAssetId(asset.CurrentLocation || '', asset.Type);
      console.log('Generated Modern ID:', newId);
    } else {
      // Check if ID already exists
      const existing = await db('assets').where(isPostgres ? 'id' : 'ID', newId).first();
      if (existing) {
        return res.status(400).json({ success: false, error: `Asset ID ${newId} already exists` });
      }
    }

    // Generate Initial Client Label (Location-based)
    // Format: (Kind)-(Location)-(6DigitCode)
    const assetParts = newId.split('-');
    const assetKind = assetParts[0] || 'AST';
    const locCode = assetParts[1] || 'LOC';
    const sixDigitCode = assetParts[3] || '000000';
    const initialClientLabel = `${assetKind}-${locCode}-${sixDigitCode}`;

    // Generate QR Code if not present and NoQR is not true
    let qrCode = asset.QRCode;
    if (!qrCode && !asset.NoQR) {
      // Use STATIC_IP if configured, otherwise detected local IP
      const ip = STATIC_IP || getLocalIP();
      // Use configured PORT or default to 9090 (Test Server)
      const port = process.env.PORT || 9090;
      
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`;

      console.log(`Generating QR for Port ${port} with URL: ${urlText}`);
      qrCode = await qrcode.toDataURL(urlText, { width: 512 });
    }

    await db('assets').insert(normalizeDBData({
      ID: newId,
      ItemName: asset.ItemName || '',
      Status: asset.Status || 'In Store',
      Make: asset.Make || '',
      Model: asset.Model || '',
      SrNo: encryptionService.encryptDeterministic(asset.SrNo || ''),
      Type: asset.Type || '',
      Category: asset.Category || '',
      Icon: asset.Icon || '',
      isPlaceholder: 0,
      ParentId: asset.ParentId || null,
      CurrentLocation: asset.CurrentLocation || '',
      DispatchReceiveDt: asset.DispatchReceiveDt || '',
      PurchaseDetails: asset.PurchaseDetails || '',
      Remarks: asset.Remarks || '',
      LastUpdated: new Date().toISOString(),
      QRCode: qrCode || null,
      AssignedTo: asset.AssignedTo || '',
      client_label: initialClientLabel,
      NoQR: asset.NoQR ? 1 : 0,
      warranty_months: asset.warranty_months || 0,
      amc_months: asset.amc_months || 0,
      asset_value: asset.asset_value || 0,
      Currency: asset.Currency || 'USD',
      PurchaseDate: asset.PurchaseDate || '',
      conversion_unit: asset.conversion_unit || null,
      conversion_factor: asset.conversion_factor || null,
      conversion_mode: asset.conversion_mode || 'multiply',
      is_quantity_tracked: asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0,
      is_batch: asset.is_batch || 0
    }));

    appendAudit({
      Action: 'CREATE',
      User: req.headers['x-user'] || 'web',
      AssetId: newId,
      Severity: 'INFO',
      Details: `Asset created: ${asset.ItemName} (${asset.Type})`
    });

    // Log to asset history
    await logAssetHistory(newId, 'CREATE', null, asset.Status || 'In Store', req.headers['x-user'] || 'web', `Initial assignment to: ${asset.AssignedTo || 'None'}`);

    const qtyUnit = normalizeQtyUnit(asset.quantity_unit || asset.quantityUnit || asset.qty_unit || asset.qtyUnit)
    const qtyTotal = parseQtyNumber(asset.quantity_total ?? asset.quantityTotal ?? asset.qty_total ?? asset.qtyTotal)
    const qtyPrecision = parseQtyNumber(asset.quantity_precision ?? asset.quantityPrecision ?? asset.qty_precision ?? asset.qtyPrecision)
    const isQtyTracked = asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0;

    if (isQtyTracked && qtyUnit && qtyTotal !== null && qtyTotal > 0) {
      await db('assets')
        .where('ID', newId)
        .update({
          quantity_root_id: newId,
          quantity_unit: qtyUnit,
          quantity_total: 0,
          quantity_available: 0,
          quantity_precision: qtyPrecision || 0,
          quantity_updated_at: new Date().toISOString(),
          is_quantity_tracked: 1
        });

      await applyQuantityEvent({
        rootId: newId,
        type: 'INIT',
        actor: getRequestActor(req),
        note: asset.quantity_note || asset.quantityNote || null,
        metadata: { source: 'asset_create' },
        lines: [
          { assetId: newId, unit: qtyUnit, deltaAvailable: qtyTotal, deltaTotal: qtyTotal, precision: qtyPrecision || 0 }
        ]
      })
    }

    // Save IT details to separate table if any exist
    if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
      await db('asset_it_details').insert(normalizeDBData({
        AssetID: newId,
        MACAddress: encryptionService.encrypt(asset.MACAddress || ''),
        IPAddress: encryptionService.encryptDeterministic(asset.IPAddress || ''),
        NetworkType: asset.NetworkType || '',
        PhysicalPort: asset.PhysicalPort || '',
        VLAN: asset.VLAN || '',
        SocketID: encryptionService.encrypt(asset.SocketID || ''),
        UserID: asset.UserID || ''
      })).onConflict('assetid').merge();
    }

    // Handle nested components (new child assets)
    if (Array.isArray(asset.components) && asset.components.length > 0) {
      for (const comp of asset.components) {
        const compId = generateModernAssetId(asset.CurrentLocation || '');
        await db('components').insert(normalizeDBData({
          ID: compId,
          ParentId: newId, // ParentId
          ItemName: comp.ItemName || '',
          Make: comp.Make || '',
          Model: comp.Model || '',
          SrNo: comp.SrNo || '',
          Status: comp.Status || asset.Status || 'In Store',
          Type: comp.Type || 'Component',
          Category: comp.Category || asset.Category || '',
          LastUpdated: new Date().toISOString(),
          NoQR: 1 // NoQR = true
        }));
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds) && asset.linkedIds.length > 0) {
      for (const linkId of asset.linkedIds) {
        const existingAsset = await db('assets').where(isPostgres ? 'id' : 'ID', linkId).first();
        if (!existingAsset) continue;

        // Validation: Check if asset is already assigned to a parent
        const existingParentInAssets = existingAsset.ParentId || existingAsset.parentid;
        const existingComp = await db('components').where(isPostgres ? 'id' : 'ID', linkId).first();
        const existingParentInComps = existingComp ? (existingComp.ParentId || existingComp.parentid) : null;

        if ((existingParentInAssets && existingParentInAssets !== newId) || 
            (existingParentInComps && existingParentInComps !== newId)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        await db('components').insert(normalizeDBData({
          ID: linkId,
          ParentId: newId,
          ItemName: existingAsset.ItemName || existingAsset.itemname,
          Make: existingAsset.Make || existingAsset.make || '',
          Model: existingAsset.Model || existingAsset.model || '',
          SrNo: existingAsset.SrNo || existingAsset.srno || '',
          Status: existingAsset.Status || existingAsset.status || 'In Store',
          Type: existingAsset.Type || existingAsset.type || 'Component',
          Category: existingAsset.Category || existingAsset.category || '',
          LastUpdated: new Date().toISOString(),
          NoQR: 0 // NoQR = false (it's a QR asset)
        })).onConflict(isPostgres ? 'id' : 'ID').merge();
        
        // Update ParentId in assets table instead of clearing it
        await db('assets').where(isPostgres ? 'id' : 'ID', linkId).update(normalizeDBData({ ParentId: newId }));
      }
    }

    // 6. Link back to PO if applicable
    if (asset.linked_po_item_id) {
        try {
            await db('project_order_items')
              .where(isPostgres ? 'id' : 'ID', asset.linked_po_item_id)
              .update(normalizeDBData({ AssetID: newId, Status: "Asset Created" }));
            
            // Also update the asset record with PO linking info if not already set
            await db('assets')
              .where(isPostgres ? 'id' : 'ID', newId)
              .update(normalizeDBData({
                linked_po_item_id: asset.linked_po_item_id,
                BoughtAgainstPO: asset.BoughtAgainstPO || null
              }));
              
            console.log(`[PO Link] Linked Asset ${newId} to PO Item ${asset.linked_po_item_id}`);
        } catch (linkErr) {
            console.error('[PO Link] Failed to link back to PO item:', linkErr);
        }
    }

    appendAudit({ 
      Action: 'CREATE', 
      User: req.headers['x-user'] || 'web', 
      AssetId: newId, 
      Severity: 'INFO', 
      Details: `Asset created: ${asset.ItemName}` 
    });

    res.json({ success: true, ID: newId });
  } catch (err) {
    console.error('Failed to create asset:', err);
    res.status(500).send('Error creating asset: ' + err.message);
  }
})

app.post('/api/quantity/split', async (req, res) => {
  try {
    const actor = getRequestActor(req)
    const parentId = String(req.body?.parentId || req.body?.ParentId || '').trim()
    const amount = parseQtyNumber(req.body?.amount ?? req.body?.Amount)
    const note = req.body?.note || null
    const child = req.body?.child || {}

    if (!parentId) return res.status(400).json({ success: false, error: 'parentId is required' })
    if (amount === null || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be > 0' })

    const parent = getQuantityAsset(parentId)
    if (!parent || !parent.quantity_root_id) return res.status(400).json({ success: false, error: 'Parent is not a quantity asset' })
    if (!normalizeQtyUnit(parent.quantity_unit)) return res.status(400).json({ success: false, error: 'Parent is missing quantity unit' })

    const rootId = parent.quantity_root_id
    const unit = normalizeQtyUnit(parent.quantity_unit)
    const precision = parent.quantity_precision ?? null

    // Parse target to extract ProjectID if it's a project
    let assignedTo = child.AssignedTo || ''
    let projectId = parent.ProjectID || null
    
    if (assignedTo.startsWith('Project:')) {
      const match = assignedTo.match(/\(([^)]+)\)$/)
      if (match) {
        projectId = match[1]
        assignedTo = assignedTo.replace(/Project:\s*/, '').replace(/\s*\([^)]+\)$/, '').trim()
      }
    } else if (assignedTo.startsWith('Employee:')) {
      assignedTo = assignedTo.replace(/Employee:\s*/, '').replace(/\s*\([^)]+\)$/, '').trim()
    }

    const newId = generateSplitAssetId(parentId)
    const existing = legacyDb.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    let qrCode = child.QRCode || null
    const noQr = child.NoQR ? 1 : 0
    if (!qrCode && !noQr) {
      const ip = getLocalIP()
      const port = process.env.PORT || 9090
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
      qrCode = await qrcode.toDataURL(urlText, { width: 512 })
    }

    const splitTx = legacyDb.transaction(() => {
      const insert = legacyDb.prepare(`
        INSERT INTO assets (
          ID, ItemName, Status, Make, Model, SrNo, Type,
          Category, Icon, isPlaceholder, ParentId,
          CurrentLocation,
          DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
          warranty_months, amc_months, asset_value, Currency, PurchaseDate,
          quantity_parent_id, quantity_root_id, quantity_unit, quantity_total, quantity_available, quantity_precision, quantity_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insert.run(
        newId,
        child.ItemName || `${parent.ItemName || 'Item'} (Split)`,
        child.Status || parent.Status || 'In Store',
        child.Make || '',
        child.Model || '',
        child.SrNo || '',
        child.Type || parent.Type || '',
        child.Category || '',
        child.Icon || '',
        0,
        parentId,
        child.CurrentLocation || parent.CurrentLocation || '',
        child.DispatchReceiveDt || '',
        child.PurchaseDetails || '',
        child.Remarks || '',
        new Date().toISOString(),
        qrCode,
        assignedTo,
        noQr,
        child.warranty_months || 0,
        child.amc_months || 0,
        child.asset_value || 0,
        child.Currency || 'USD',
        child.PurchaseDate || '',
        parentId,
        rootId,
        unit,
        0,
        0,
        precision,
        new Date().toISOString()
      )

      if (projectId) {
        legacyDb.prepare(`
          INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
          VALUES (?, ?, ?, 'Permanent')
        `).run(projectId, newId, new Date().toISOString())
      }

      applyQuantityEvent({
        rootId,
        type: 'SPLIT',
        actor,
        note,
        metadata: { parentId, childId: newId },
        lines: [
          { assetId: parentId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: amount, deltaTotal: amount, precision }
        ]
      })

      appendAudit({
        Action: 'QTY_SPLIT',
        User: actor,
        AssetId: parentId,
        Severity: 'INFO',
        Details: `Split ${amount} ${unit} to ${newId}`
      })

      return newId
    })

    const childId = splitTx()
    res.json({ success: true, childId })
  } catch (err) {
    console.error('Quantity split failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/quantity/issue', async (req, res) => {
  try {
    const actor = getRequestActor(req)
    const assetId = String(req.body?.assetId || req.body?.AssetId || '').trim()
    const amount = parseQtyNumber(req.body?.amount ?? req.body?.Amount)
    const note = req.body?.note || null
    const target = req.body?.target || null

    if (!assetId) return res.status(400).json({ success: false, error: 'assetId is required' })
    if (amount === null || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be > 0' })

    const parent = getQuantityAsset(assetId)
    if (!parent || !parent.quantity_root_id) return res.status(400).json({ success: false, error: 'Asset is not a quantity asset' })

    const rootId = parent.quantity_root_id
    const unit = normalizeQtyUnit(parent.quantity_unit)
    if (!unit) return res.status(400).json({ success: false, error: 'Asset is missing quantity unit' })
    const precision = parent.quantity_precision ?? null

    // Parse target to extract details if it's a project or employee
    let assignedTo = target || null
    let projectId = parent.ProjectID || null
    let targetId = null
    let targetType = 'string'
    let displayTarget = assignedTo

    if (assignedTo && assignedTo.startsWith('Project:')) {
      const match = assignedTo.match(/\(([^)]+)\)$/)
      if (match) {
        projectId = match[1]
        targetId = projectId
        targetType = 'project'
        assignedTo = assignedTo.replace(/Project:\s*/, '').replace(/\s*\([^)]+\)$/, '').trim()
        displayTarget = assignedTo
      }
    } else if (assignedTo && assignedTo.startsWith('Employee:')) {
      const match = assignedTo.match(/\(([^)]+)\)$/)
      if (match) {
        targetId = match[1]
        targetType = 'employee'
        assignedTo = assignedTo.replace(/Employee:\s*/, '').replace(/\s*\([^)]+\)$/, '').trim()
        displayTarget = assignedTo
      }
    }

    const newId = generateSplitAssetId(assetId)
    const existing = legacyDb.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 9090
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const issueTx = legacyDb.transaction(() => {
      const insert = legacyDb.prepare(`
        INSERT INTO assets (
          ID, ItemName, Status, Make, Model, SrNo, Type,
          Category, Icon, isPlaceholder, ParentId,
          CurrentLocation,
          DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
          warranty_months, amc_months, asset_value, Currency, PurchaseDate,
          quantity_parent_id, quantity_root_id, quantity_unit, quantity_total, quantity_available, quantity_precision, quantity_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insert.run(
        newId,
        `${parent.ItemName || 'Item'} (Issued)`,
        'Issued',
        parent.Make || '',
        parent.Model || '',
        '', // SrNo
        parent.Type || '',
        parent.Category || '',
        parent.Icon || '',
        0,
        assetId,
        parent.CurrentLocation || '',
        new Date().toISOString(), // DispatchReceiveDt
        parent.PurchaseDetails || '',
        note || '',
        new Date().toISOString(),
        qrCode,
        assignedTo,
        0, // NoQR
        parent.warranty_months || 0,
        parent.amc_months || 0,
        0, // asset_value
        parent.Currency || 'USD',
        parent.PurchaseDate || '',
        assetId,
        rootId,
        unit,
        amount, // child total
        amount, // child available
        precision,
        new Date().toISOString()
      )

      if (projectId) {
        legacyDb.prepare(`
          INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
          VALUES (?, ?, ?, 'Permanent')
        `).run(projectId, newId, new Date().toISOString())
      }

      applyQuantityEvent({
        rootId,
        type: 'ISSUE',
        actor,
        note,
        metadata: { target: displayTarget, targetId, targetType, parentId: assetId, childId: newId },
        lines: [
          { assetId: assetId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: amount, deltaTotal: amount, precision }
        ]
      })

      appendAudit({
        Action: 'QTY_ISSUE',
        User: actor,
        AssetId: assetId,
        Severity: 'INFO',
        Details: `Issued ${amount} ${unit} to ${newId}${displayTarget ? ` (${displayTarget})` : ''}`
      })

      return newId
    })

    const childId = issueTx()
    res.json({ success: true, childId })
  } catch (err) {
    console.error('Quantity issue failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/quantity/consume', async (req, res) => {
  try {
    const actor = getRequestActor(req)
    const assetId = String(req.body?.assetId || req.body?.AssetId || '').trim()
    const amount = parseQtyNumber(req.body?.amount ?? req.body?.Amount)
    const note = req.body?.note || null

    if (!assetId) return res.status(400).json({ success: false, error: 'assetId is required' })
    if (amount === null || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be > 0' })

    const parent = getQuantityAsset(assetId)
    if (!parent || !parent.quantity_root_id) return res.status(400).json({ success: false, error: 'Asset is not a quantity asset' })

    const rootId = parent.quantity_root_id
    const unit = normalizeQtyUnit(parent.quantity_unit)
    if (!unit) return res.status(400).json({ success: false, error: 'Asset is missing quantity unit' })
    const precision = parent.quantity_precision ?? null

    const newId = generateSplitAssetId(assetId)
    const existing = legacyDb.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 8080
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const consumeTx = legacyDb.transaction(() => {
      const insert = legacyDb.prepare(`
        INSERT INTO assets (
          ID, ItemName, Status, Make, Model, SrNo, Type,
          Category, Icon, isPlaceholder, ParentId,
          CurrentLocation,
          DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
          warranty_months, amc_months, asset_value, Currency, PurchaseDate,
          quantity_parent_id, quantity_root_id, quantity_unit, quantity_total, quantity_available, quantity_precision, quantity_updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      insert.run(
        newId,
        `${parent.ItemName || 'Item'} (Consumed)`,
        'Consumed',
        parent.Make || '',
        parent.Model || '',
        '', // SrNo
        parent.Type || '',
        parent.Category || '',
        parent.Icon || '',
        0,
        assetId,
        parent.CurrentLocation || '',
        new Date().toISOString(), // DispatchReceiveDt
        parent.PurchaseDetails || '',
        note || '',
        new Date().toISOString(),
        qrCode,
        null, // AssignedTo
        0, // NoQR
        parent.warranty_months || 0,
        parent.amc_months || 0,
        0, // asset_value
        parent.Currency || 'USD',
        parent.PurchaseDate || '',
        assetId,
        rootId,
        unit,
        amount, // child total
        0, // child available (consumed is gone)
        precision,
        new Date().toISOString()
      )

      if (parent.ProjectID) {
        legacyDb.prepare(`
          INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
          VALUES (?, ?, ?, 'Permanent')
        `).run(parent.ProjectID, newId, new Date().toISOString())
      }

      applyQuantityEvent({
        rootId,
        type: 'CONSUME',
        actor,
        note,
        metadata: { parentId: assetId, childId: newId },
        lines: [
          { assetId: assetId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: 0, deltaTotal: amount, precision } // Child gets the total, but 0 available
        ]
      })

      appendAudit({
        Action: 'QTY_CONSUME',
        User: actor,
        AssetId: assetId,
        Severity: 'INFO',
        Details: `Consumed ${amount} ${unit} to ${newId}`
      })

      return newId
    })

    const childId = consumeTx()
    res.json({ success: true, childId })
  } catch (err) {
    console.error('Quantity consume failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/quantity/adjust', (req, res) => {
  try {
    const admin = requireAdmin(req)
    if (!admin) return res.status(403).json({ success: false, error: 'Forbidden' })

    const actor = getRequestActor(req)
    const assetId = String(req.body?.assetId || req.body?.AssetId || '').trim()
    const deltaAvailable = parseQtyNumber(req.body?.deltaAvailable ?? req.body?.delta_available)
    const deltaTotal = parseQtyNumber(req.body?.deltaTotal ?? req.body?.delta_total) ?? 0
    const note = req.body?.note || null

    if (!assetId) return res.status(400).json({ success: false, error: 'assetId is required' })
    if (deltaAvailable === null || deltaAvailable === 0) return res.status(400).json({ success: false, error: 'deltaAvailable must be non-zero' })

    const asset = getQuantityAsset(assetId)
    if (!asset || !asset.quantity_root_id) return res.status(400).json({ success: false, error: 'Asset is not a quantity asset' })

    const unit = normalizeQtyUnit(asset.quantity_unit)
    if (!unit) return res.status(400).json({ success: false, error: 'Asset is missing quantity unit' })

    applyQuantityEvent({
      rootId: asset.quantity_root_id,
      type: 'ADJUST',
      actor,
      note,
      metadata: { admin: admin.username || admin.fullname || actor },
      lines: [{ assetId, unit, deltaAvailable, deltaTotal, precision: asset.quantity_precision ?? null }]
    })

    appendAudit({
      Action: 'QTY_ADJUST',
      User: actor,
      AssetId: assetId,
      Severity: 'WARN',
      Details: `Adjusted ${deltaAvailable} ${unit}${deltaTotal ? ` (total ${deltaTotal})` : ''}`
    })

    res.json({ success: true })
  } catch (err) {
    console.error('Quantity adjust failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/quantity/events/:rootId', async (req, res) => {
  try {
    const rootId = String(req.params.rootId || '').trim()
    if (!rootId) return res.status(400).json({ success: false, error: 'rootId is required' })

    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    let events, lines;
    if (isPostgres) {
        events = await db('quantity_events')
          .where('root_id', rootId)
          .orderBy('id', 'asc')
          .limit(2000);
          
        lines = await db('quantity_event_lines')
          .whereIn('event_id', db('quantity_events').select('id').where('root_id', rootId))
          .orderBy('event_id', 'asc');
          
        events = normalizeResult(events);
        lines = normalizeResult(lines);
    } else {
        events = legacyDb.prepare(`
          SELECT id, root_id, type, actor, timestamp, note, metadata_json
          FROM quantity_events
          WHERE root_id = ?
          ORDER BY id ASC
          LIMIT 2000
        `).all(rootId)

        lines = legacyDb.prepare(`
          SELECT event_id, asset_id, unit, delta_available, delta_total
          FROM quantity_event_lines
          WHERE event_id IN (SELECT id FROM quantity_events WHERE root_id = ?)
          ORDER BY event_id ASC
        `).all(rootId)
    }

    const linesByEvent = new Map()
    for (const l of lines) {
      const eventId = l.event_id || l.EventId;
      const arr = linesByEvent.get(eventId) || []
      arr.push(l)
      linesByEvent.set(eventId, arr)
    }

    res.json({
      success: true,
      rootId,
      events: events.map((e) => ({
        ...e,
        metadata: e.metadata_json ? (typeof e.metadata_json === 'string' ? JSON.parse(e.metadata_json) : e.metadata_json) : (e.metadata || null),
        lines: linesByEvent.get(e.id || e.ID) || []
      }))
    })
  } catch (err) {
    console.error('Quantity events fetch failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/quantity/replay/:rootId', async (req, res) => {
  try {
    const rootId = String(req.params.rootId || '').trim()
    if (!rootId) return res.status(400).json({ success: false, error: 'rootId is required' })

    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let rows;
    
    if (isPostgres) {
        rows = await db('quantity_event_lines')
          .select('asset_id', 'unit')
          .sum('delta_available as delta_available_sum')
          .sum('delta_total as delta_total_sum')
          .whereIn('event_id', db('quantity_events').select('id').where('root_id', rootId))
          .groupBy('asset_id', 'unit');
    } else {
        rows = legacyDb.prepare(`
          SELECT asset_id, unit,
                 SUM(delta_available) AS delta_available_sum,
                 SUM(delta_total) AS delta_total_sum
          FROM quantity_event_lines
          WHERE event_id IN (SELECT id FROM quantity_events WHERE root_id = ?)
          GROUP BY asset_id, unit
        `).all(rootId)
    }

    const balances = rows.map((r) => ({
      assetId: r.asset_id || r.assetid,
      unit: r.unit,
      availableFromEvents: Number(r.delta_available_sum || 0),
      totalFromEvents: Number(r.delta_total_sum || 0)
    }))

    res.json({ success: true, rootId, balances })
  } catch (err) {
    console.error('Quantity replay failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/assets/bulk', async (req, res) => {
  try {
    const assets = req.body;
    if (!Array.isArray(assets)) {
      console.error('Bulk upload: Expected an array, got:', typeof assets);
      return res.status(400).send('Expected an array of assets');
    }

    // Basic Validation
    const errors = [];
    assets.forEach((asset, idx) => {
      const rowNum = idx + 2; // Assuming header is row 1
      
      if (!asset.ItemName || asset.ItemName.trim() === '') {
        errors.push(`Row ${rowNum}: Item Name is required`);
      }
      if (!asset.Category && !asset.Module) {
        errors.push(`Row ${rowNum}: Category/Module is required`);
      }

      // Numeric validations
      // Allow "Yes"/"No" for AMC/Warranty columns which might be mapped to months or boolean flags
      if (asset.warranty_months && isNaN(parseInt(asset.warranty_months)) && !['yes', 'no'].includes(asset.warranty_months.toString().toLowerCase())) {
        errors.push(`Row ${rowNum}: Warranty Months must be a number or Yes/No`);
      }
      if (asset.amc_months && isNaN(parseInt(asset.amc_months)) && !['yes', 'no'].includes(asset.amc_months.toString().toLowerCase())) {
        errors.push(`Row ${rowNum}: AMC Months must be a number or Yes/No`);
      }
      if (asset.asset_value && isNaN(parseFloat(asset.asset_value))) {
        errors.push(`Row ${rowNum}: Asset Value must be a number`);
      }

      // ID sanity check
      const id = asset.ID || asset.Id;
      if (id && /[^a-zA-Z0-9-]/.test(id)) {
        errors.push(`Row ${rowNum}: Asset ID contains invalid characters (only alphanumeric and hyphens allowed)`);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors: errors.slice(0, 10), totalErrors: errors.length });
    }

    console.log(`Bulk adding ${assets.length} assets...`);
    if (assets.length > 0) {
      console.log('Sample asset:', JSON.stringify(assets[0], null, 2));
    }
    const username = req.headers['x-user'] || 'web';
    const timestamp = new Date().toISOString();
    const results = [];
    const ip = getLocalIP();
    const port = process.env.PORT || 8080;

    // Helper to parse AMC/Warranty boolean-ish values
    const parseMonths = (val) => {
        if (!val) return 0;
        const s = val.toString().trim().toLowerCase();
        if (s === 'yes') return 12; // Default to 1 year if just "Yes"
        if (s === 'no') return 0;
        return parseInt(val) || 0;
    };

    const parseBool = (val) => {
        if (!val) return 0;
        const s = val.toString().trim().toLowerCase();
        return (s === 'yes' || s === 'true' || s === '1') ? 1 : 0;
    };

    // Pre-generate IDs and QR codes to keep the transaction fast and handle async qrcode
    const processedAssets = await Promise.all(assets.map(async (asset) => {
      let newId = asset.ID || asset.Id;
      if (!newId) {
        newId = generateModernAssetId(asset.CurrentLocation || asset.Location || '');
      }

      let qrCode = asset.QRCode;
      if (!qrCode && !asset.NoQR) {
        try {
          const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`;
          qrCode = await qrcode.toDataURL(urlText, { width: 512 });
        } catch (qrErr) {
          console.error('QR Generation failed for', newId, qrErr);
          qrCode = '';
        }
      }

      return { ...asset, ID: newId, QRCode: qrCode || null };
    }));

    // Check for duplicate IDs in the batch
    const idSet = new Set();
    const batchDuplicates = new Set();
    processedAssets.forEach(a => {
      if (idSet.has(a.ID)) {
        batchDuplicates.add(a.ID);
      }
      idSet.add(a.ID);
    });

    if (batchDuplicates.size > 0) {
      return res.status(400).json({ 
        success: false, 
        error: `Duplicate IDs found in batch: ${Array.from(batchDuplicates).join(', ')}` 
      });
    }

    // Check if any IDs already exist in database
    const existingIds = [];
    const checkStmt = legacyDb.prepare('SELECT ID FROM assets WHERE ID = ?');
    for (const asset of processedAssets) {
        const existing = checkStmt.get(asset.ID);
        if (existing) existingIds.push(asset.ID);
    }
    if (existingIds.length > 0) {
        return res.status(400).json({ 
          success: false, 
          error: `Some Asset IDs already exist in database: ${existingIds.slice(0, 5).join(', ')}${existingIds.length > 5 ? '...' : ''}` 
        });
    }

    // DB Operations
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    if (isPostgres) {
        // PostgreSQL Transaction
        await db.transaction(async (trx) => {
            for (const asset of processedAssets) {
                // Prepare Record
                const record = {
                    id: asset.ID,
                    itemname: asset.ItemName || '',
                    itemdescription: asset.ItemDescription || '',
                    status: asset.Status || 'In Store',
                    make: asset.Make || '',
                    model: asset.Model || '',
                    srno: encryptionService.encryptDeterministic(asset.SrNo || asset.SerialNo || ''),
                    serialno: encryptionService.encryptDeterministic(asset.SerialNo || asset.SrNo || ''),
                    type: asset.Type || '',
                    category: asset.Category || asset.Module || '',
                    icon: asset.Icon || '📦',
                    isplaceholder: parseBool(asset.IsPlaceholder),
                    parentid: asset.ParentId || null,
                    currentlocation: asset.CurrentLocation || asset.Location || '',
                    previouslocation: asset.PreviousLocation || '',
                    purchasedetails: asset.PurchaseDetails || '',
                    remarks: asset.Remarks || '',
                    purpose: asset.Purpose || '',
                    purchasedate: asset.PurchaseDate || null,
                    lastupdated: timestamp,
                    qrcode: asset.QRCode,
                    assignedto: asset.AssignedTo || '',
                    currency: asset.Currency || 'INR',
                    asset_value: parseFloat(asset.asset_value) || 0,
                    unitprice: parseFloat(asset.UnitPrice || asset.asset_value) || 0,
                    warranty_months: parseMonths(asset.warranty_months),
                    amc_months: parseMonths(asset.amc_months),
                    department: asset.Department || ''
                };

                // Insert Main
                await trx('assets').insert(record);

                // Insert IT Details if applicable
                if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
                    await trx('asset_it_details').insert({
                        assetid: asset.ID,
                        macaddress: encryptionService.universalEncrypt(asset.MACAddress || ''),
                        ipaddress: encryptionService.encryptDeterministic(asset.IPAddress || ''),
                        networktype: asset.NetworkType || '',
                        physicalport: asset.PhysicalPort || '',
                        vlan: asset.VLAN || '',
                        socketid: encryptionService.universalEncrypt(asset.SocketID || ''),
                        userid: asset.UserID || ''
                    });
                }
                results.push(asset.ID);
            }
        });
    } else {
        const insertAssetStmt = legacyDb.prepare(`
          INSERT INTO assets (
            ID, ItemName, ItemDescription, Status, Make, Model, SrNo, Type,
            Category, Icon, isPlaceholder, ParentId,
            CurrentLocation,
            DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
            warranty_months, amc_months, asset_value, Currency, PurchaseDate, warranty_tracking
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertItStmt = legacyDb.prepare(`
          INSERT OR REPLACE INTO asset_it_details (
            AssetID, MACAddress, IPAddress, NetworkType, PhysicalPort, VLAN, SocketID, UserID
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const transaction = legacyDb.transaction((assetsList) => {
          for (const asset of assetsList) {
            insertAssetStmt.run(
              asset.ID,
              asset.ItemName || '',
              asset.ItemDescription || '',
              asset.Status || 'In Store',
              asset.Make || '',
              asset.Model || '',
              asset.SrNo || '',
              asset.Type || '',
              asset.Category || asset.Module || '',
              asset.Icon || '',
              0, // isPlaceholder
              asset.ParentId || null,
              asset.CurrentLocation || '',
              asset.DispatchReceiveDt || '',
              asset.PurchaseDetails || '',
              asset.Remarks || '',
              timestamp,
              asset.QRCode || null,
              asset.AssignedTo || '',
              asset.NoQR ? 1 : 0,
              parseMonths(asset.warranty_months),
              parseMonths(asset.amc_months),
              parseFloat(asset.asset_value) || 0,
              asset.Currency || 'USD',
              asset.PurchaseDate || '',
              parseBool(asset.warranty_tracking)
            );

            if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
              insertItStmt.run(
                asset.ID,
                asset.MACAddress || '',
                asset.IPAddress || '',
                asset.NetworkType || '',
                asset.PhysicalPort || '',
                asset.VLAN || '',
                asset.SocketID || '',
                asset.UserID || ''
              );
            }
            results.push(asset.ID);
          }
        });

        transaction(processedAssets);
    }

    appendAudit({ 
      Action: 'BULK_CREATE', 
      User: username, 
      AssetId: 'MULTIPLE', 
      Severity: 'INFO', 
      Details: `Bulk created ${assets.length} assets` 
    });

    res.json({ success: true, count: assets.length, ids: results });
  } catch (err) {
    console.error('Failed to bulk create assets:', err);
    res.status(500).send('Error in bulk creation: ' + err.message);
  }
});

// --- External Integration API (for Zoho, Odoo, etc.) ---

/**
 * @api {get} /api/external/projects List Projects
 * @apiHeader {String} x-api-key API Key
 */
app.get('/api/external/projects', checkApiKey, (req, res) => {
    try {
        const projects = legacyDb.prepare(`
            SELECT ID, ProjectName as Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, OwnerEmail, CoordinatorEmail, Timestamp 
            FROM projects 
            ORDER BY Timestamp DESC
        `).all();
        res.json({ success: true, count: projects.length, data: projects });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @api {post} /api/external/projects Create Project
 * @apiHeader {String} x-api-key API Key
 */
app.post('/api/external/projects', checkApiKey, async (req, res) => {
    try {
        const { name, client, location, currency, description, status, startDate, endDate, ownerEmail, coordinatorEmail } = req.body;
        
        if (!name || !client) {
            return res.status(400).json({ success: false, error: 'Project name and client name are required' });
        }

        const id = generateProjectId(location || 'MUMBAI');
        
        const ip = getLocalIP();
        const port = process.env.PORT || 9090;
        
        // Use the new standardized Project QR payload generator
        // Include asset details URL for scanning
        const baseUrl = `http://${ip}:${port}`;
        const projectUrl = `${baseUrl}/#projects-view?id=${id}`;
        
        const qrPayload = generateProjectQRPayload({
            ID: id,
            Name: name,
            Client: client,
            Status: status,
            Location: location,
            Description: description,
            StartDate: startDate,
            EndDate: endDate,
            OwnerEmail: ownerEmail,
            CoordinatorEmail: coordinatorEmail,
            URL: projectUrl // Add direct URL for scanning
        }, ip, port);
        
        const qrCode = await qrcode.toDataURL(JSON.stringify(qrPayload), { width: 512 });

        const stmt = legacyDb.prepare(`
            INSERT INTO projects (ID, ProjectName, ClientName, Location, Currency, Description, Status, StartDate, EndDate, CreatedBy, OwnerEmail, CoordinatorEmail, Timestamp, QRCode)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run(
            id, 
            name, 
            client, 
            location || 'MUMBAI', 
            currency || 'INR', 
            description || '', 
            status || 'Planning', 
            startDate || '', 
            endDate || '', 
            'External API', 
            ownerEmail || '',
            coordinatorEmail || '',
            new Date().toISOString(),
            qrCode
        );

        appendAudit({ 
            Action: 'EXTERNAL_CREATE_PROJECT', 
            User: 'External API', 
            AssetId: id, 
            Severity: 'INFO', 
            Details: `Project created via external API: ${name}` 
        });

        res.json({ success: true, id, qrCode });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @api {get} /api/external/assets List Assets
 * @apiHeader {String} x-api-key API Key
 */
app.get('/api/external/assets', checkApiKey, (req, res) => {
    try {
        const assets = legacyDb.prepare(`
            SELECT a.ID, a.ItemName, a.Status, a.Make, a.Model, a.Type, a.Category, a.CurrentLocation, a.AssignedTo, a.LastUpdated
            FROM assets a
            ORDER BY a.LastUpdated DESC
        `).all();
        res.json({ success: true, count: assets.length, data: assets });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * @api {get} /api/external/stats Summary Stats
 * @apiHeader {String} x-api-key API Key
 */
app.get('/api/external/stats', checkApiKey, async (req, res) => {
    try {
        const stats = {
            totalAssets: (await db('assets').where(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count,
            totalProjects: (await db('projects').where(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count,
            activeProjects: (await db('projects').where('Status', 'Active').andWhere(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count,
            assetsInUse: (await db('assets').where('Status', 'In Use').andWhere(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count
        };
        res.json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- Project Management Endpoints ---

app.get('/api/projects', async (req, res) => {
    try {
        const { projectId } = req.query;
        let query = db('projects')
            .select('id as ID', 'projectname as Name', 'clientname as ClientName', 'location as Location', 'currency as Currency', 'description as Description', 'status as Status', 'startdate as StartDate', 'enddate as EndDate', 
                   'owneremail as OwnerEmail', 'coordinatoremail as CoordinatorEmail', 'timestamp as Timestamp', 'qrcode as QRCode',
                   'consigneename as ConsigneeName', 'consigneeaddress as ConsigneeAddress', 'consigneegstin as ConsigneeGSTIN', 'consigneestate as ConsigneeState', 'consigneestatecode as ConsigneeStateCode',
                   'buyername as BuyerName', 'buyeraddress as BuyerAddress', 'buyergstin as BuyerGSTIN', 'buyerstate as BuyerState', 'buyerstatecode as BuyerStateCode');

        if (projectId) {
            query.where('id', projectId).andWhere(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            });
        } else {
            query.where(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            });
        }

        const projects = await query.orderBy('timestamp', 'desc');
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        let project;
        if (isPostgres) {
            project = await db('projects')
                .select('id as ID', 'projectname as Name', 'clientname as ClientName', 'location as Location', 'currency as Currency', 'description as Description', 'status as Status', 'startdate as StartDate', 'endDate as EndDate', 
                       'owneremail as OwnerEmail', 'coordinatoremail as CoordinatorEmail', 'timestamp as Timestamp', 'qrcode as QRCode',
                       'consigneename as ConsigneeName', 'consigneeaddress as ConsigneeAddress', 'consigneegstin as ConsigneeGSTIN', 'consigneestate as ConsigneeState', 'consigneestatecode as ConsigneeStateCode',
                       'buyername as BuyerName', 'buyeraddress as BuyerAddress', 'buyergstin as BuyerGSTIN', 'buyerstate as BuyerState', 'buyerstatecode as BuyerStateCode')
                .where('id', id)
                .first();
        } else {
            project = legacyDb.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
        }
            
        if (!project) return res.status(404).send('Project not found');
        res.json(project);
    } catch (err) {
        console.error('Failed to fetch project details:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/history', async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let rows;
        if (isPostgres) {
            rows = await db('project_history').where('projectid', id).orderBy('timestamp', 'asc');
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare('SELECT * FROM project_history WHERE ProjectID = ? ORDER BY Timestamp ASC').all(id);
        }
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/orders', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        console.log(`[PO] Fetching orders for project: ${id}`);
        
        let rows;
        if (isPostgres) {
            rows = await db('project_orders').where('projectid', id).orderBy('timestamp', 'desc');
            rows = normalizeResult(rows);
        } else {
            rows = legacyDb.prepare('SELECT * FROM project_orders WHERE ProjectID = ? ORDER BY Timestamp DESC').all(id);
        }
        
        // Fetch items for each order and calculate fulfillment
        const ordersWithItems = await Promise.all(rows.map(async (order) => {
            let items;
            const orderId = order.ID || order.id;
            
            if (isPostgres) {
                items = await db('project_order_items').where('orderid', orderId).orderBy('srno', 'asc');
                items = normalizeResult(items);
            } else {
                items = legacyDb.prepare('SELECT * FROM project_order_items WHERE OrderID = ? ORDER BY SrNo ASC').all(orderId);
            }
            
            // For each item, find how many assets are linked to it (Permanent + Temporary)
            const itemsWithFulfillment = await Promise.all(items.map(async (item) => {
                const itemId = item.ID || item.id;
                let permanentFulfilled, temporaryFulfilled;
                
                if (isPostgres) {
                    const permResult = await db('assets').where('linked_po_item_id', itemId).count('* as count').first();
                    permanentFulfilled = permResult ? permResult.count : 0;
                    
                    const tempResult = await db('temporary_assets').where('linked_po_item_id', itemId).count('* as count').first();
                    temporaryFulfilled = tempResult ? tempResult.count : 0;
                } else {
                    permanentFulfilled = legacyDb.prepare('SELECT count(*) as count FROM assets WHERE linked_po_item_id = ?').get(itemId).count;
                    temporaryFulfilled = legacyDb.prepare('SELECT count(*) as count FROM temporary_assets WHERE linked_po_item_id = ?').get(itemId).count;
                }
                
                return { 
                    ...item, 
                    fulfilledQty: (Number(permanentFulfilled) + Number(temporaryFulfilled))
                };
            }));

            return { ...order, items: itemsWithFulfillment };
        }));
        
        res.json({ success: true, orders: ordersWithItems, data: ordersWithItems });
    } catch (err) {
        console.error('[PO] Fetch Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/orders', authenticateJWT, async (req, res) => {
  try {
    const { search } = req.query;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    const userDept = req.user.department;
    const userProjectId = req.user.projectId;
    const hasViewPrice = hasPermission(req.user.role, 'asset.view_price');
    const isPostgres = process.env.DB_CLIENT === 'postgresql';

    console.log(`[PO SEARCH] Query: "${search}"`);
    
    let query = db('project_orders as po')
      .leftJoin('projects as p', isPostgres ? 'po.projectid' : 'po.ProjectID', isPostgres ? 'p.id' : 'p.ID')
      .where(function() {
        const col = isPostgres ? 'po.is_deleted' : 'po.is_deleted'; // same in both
        this.where(col, 0).orWhereNull(col);
      });
    
    // 1. Apply RBAC Segregation
    if (!isAdmin) {
        if (userProjectId) {
            query.where(isPostgres ? 'po.projectid' : 'po.ProjectID', userProjectId);
        } else if (userDept) {
            query.where(function() {
                const locCol = isPostgres ? 'p.location' : 'p.Location';
                this.where(locCol, userDept).orWhereNull(locCol).orWhere(locCol, '');
            });
        }
    }

    // 2. Apply Search
    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query.where(function() {
        if (isPostgres) {
            this.where('po.ponumber', 'ilike', term)
              .orWhere('po.vendorname', 'ilike', term)
              .orWhere('po.id', 'ilike', term)
              .orWhere('po.orderno', 'ilike', term)
              .orWhere('po.consigneename', 'ilike', term)
              .orWhere('po.buyername', 'ilike', term);
        } else {
            this.where('po.PONumber', 'like', term)
              .orWhere('po.VendorName', 'like', term)
              .orWhere('po.ID', 'like', term)
              .orWhere('po.OrderNo', 'like', term)
              .orWhere('po.ConsigneeName', 'like', term)
              .orWhere('po.BuyerName', 'like', term);
        }
      });
    }
    
    const rows = await query.select('po.*').orderBy(isPostgres ? 'po.timestamp' : 'po.Timestamp', 'desc').limit(100);
    const normalizedRows = normalizeResult(rows);
    
    // 3. Apply Price Redaction
    const processedRows = normalizedRows.map(order => {
        if (!hasViewPrice) {
            delete order.TotalAmount;
        }
        return order;
    });

    console.log(`[PO SEARCH] Found ${processedRows.length} results for "${search}"`);
    res.json({ success: true, orders: processedRows });
  } catch (err) {
    console.error('[PO SEARCH] Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/orders/:orderId', authenticateJWT, async (req, res) => {
    try {
        const { orderId } = req.params;
        const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
        const userDept = req.user.department;
        const userProjectId = req.user.projectId;
        const hasViewPrice = hasPermission(req.user.role, 'asset.view_price');
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        console.log(`[PO GET] Fetching order: ${orderId}`);
        
        const orderQuery = db('project_orders as po')
          .leftJoin('projects as p', isPostgres ? 'po.projectid' : 'po.ProjectID', isPostgres ? 'p.id' : 'p.ID')
          .select('po.*');
          
        if (isPostgres) {
            orderQuery.select('p.location as projectlocation')
              .where(function() {
                this.where('po.id', orderId).orWhere('po.ponumber', orderId);
              });
        } else {
            orderQuery.select('p.Location as ProjectLocation')
              .where(function() {
                this.where('po.ID', orderId).orWhere('po.PONumber', orderId);
              });
        }

        let order = await orderQuery.first();
        if (!order) return res.status(404).json({ error: 'Order not found' });
        
        order = normalizeResult(order);

        // RBAC: Segregation Check
        if (!isAdmin) {
            if (userProjectId && order.ProjectID !== userProjectId) {
                return res.status(403).json({ error: 'Forbidden: You do not have access to this project order.' });
            }
            if (userDept && order.ProjectLocation && order.ProjectLocation !== userDept) {
                return res.status(403).json({ error: 'Forbidden: You do not have access to orders from this department/location.' });
            }
        }

        const items = isPostgres 
            ? await db('project_order_items').where('orderid', order.ID).orderBy('srno', 'asc')
            : await db('project_order_items').where('OrderID', order.ID).orderBy('SrNo', 'asc');
        
        const normalizedItems = normalizeResult(items);

        // Calculate fulfillment and Apply Price Redaction
        const processedItems = await Promise.all(normalizedItems.map(async (item) => {
            const itemId = item.ID || item.id;
            let permanentFulfilled, temporaryFulfilled;
            
            if (isPostgres) {
                const permResult = await db('assets').where('linked_po_item_id', itemId).count('* as count').first();
                permanentFulfilled = permResult ? permResult.count : 0;
                
                const tempResult = await db('temporary_assets').where('linked_po_item_id', itemId).count('* as count').first();
                temporaryFulfilled = tempResult ? tempResult.count : 0;
            } else {
                permanentFulfilled = legacyDb.prepare('SELECT count(*) as count FROM assets WHERE linked_po_item_id = ?').get(itemId).count;
                temporaryFulfilled = legacyDb.prepare('SELECT count(*) as count FROM temporary_assets WHERE linked_po_item_id = ?').get(itemId).count;
            }
            
            const processed = { ...item, fulfilledQty: (Number(permanentFulfilled) + Number(temporaryFulfilled)) };
            if (!hasViewPrice) {
                delete processed.UnitPrice;
                delete processed.Total;
            }
            return processed;
        }));
        
        if (!hasViewPrice) {
            delete order.TotalAmount;
        }
        
        const finalOrder = { ...order, items: processedItems };
        res.json({ success: true, orders: [finalOrder], data: [finalOrder], ...finalOrder });
    } catch (err) {
        console.error(`[PO GET] Error:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/orders', authenticateJWT, async (req, res) => {
    try {
        const admin = await requireAdmin(req);
        if (!admin) return res.status(403).json({ error: 'Forbidden: Admin access required' });
        
        const { id } = req.params;
        console.log(`[PO] Creating order for project: ${id}`);
        const { 
            PONumber, PODate, VendorName, TotalAmount, Status, items,
            ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
            BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
        } = req.body;

        const orderId = `PO-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const ts = new Date().toISOString();
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        await db.transaction(async (trx) => {
            console.log(`[PO] Inserting header: ${orderId}`);
            const header = {
                id: orderId, 
                projectid: id, 
                ponumber: PONumber || null, 
                podate: PODate || null, 
                vendorname: VendorName || null, 
                totalamount: TotalAmount || 0, 
                status: Status || 'Active', 
                consigneename: ConsigneeName || null, 
                consigneeaddress: ConsigneeAddress || null, 
                consigneegstin: ConsigneeGSTIN || null, 
                consigneestate: ConsigneeState || null, 
                consigneestatecode: ConsigneeStateCode || null,
                buyername: BuyerName || null, 
                buyeraddress: BuyerAddress || null, 
                buyergstin: BuyerGSTIN || null, 
                buyerstate: BuyerState || null, 
                buyerstatecode: BuyerStateCode || null,
                timestamp: ts
            };

            if (!isPostgres) {
                // Handle SQLite if needed
            }

            await trx('project_orders').insert(header);

            if (items && Array.isArray(items)) {
                console.log(`[PO] Inserting ${items.length} items`);
                for (const [index, item] of items.entries()) {
                    const line = {
                        orderid: orderId, 
                        srno: item.SrNo || (index + 1), 
                        itemdescription: item.ItemDescription || '', 
                        duedate: item.DueDate || null, 
                        qtyordered: item.QtyOrdered || 0, 
                        uom: item.UOM || 'Nos', 
                        unitprice: item.UnitPrice || 0, 
                        total: item.Total || 0, 
                        assetid: item.AssetID || null, 
                        status: item.Status || 'Pending',
                        timestamp: ts
                    };
                    await trx('project_order_items').insert(line);
                }
            }
        });

        console.log(`[PO] Success: ${orderId}`);
        res.json({ success: true, id: orderId });
    } catch (err) {
        console.error('[PO] Failed to create project order:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/orders/:orderId', authenticateJWT, async (req, res) => {
    try {
        const { orderId } = req.params;
        const { 
            PONumber, PODate, VendorName, TotalAmount, Status, items,
            ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
            BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
        } = req.body;
        
        console.log(`[DEBUG PO] Updating order: ${orderId}`);
        const ts = new Date().toISOString();
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        const runTransaction = async (trx) => {
            // 1. Update Header
            const orderUpdate = {
                PONumber: PONumber || null, 
                PODate: PODate || null, 
                VendorName: VendorName || null, 
                TotalAmount: TotalAmount || 0, 
                Status: Status || 'Active',
                ConsigneeName: ConsigneeName || null, 
                ConsigneeAddress: ConsigneeAddress || null, 
                ConsigneeGSTIN: ConsigneeGSTIN || null, 
                ConsigneeState: ConsigneeState || null, 
                ConsigneeStateCode: ConsigneeStateCode || null,
                BuyerName: BuyerName || null, 
                BuyerAddress: BuyerAddress || null, 
                BuyerGSTIN: BuyerGSTIN || null, 
                BuyerState: BuyerState || null, 
                BuyerStateCode: BuyerStateCode || null
            };

            await trx('project_orders')
                .where(isPostgres ? 'id' : 'ID', orderId)
                .update(isPostgres ? normalizeDBData(orderUpdate) : orderUpdate);

            if (items && Array.isArray(items)) {
                // 2. Fetch existing item IDs
                const existingItems = await trx('project_order_items')
                    .where(isPostgres ? 'orderid' : 'OrderID', orderId)
                    .select(isPostgres ? 'id as ID' : 'ID');
                const existingIds = existingItems.map(i => i.ID);
                const incomingIds = items.map(i => i.ID || i.id).filter(id => id);

                // 3. Delete items that are no longer in the list
                const toDelete = existingIds.filter(id => !incomingIds.includes(id));
                if (toDelete.length > 0) {
                    await trx('project_order_items').whereIn(isPostgres ? 'id' : 'ID', toDelete).delete();
                    await trx('assets').whereIn(isPostgres ? 'linked_po_item_id' : 'linked_po_item_id', toDelete).update({ linked_po_item_id: null });
                    await trx('temporary_assets').whereIn(isPostgres ? 'linked_po_item_id' : 'linked_po_item_id', toDelete).update({ linked_po_item_id: null });
                }

                // 4. Update or Insert items
                for (const [index, item] of items.entries()) {
                    let receivedStatus = item.Status || item.status || 'Pending';
                    if (receivedStatus.toLowerCase().includes('ship')) receivedStatus = 'Shipped';
                    else receivedStatus = 'Pending';

                    const itemId = item.ID || item.id;
                    const itemData = {
                        SrNo: item.SrNo || (index + 1), 
                        ItemDescription: item.ItemDescription || '', 
                        DueDate: item.DueDate || null, 
                        QtyOrdered: item.QtyOrdered || 0, 
                        UOM: item.UOM || 'Nos', 
                        UnitPrice: item.UnitPrice || 0, 
                        Total: item.Total || 0, 
                        AssetID: item.AssetID || item.assetid || null, 
                        Status: receivedStatus
                    };

                    if (itemId && existingIds.includes(itemId)) {
                        // Update existing
                        await trx('project_order_items')
                            .where(isPostgres ? 'id' : 'ID', itemId)
                            .update(isPostgres ? normalizeDBData(itemData) : itemData);
                    } else {
                        // Insert new
                        const insertData = {
                            OrderID: orderId,
                            ...itemData,
                            Timestamp: ts
                        };
                        await trx('project_order_items').insert(isPostgres ? normalizeDBData(insertData) : insertData);
                    }
                }
            }
        };

        if (isPostgres) {
            await db.transaction(runTransaction);
        } else {
            await legacyDb.transaction(runTransaction);
        }

        res.json({ success: true });
    } catch (err) {
        console.error(`[DEBUG PO] Update failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:projectId/orders/:orderId', authenticateJWT, async (req, res) => {
    try {
        const { projectId, orderId } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        const runDeleteTransaction = async (trx) => {
            await trx('project_order_items').where(isPostgres ? 'orderid' : 'OrderID', orderId).delete();
            await trx('project_orders').where(isPostgres ? 'id' : 'ID', orderId).andWhere(isPostgres ? 'projectid' : 'ProjectID', projectId).delete();
        };

        if (isPostgres) {
            await db.transaction(runDeleteTransaction);
        } else {
            await legacyDb.transaction(runDeleteTransaction);
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/projects/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Allow dynamic updates for projects
        const allowedFields = [
            'ProjectName', 'ClientName', 'Status', 'Description', 'StartDate', 'EndDate', 'Location', 'Currency', 
            'OwnerEmail', 'CoordinatorEmail',
            'ConsigneeName', 'ConsigneeAddress', 'ConsigneeGSTIN', 'ConsigneeState', 'ConsigneeStateCode',
            'BuyerName', 'BuyerAddress', 'BuyerGSTIN', 'BuyerState', 'BuyerStateCode', 'Initials'
        ];
        
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        const updateObj = {};
        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                let dbKey = key;
                if (isPostgres) {
                    dbKey = key.toLowerCase();
                }
                updateObj[dbKey] = updates[key];
            } else if (key === 'status' && !updates.Status) {
                let dbKey = isPostgres ? 'status' : 'Status';
                updateObj[dbKey] = updates[key];
            }
        });
        
        if (Object.keys(updateObj).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const idField = isPostgres ? 'id' : 'ID';
        const statusField = isPostgres ? 'status' : 'Status';

        const existing = await db('projects').where(idField, id).select(statusField).first();
        if (!existing) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await db('projects').where(idField, id).update(updateObj);

        // Record status change in history if applicable
        const currentStatus = updateObj[statusField];
        const oldStatus = existing[statusField] || existing.Status;

        if (currentStatus && currentStatus !== oldStatus) {
            const hasHistoryTable = await db.schema.hasTable('project_history');
            if (hasHistoryTable) {
                const historyRecord = {
                    projectid: id, 
                    status: currentStatus, 
                    note: `Status changed from ${oldStatus || 'Unknown'} to ${currentStatus}`, 
                    timestamp: new Date().toISOString()
                };
                if (isPostgres) {
                    await db('project_history').insert(historyRecord);
                } else {
                    await db('project_history').insert({
                        ProjectID: historyRecord.projectid,
                        Status: historyRecord.status,
                        Note: historyRecord.note,
                        Timestamp: historyRecord.timestamp
                    });
                }
            }
        }

        // Regenerate QR code if name, client, location, status, or contact info changed
        const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
        const updateKeys = Object.keys(updates);
        if (updateKeys.some(f => relevantFields.includes(f))) {
            try {
                const project = await db('projects').where(isPostgres ? 'id' : 'ID', id).first();
                if (project) {
                    const ip = getLocalIP();
                    const port = process.env.PORT || 9090;
                    const qrPayload = generateProjectQRPayload({
                        ID: project.id || project.ID,
                        Name: project.projectname || project.ProjectName,
                        Client: project.clientname || project.ClientName,
                        Status: project.status || project.Status,
                        Location: project.location || project.Location,
                        Description: project.description || project.Description,
                        StartDate: project.startdate || project.StartDate,
                        EndDate: project.enddate || project.EndDate,
                        OwnerEmail: project.owneremail || project.OwnerEmail,
                        CoordinatorEmail: project.coordinatoremail || project.CoordinatorEmail
                    }, ip, port);
                    const qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });
                    await db('projects').where(isPostgres ? 'id' : 'ID', id).update(isPostgres ? { qrcode: qrCode } : { QRCode: qrCode });
                }
            } catch (qrErr) {
                console.error('Failed to regenerate project QR code:', qrErr);
            }
        }

        await appendAudit({ 
            Action: 'UPDATE_PROJECT', 
            User: req.headers['x-user'] || 'web', 
            AssetId: id, 
            Severity: 'INFO', 
            Details: `Project updated: ${Object.keys(updateObj).join(', ')}` 
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update project:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/companies', async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let companies;
        if (isPostgres) {
            // In Postgres, we use the companies table directly or company_templates
            const tableExists = await db.schema.hasTable('company_templates');
            if (!tableExists) return res.json([]);
            
            companies = await db('company_templates')
                .select('company_name as name', 'address', 'gst as gstin', 'state_name as state', 'state_code as stateCode')
                .orderBy('company_name', 'asc');
            // No normalization needed as we manually alias
        } else {
            const tableExists = legacyDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='company_templates'").get();
            if (!tableExists) return res.json([]);

            companies = legacyDb.prepare(`
                SELECT 
                    company_name as name, 
                    address, 
                    gst as gstin, 
                    state_name as state, 
                    state_code as stateCode 
                FROM company_templates 
                ORDER BY company_name ASC
            `).all();
        }
        res.json(companies);
    } catch (err) {
        console.error('Error fetching companies:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/assets', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        console.log(`Fetching assets for project: ${id}`);
        
        let assets;
        if (isPostgres) {
            // Postgres version with normalization
            const permanent = await db('assets as a')
                .join('project_assets as pa', 'a.id', 'pa.assetid')
                .where('pa.projectid', id)
                .select(
                  'a.id', 'a.itemname', 'a.status', 'a.make', 'a.model', 'a.type', 'a.category', 'a.icon', 'a.currency',
                  'pa.type as assignmenttype', 'pa.assigneddate as assigneddate'
                )
                .select(db.raw('0 as estimatedprice'))
                .select(db.raw('EXISTS (SELECT 1 FROM components c WHERE c.id = a.id) as iscomponent'));

            const temporary = await db('temporary_assets as ta')
                .where('ta.projectid', id)
                .andWhere('ta.ispermanent', 0)
                .select(
                  'ta.id', 'ta.itemname', 'ta.status', 'ta.make', 'ta.model', 'ta.type', 'ta.category', 'ta.currency',
                  'ta.timestamp as assigneddate', 'ta.estimatedprice'
                )
                .select(db.raw("\'🧩\' as icon"))
                .select(db.raw("\'Temporary\' as assignmenttype"))
                .select(db.raw('0 as iscomponent'));

            assets = [...permanent, ...temporary];
            assets = normalizeResult(assets);
        } else {
            assets = legacyDb.prepare(`
                SELECT 
                    a.ID, a.ItemName, a.Status, a.Make, a.Model, a.Type, a.Category, a.Icon,
                    pa.Type as AssignmentType, pa.AssignedDate, 0 as EstimatedPrice, a.Currency,
                    EXISTS (SELECT 1 FROM components c WHERE c.ID = a.ID) as isComponent
                FROM assets a
                JOIN project_assets pa ON a.ID = pa.AssetID
                WHERE pa.ProjectID = ?
                UNION ALL
                SELECT 
                    ta.ID, ta.ItemName, ta.Status, ta.Make, ta.Model, ta.Type, ta.Category, '🧩' as Icon,
                    'Temporary' as AssignmentType, ta.Timestamp as AssignedDate, ta.EstimatedPrice, ta.Currency,
                    0 as isComponent
                FROM temporary_assets ta
                WHERE ta.ProjectId = ? AND ta.IsPermanent = 0
            `).all(id, id);
        }
        console.log(`Found ${assets.length} assets for project ${id}`);
        res.json(assets);
    } catch (err) {
        console.error('Error fetching project assets:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/assign-asset', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { AssetID, Type } = req.body;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        // Validation logic for project assignment
        const status = await getAssetAssignmentStatus(AssetID);
        if (status) {
            if (status.type === 'user') {
                return res.status(400).json({ 
                    error: `Asset is already assigned to user "${status.assignedTo}". Unassign it first.` 
                });
            }
            if (status.type === 'project' && status.projectId !== id) {
                return res.status(400).json({ 
                    error: `Asset is already part of project "${status.projectName}" (${status.status}).` 
                });
            }
        }

        const project = await db('projects').where(isPostgres ? 'id' : 'ID', id).select(isPostgres ? 'projectname' : 'ProjectName', isPostgres ? 'initials' : 'Initials').first();
        const projectName = project ? (project.projectname || project.ProjectName) : id;
        const projectInitials = project ? (project.initials || project.Initials || 'NA') : 'NA';
        
        await db.transaction(async (trx) => {
            // Generate Client Label: (AssetKind)-(ProjectInitials)-(6DigitCodeFromAssetID)
            // AssetID format: TYPE-LOC-MMYY-RAND6-EXTRA -> parts[0] is kind, parts[3] is 6-digit code
            const assetParts = AssetID.split('-');
            const assetKind = assetParts[0] || 'AST';
            const sixDigitCode = assetParts[3] || '000000';
            const clientLabel = `${assetKind}-${projectInitials}-${sixDigitCode}`;

            if (isPostgres) {
                await trx('project_assets').insert({
                    projectid: id, 
                    assetid: AssetID, 
                    assigneddate: new Date().toISOString(), 
                    type: Type || 'Permanent'
                }).onConflict(['projectid', 'assetid']).merge();
                
                await trx('assets')
                    .where('id', AssetID)
                    .update({ 
                        assignedto: `Project: ${projectName}`, 
                        status: 'In-Use', 
                        currentlocation: 'On Site',
                        client_label: clientLabel
                    });
            } else {
                await trx('project_assets').insert({
                    ProjectID: id, 
                    AssetID: AssetID, 
                    AssignedDate: new Date().toISOString(), 
                    Type: Type || 'Permanent'
                }).onConflict(['ProjectID', 'AssetID']).merge();
                
                await trx('assets')
                    .where('ID', AssetID)
                    .update({ 
                        AssignedTo: `Project: ${projectName}`, 
                        Status: 'In-Use', 
                        CurrentLocation: 'On Site',
                        client_label: clientLabel
                    });
            }

            // --- Log Asset History ---
            await logAssetHistory(AssetID, 'PROJECT_CHANGE', 'General Stock', `Project: ${projectName}`, req.user.username || 'web', `Assigned to project manually`);
            await logAssetHistory(AssetID, 'STATUS_CHANGE', 'In Store', 'In-Use', req.user.username || 'web', `Status updated via project assignment`);
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Assign asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id/unassign-asset/:assetId', authenticateJWT, async (req, res) => {
    try {
        const { id, assetId } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';

        await db.transaction(async (trx) => {
            // 1. Check if it's a permanent asset
            const projectAsset = await trx('project_assets')
                .where(isPostgres ? 'projectid' : 'ProjectID', id)
                .andWhere(isPostgres ? 'assetid' : 'AssetID', assetId)
                .first();
            
            if (projectAsset) {
                // Remove from project_assets
                await trx('project_assets')
                    .where(isPostgres ? 'projectid' : 'ProjectID', id)
                    .andWhere(isPostgres ? 'assetid' : 'AssetID', assetId)
                    .delete();
                
                // Revert to Location-based label: (Kind)-(Location)-(6DigitCode)
                const assetParts = assetId.split('-');
                const assetKind = assetParts[0] || 'AST';
                const locCode = assetParts[1] || 'LOC';
                const sixDigitCode = assetParts[3] || '000000';
                const revertedLabel = `${assetKind}-${locCode}-${sixDigitCode}`;

                // Reset permanent asset status
                if (isPostgres) {
                    await trx('assets') 
                        .where('id', assetId)
                        .update({ 
                            assignedto: null, 
                            status: 'In Store', 
                            currentlocation: 'Warehouse', 
                            linked_po_item_id: null,
                            client_label: revertedLabel
                        });
                } else {
                    await trx('assets') 
                        .where('ID', assetId)
                        .update({ 
                            AssignedTo: null, 
                            Status: 'In Store', 
                            CurrentLocation: 'Warehouse', 
                            linked_po_item_id: null,
                            client_label: revertedLabel
                        });
                }
            } else {
                // 2. Check if it's a temporary asset
                const tempAsset = await trx('temporary_assets')
                    .where(isPostgres ? 'id' : 'ID', assetId)
                    .andWhere(isPostgres ? 'projectid' : 'ProjectId', id)
                    .first();
                if (tempAsset) {
                    // Delete temporary asset entirely
                    await trx('temporary_assets')
                        .where(isPostgres ? 'id' : 'ID', assetId)
                        .andWhere(isPostgres ? 'projectid' : 'ProjectId', id)
                        .delete();
                }
            }
        });
        res.json({ success: true });
    } catch (err) {
        console.error('Unassign asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/create-user', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, fullname } = req.body;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        const project = isPostgres 
            ? await db('projects').where('id', id).first()
            : await db('projects').where('ID', id).first();

        if (!project) return res.status(404).send('Project not found');

        const companyId = project.company_id || project.CompanyID || DEFAULT_COMPANY_ID;
        
        await db('users').insert({
            username, 
            password, 
            fullname: fullname || (project.clientname || project.ClientName), 
            role: 'client', 
            project_id: id, 
            client_id: project.id || project.ID,
            company_id: companyId
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Create project user error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        const assets = isPostgres
            ? await db('temporary_assets').where('projectid', id).andWhere('ispermanent', 0)
            : await db('temporary_assets').where('ProjectId', id).andWhere('IsPermanent', 0);
            
        res.json(normalizeResult(assets));
    } catch (err) {
        console.error('Fetch temporary assets error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { itemName, make, model, estimatedPrice, type, category, quantity, currency } = req.body;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        // Fetch project location for ID generation
        const project = isPostgres
            ? await db('projects').where('id', id).select('location').first()
            : await db('projects').where('ID', id).select('Location').first();
            
        const location = project ? (project.location || project.Location) : 'MUMBAI';
        
        const assetId = generateTempAssetId(location);
        const record = {
            id: assetId, 
            itemname: itemName, 
            type: type || '', 
            category: category || '', 
            make: make || '', 
            model: model || '', 
            estimatedprice: estimatedPrice || 0, 
            projectid: id, 
            timestamp: new Date().toISOString(), 
            currency: currency || 'INR'
        };

        if (isPostgres) {
            await db('temporary_assets').insert(normalizeDBData(record));
        } else {
            await db('temporary_assets').insert(record);
        }
        res.json({ success: true, id: assetId });
    } catch (err) {
        console.error('Create temporary asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        let assets;
        if (isPostgres) {
            assets = await db('temporary_assets').where('ispermanent', 0).orderBy('timestamp', 'desc');
            assets = normalizeResult(assets);
        } else {
            assets = legacyDb.prepare('SELECT * FROM temporary_assets WHERE IsPermanent = 0 ORDER BY Timestamp DESC').all();
        }
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const { ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Currency } = req.body;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        let location = 'MUMBAI';
        if (ProjectId) {
            let project;
            if (isPostgres) {
                project = await db('projects').where('id', ProjectId).select('location').first();
            } else {
                project = legacyDb.prepare('SELECT Location FROM projects WHERE ID = ?').get(ProjectId);
            }
            location = project ? (project.location || project.Location) : 'MUMBAI';
        }
        
        const id = generateTempAssetId(location);
        const record = {
            id,
            itemname: ItemName,
            type: Type || '',
            category: Category || '',
            make: Make || '',
            model: Model || '',
            estimatedprice: EstimatedPrice || 0,
            quantity: Quantity || 1,
            projectid: ProjectId || null,
            timestamp: new Date().toISOString(),
            currency: Currency || 'USD'
        };

        if (isPostgres) {
            await db('temporary_assets').insert(normalizeDBData(record));
        } else {
            const stmt = legacyDb.prepare(`
                INSERT INTO temporary_assets (ID, ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Timestamp, Currency)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(id, ItemName, Type || '', Category || '', Make || '', Model || '', EstimatedPrice || 0, Quantity || 1, ProjectId, record.timestamp, Currency || 'USD');
        }
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets/:id/make-permanent', async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        let tempAsset;
        if (isPostgres) {
            tempAsset = await db('temporary_assets').where('id', id).first();
            tempAsset = normalizeResult(tempAsset);
        } else {
            tempAsset = legacyDb.prepare('SELECT * FROM temporary_assets WHERE ID = ?').get(id);
        }

        if (!tempAsset) return res.status(404).send('Temporary asset not found');

        // Get project location for ID generation
        let project;
        if (isPostgres) {
            project = await db('projects').where('id', tempAsset.ProjectID).select('location').first();
        } else {
            project = legacyDb.prepare('SELECT Location FROM projects WHERE ID = ?').get(tempAsset.ProjectId);
        }
        const location = project ? (project.location || project.Location) : 'MUMBAI';

        // Create permanent asset using modern ID generation
        const newAssetId = generateModernAssetId(location);
        
        const ip = getLocalIP();
        const port = process.env.PORT || 9090;
        const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newAssetId)}`;
        const qrCode = await qrcode.toDataURL(urlText, { width: 512 });

        await db.transaction(async (trx) => {
            // 1. Insert into assets
            if (isPostgres) {
                await trx('assets').insert({
                    id: newAssetId, 
                    no: newAssetId, 
                    itemname: tempAsset.ItemName || 'Unnamed Asset', 
                    status: 'In Store', 
                    make: tempAsset.Make || '', 
                    model: tempAsset.Model || '', 
                    type: tempAsset.Type || 'AST', 
                    category: tempAsset.Category || 'General', 
                    icon: '🧩', 
                    isplaceholder: 0, 
                    lastupdated: new Date().toISOString(), 
                    qrcode: qrCode, 
                    noqr: 0, 
                    currentlocation: location, 
                    asset_value: tempAsset.EstimatedPrice || 0, 
                    currency: tempAsset.Currency || 'INR'
                });

                // 2. Link to project
                await trx('project_assets').insert({
                    projectid: tempAsset.ProjectID, 
                    assetid: newAssetId, 
                    assigneddate: new Date().toISOString(), 
                    type: 'Permanent'
                });

                // 3. Mark temporary as permanent
                await trx('temporary_assets')
                    .where('id', id)
                    .update({ ispermanent: 1 });
            } else {
                // Legacy SQLite fallback if needed
            }

            // 4. Audit Log
            await appendAudit({ 
                Action: 'CONVERT_TEMP', 
                User: req.headers['x-user'] || 'web', 
                AssetId: newAssetId, 
                Severity: 'INFO', 
                Details: `Converted temporary asset "${tempAsset.ItemName}" to permanent asset. Linked to Project ID: ${tempAsset.ProjectID}` 
            });

            // 5. Asset History
            await logAssetHistory(newAssetId, 'CREATE', 'Temporary', 'Permanent', req.headers['x-user'] || 'web', `Created from temporary asset. Assigned to project ${tempAsset.ProjectID}`);
        });

        res.json({ success: true, permanentId: newAssetId });
    } catch (err) {
        console.error('Error making asset permanent:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/temporary-assets/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date().toISOString();
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        if (isPostgres) {
            await db('temporary_assets').where('id', id).update({ is_deleted: 1, deleted_at: now });
        } else {
            legacyDb.prepare("UPDATE temporary_assets SET is_deleted = 1, deleted_at = ? WHERE ID = ?").run(now, id);
        }
        res.json({ success: true, message: 'Temporary asset marked for deletion' });
    } catch (err) {
        console.error('Error deleting temporary asset:', err);
        res.status(500).json({ error: err.message });
    }
});





app.put('/api/assets/:id', authenticateJWT, async (req, res) => {
  try {
    const id = req.params.id;
    const asset = req.body;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    const hasEditPrice = hasPermission(req.user.role, 'asset.edit_price');
    const userDept = req.user.department;

    console.log(`Updating asset ${id}:`, JSON.stringify(asset));
    
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    
    // Check if asset exists in assets table
    let query = db('assets as a');
    if (isPostgres) {
        query = query
          .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
          .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
          .leftJoin('projects as p', 'pa.projectid', 'p.id')
          .select('a.*', 
                 'it.macaddress as MACAddress', 'it.ipaddress as IPAddress', 'it.networktype as NetworkType', 
                 'it.physicalport as PhysicalPort', 'it.vlan as VLAN', 'it.socketid as SocketID', 'it.userid as UserID',
                 'p.projectname as AssignedProjectName', 'p.id as AssignedProjectID')
          .whereRaw('LOWER(a.id) = LOWER(?)', [id]);
    } else {
        query = query
          .leftJoin('asset_it_details as it', 'a.ID', 'it.AssetID')
          .leftJoin('project_assets as pa', 'a.ID', 'pa.AssetID')
          .leftJoin('projects as p', 'pa.ProjectID', 'p.ID')
          .select('a.*', 
                 'it.MACAddress', 'it.IPAddress', 'it.NetworkType', 'it.PhysicalPort', 'it.VLAN', 'it.SocketID', 'it.UserID',
                 'p.ProjectName as AssignedProjectName', 'p.ID as AssignedProjectID')
          .whereRaw('LOWER(a.ID) = LOWER(?)', [id]);
    }
    
    let existing = await query.first();

    // CRITICAL: Normalize existing.ID if it exists to match the requested id
    // In Postgres it might be lowercase 'id'
    if (existing) {
        if (existing.ID) existing.ID = String(existing.ID).trim();
        else if (existing.id) existing.ID = String(existing.id).trim();
    }

    let isComp = false;
    if (!existing) {
      // Check components table
      existing = await db('components').whereRaw(isPostgres ? 'LOWER(id) = LOWER(?)' : 'LOWER(ID) = LOWER(?)', [id]).first();
      if (existing) {
        isComp = true;
        existing.ID = String(existing.ID || existing.id).trim();
      }
    }

    if (!existing) {
      return res.status(404).send('Asset not found');
    }

    // RBAC: Department check for non-admins
    if (!isAdmin && userDept && existing.Department && existing.Department !== userDept) {
        return res.status(403).send('Forbidden: You can only edit assets in your department.');
    }

    // RBAC: Price check
    if (!hasEditPrice) {
        // Force fields back to existing values if they are present in body
        if (asset.asset_value !== undefined) asset.asset_value = existing.asset_value;
        if (asset.UnitPrice !== undefined) asset.UnitPrice = existing.UnitPrice;
        if (asset.Currency !== undefined) asset.Currency = existing.Currency;
    }

    if (isComp) {
      // Update component in components table
      await db('components')
        .where('id', id)
        .update(normalizeDBData({
          ItemName: asset.ItemName || existing.ItemName || '',
          Make: asset.Make || existing.Make || '',
          Model: asset.Model || existing.Model || '',
          SrNo: asset.SrNo || existing.SrNo || '',
          Status: asset.Status || existing.Status || 'In Store',
          Type: asset.Type || existing.Type || 'Component',
          Category: asset.Category || existing.Category || '',
          LastUpdated: new Date().toISOString()
        }));

      appendAudit({ 
        Action: 'UPDATE_COMPONENT', 
        User: req.headers['x-user'] || 'web', 
        AssetId: id, 
        Severity: 'INFO', 
        Details: `Component updated: ${asset.ItemName || existing.ItemName}` 
      });

      return res.json({ success: true });
    }

    const hasQuantityMutation =
      asset &&
      (Object.keys(asset).some((k) => String(k).startsWith('quantity_')) ||
        asset.is_quantity_tracked !== undefined ||
        asset.quantityUnit !== undefined ||
        asset.quantityTotal !== undefined ||
        asset.quantityAvailable !== undefined ||
        asset.qtyUnit !== undefined ||
        asset.qtyTotal !== undefined ||
        asset.qtyAvailable !== undefined)
    
    // Allow quantity initialization if it doesn't exist yet
    const isInitializingQuantity = hasQuantityMutation && (!existing.quantity_root_id || String(existing.quantity_root_id).trim() === '');

    if (hasQuantityMutation && !isInitializingQuantity) {
      // Allow updating quantity fields if it's the root asset
      const rootId = String(existing.quantity_root_id || '').trim().toLowerCase();
      const currentId = String(id).trim().toLowerCase();
      const isRootAsset = rootId !== '' && rootId === currentId;
      
      const isRedundantUpdate = 
        (asset.quantity_unit === undefined || String(asset.quantity_unit || '').trim().toLowerCase() === String(existing.quantity_unit || '').trim().toLowerCase()) &&
        (asset.quantity_precision === undefined || Number(asset.quantity_precision || 0) === Number(existing.quantity_precision || 0)) &&
        (asset.quantity_total === undefined || Number(asset.quantity_total || 0) === Number(existing.quantity_total || 0));
      
      if (!isRootAsset && !isRedundantUpdate) {
        console.warn(`Quantity update rejected for ${id}. Not root asset and not redundant. Root ID: ${existing.quantity_root_id}`);
        return res.status(400).send(`Quantity fields cannot be updated via /api/assets. Use /api/quantity/* endpoints for adjustments, or update the root asset (${existing.quantity_root_id}) directly.`)
      }
    }

    // Calculate delta for quantity_available if quantity_total is changed on a root asset
    let qtyAvailableDelta = 0;
    if (asset.quantity_total !== undefined && existing.quantity_total !== null && existing.quantity_total !== undefined) {
      const newTotal = Number(asset.quantity_total || 0);
      const oldTotal = Number(existing.quantity_total || 0);
      qtyAvailableDelta = newTotal - oldTotal;
      console.log(`Qty update for root ${id}: total ${oldTotal} -> ${newTotal}, delta ${qtyAvailableDelta}`);
    }

    let updateObj = {
        ItemName: asset.ItemName || existing.ItemName || '',
        Status: asset.Status || existing.Status || 'In Store',
        Make: asset.Make || existing.Make || '',
        Model: asset.Model || existing.Model || '',
        SrNo: encryptionService.encryptDeterministic(asset.SrNo !== undefined ? asset.SrNo : (existing.SrNo || '')),
        Type: asset.Type || existing.Type || '',
        Category: asset.Category || existing.Category || '',
        Icon: asset.Icon || existing.Icon || '',
        ParentId: asset.ParentId !== undefined ? asset.ParentId : (existing.ParentId || null),
        CurrentLocation: asset.CurrentLocation || existing.CurrentLocation || '',
        DispatchReceiveDt: asset.DispatchReceiveDt || existing.DispatchReceiveDt || '',
        PurchaseDetails: asset.PurchaseDetails || existing.PurchaseDetails || '',
        Remarks: asset.Remarks || existing.Remarks || '',
        LastUpdated: new Date().toISOString(),
        AssignedTo: asset.AssignedTo !== undefined ? asset.AssignedTo : (existing.AssignedTo || ''),
        NoQR: asset.NoQR !== undefined ? (asset.NoQR ? 1 : 0) : (existing.NoQR || 0),
        warranty_months: asset.warranty_months !== undefined ? asset.warranty_months : (existing.warranty_months || 0),
        amc_months: asset.amc_months !== undefined ? asset.amc_months : (existing.amc_months || 0),
        asset_value: asset.asset_value !== undefined ? asset.asset_value : (existing.asset_value || 0),
        Currency: asset.Currency !== undefined ? asset.Currency : (existing.Currency || 'INR'),
        PurchaseDate: asset.PurchaseDate !== undefined ? asset.PurchaseDate : (existing.PurchaseDate || null),
        conversion_unit: asset.conversion_unit !== undefined ? asset.conversion_unit : (existing.conversion_unit || null),
        conversion_factor: asset.conversion_factor !== undefined ? asset.conversion_factor : (existing.conversion_factor || null),
        conversion_mode: asset.conversion_mode !== undefined ? asset.conversion_mode : (existing.conversion_mode || 'multiply'),
        quantity_unit: asset.quantity_unit !== undefined ? asset.quantity_unit : (existing.quantity_unit || null),
        quantity_total: asset.quantity_total !== undefined ? asset.quantity_total : (existing.quantity_total || 0),
        quantity_precision: asset.quantity_precision !== undefined ? asset.quantity_precision : (existing.quantity_precision || 0),
        quantity_available: db.raw('COALESCE(quantity_available, 0) + ?', [qtyAvailableDelta]),
        is_quantity_tracked: asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : (existing.is_quantity_tracked || 0),
        is_batch: asset.is_batch !== undefined ? (asset.is_batch ? 1 : 0) : (existing.is_batch || 0)
    };

    if (isPostgres) {
        await db('assets')
            .whereRaw('LOWER(id) = LOWER(?)', [id])
            .update(normalizeDBData(updateObj));
    } else {
        await db('assets')
            .whereRaw('LOWER(ID) = LOWER(?)', [id])
            .update(updateObj);
    }

    appendAudit({
      Action: 'UPDATE',
      User: req.headers['x-user'] || 'web',
      AssetId: id,
      Severity: 'INFO',
      Details: `Asset updated: ${asset.ItemName || existing.ItemName}`
    });

    // --- TRACK ALL CHANGES FOR HISTORY ---
    const currentUser = req.headers['x-user'] || 'web';
    const trackedFields = [
        { field: 'AssignedTo', action: 'ASSIGNMENT_CHANGE', label: 'Personnel' },
        { field: 'Status', action: 'STATUS_CHANGE', label: 'Status' },
        { field: 'CurrentLocation', action: 'LOCATION_CHANGE', label: 'Location' },
        { field: 'AssignedProjectID', action: 'PROJECT_CHANGE', label: 'Project' }
    ];

    trackedFields.forEach(({ field, action, label }) => {
        let newVal;
        if (field === 'AssignedProjectID') {
            newVal = asset.ProjectId || asset.ProjectID || asset.AssignedProjectID;
        } else {
            newVal = asset[field];
        }

        const oldVal = existing[field];
        
        // Only log if the field was actually sent in the request AND it's different from current
        if (newVal !== undefined && String(newVal || '').trim() !== String(oldVal || '').trim()) {
            console.log(`[HISTORY] ${label} change detected for ${id}: "${oldVal}" -> "${newVal}"`);
            logAssetHistory(id, action, oldVal || 'None', newVal || 'None', currentUser, `${label} updated`);
        }
    });

    // Propagate quantity_unit change to all descendants if this is the root asset
    const newQtyUnit = asset.quantity_unit !== undefined ? asset.quantity_unit : existing.quantity_unit;
    const rootIdForProp = String(existing.quantity_root_id || '').trim().toLowerCase();
    const currentIdForProp = String(id).trim().toLowerCase();
    const isRootAssetForProp = rootIdForProp !== '' && rootIdForProp === currentIdForProp;
    
    if (isRootAssetForProp && newQtyUnit && newQtyUnit !== existing.quantity_unit) {
      console.log(`Propagating quantity_unit change from "${existing.quantity_unit}" to "${newQtyUnit}" for root ${id}`);
      await db('assets')
        .whereRaw('LOWER(quantity_root_id) = LOWER(?)', [existing.quantity_root_id])
        .update({
          quantity_unit: newQtyUnit,
          quantity_updated_at: new Date().toISOString()
        });
      
      // Also update quantity_event_lines to keep history consistent if desired
      await db('quantity_event_lines')
        .whereIn('event_id', function() {
          this.select('id').from('quantity_events').whereRaw('LOWER(root_id) = LOWER(?)', [existing.quantity_root_id]);
        })
        .update({ unit: newQtyUnit });
    }

    // Handle quantity initialization if applicable
    if (isInitializingQuantity) {
      const qtyUnit = normalizeQtyUnit(asset.quantity_unit || asset.quantityUnit || asset.qty_unit || asset.qtyUnit)
      const qtyTotal = parseQtyNumber(asset.quantity_total ?? asset.quantityTotal ?? asset.qty_total ?? asset.qtyTotal)
      const qtyPrecision = parseQtyNumber(asset.quantity_precision ?? asset.quantityPrecision ?? asset.qty_precision ?? asset.qtyPrecision)

      if (qtyUnit && qtyTotal !== null && qtyTotal > 0) {
        await db('assets')
          .where(isPostgres ? 'id' : 'ID', id)
          .update({
            quantity_root_id: id,
            quantity_unit: qtyUnit,
            quantity_total: 0,
            quantity_available: 0,
            quantity_precision: qtyPrecision,
            quantity_updated_at: new Date().toISOString()
          });

        await applyQuantityEvent({
          rootId: id,
          type: 'INIT',
          actor: getRequestActor(req),
          note: asset.quantity_note || asset.quantityNote || null,
          metadata: { source: 'asset_update_init' },
          lines: [
            { assetId: id, unit: qtyUnit, deltaAvailable: qtyTotal, deltaTotal: qtyTotal, precision: qtyPrecision }
          ]
        })
      }
    }

    // Update IT details if provided
    if (asset.MACAddress !== undefined || asset.IPAddress !== undefined || asset.NetworkType !== undefined || asset.PhysicalPort !== undefined || asset.VLAN !== undefined || asset.SocketID !== undefined || asset.UserID !== undefined) {
      // Check for changes to log in audit
      const itChanges = [];
      if (asset.MACAddress !== undefined && asset.MACAddress !== (existing.MACAddress || '')) itChanges.push(`MAC: ${asset.MACAddress}`);
      if (asset.IPAddress !== undefined && asset.IPAddress !== (existing.IPAddress || '')) itChanges.push(`IP: ${asset.IPAddress}`);
      if (asset.NetworkType !== undefined && asset.NetworkType !== (existing.NetworkType || '')) itChanges.push(`Network: ${asset.NetworkType}`);
      
      if (itChanges.length > 0) {
        appendAudit({ 
          Action: 'UPDATE_IT_DETAILS', 
          User: req.headers['x-user'] || 'web', 
          AssetId: id, 
          Severity: 'INFO', 
          Details: `IT details updated: ${itChanges.join(', ')}` 
        });
      }

      const itRecord = {
          AssetID: id,
          MACAddress: encryptionService.encrypt(asset.MACAddress !== undefined ? asset.MACAddress : (existing.MACAddress || '')),
          IPAddress: encryptionService.encryptDeterministic(asset.IPAddress !== undefined ? asset.IPAddress : (existing.IPAddress || '')),
          NetworkType: asset.NetworkType !== undefined ? asset.NetworkType : (existing.NetworkType || ''),
          PhysicalPort: asset.PhysicalPort !== undefined ? asset.PhysicalPort : (existing.PhysicalPort || ''),
          VLAN: asset.VLAN !== undefined ? asset.VLAN : (existing.VLAN || ''),
          SocketID: encryptionService.encrypt(asset.SocketID !== undefined ? asset.SocketID : (existing.SocketID || '')),
          UserID: asset.UserID !== undefined ? asset.UserID : (existing.UserID || '')
      };

      if (isPostgres) {
          await db('asset_it_details')
            .insert(normalizeDBData(itRecord))
            .onConflict('assetid')
            .merge();
      } else {
          await db('asset_it_details')
            .insert(itRecord)
            .onConflict('AssetID')
            .merge();
      }
    }

    // Handle nested components (child assets)
    if (Array.isArray(asset.components)) {
      // Get current NoQR components in components table
      let compQuery = db('components');
      if (isPostgres) {
          compQuery = compQuery.where('parentid', id).andWhere('noqr', 1).select('id as ID');
      } else {
          compQuery = compQuery.where('ParentId', id).andWhere('NoQR', 1).select('ID');
      }
      
      const rows = await compQuery;
      const currentComponents = rows.map(c => c.ID);
      const updatedCompIds = [];

      for (const comp of asset.components) {
        if (comp.ID && currentComponents.includes(comp.ID)) {
          // Update existing component
          const compUpdate = {
              itemname: comp.ItemName || '',
              make: comp.Make || '',
              model: comp.Model || '',
              srno: comp.SrNo || '',
              status: comp.Status || asset.Status || existing.Status || 'In Store',
              type: comp.Type || 'Component',
              category: comp.Category || asset.Category || existing.Category || '',
              lastupdated: new Date().toISOString(),
              noqr: 1
          };

          let updateOp = db('components');
          if (isPostgres) {
              updateOp = updateOp.where('id', comp.ID).andWhere('parentid', id).update(compUpdate);
          } else {
              // Map to PascalCase for SQLite
              const sqliteCompUpdate = {};
              Object.keys(compUpdate).forEach(k => {
                  const pKey = k === 'itemname' ? 'ItemName' : k === 'lastupdated' ? 'LastUpdated' : k === 'noqr' ? 'NoQR' : k.charAt(0).toUpperCase() + k.slice(1);
                  sqliteCompUpdate[pKey] = compUpdate[k];
              });
              updateOp = updateOp.where('ID', comp.ID).andWhere('ParentId', id).update(sqliteCompUpdate);
          }
          await updateOp;
          updatedCompIds.push(comp.ID);
        } else {
          // Insert new component
          const compId = generateModernAssetId(asset.CurrentLocation || existing.CurrentLocation || '');
          const compInsert = {
              id: compId,
              parentid: id,
              itemname: comp.ItemName || '',
              make: comp.Make || '',
              model: comp.Model || '',
              srno: comp.SrNo || '',
              status: comp.Status || asset.Status || existing.Status || 'In Store',
              type: comp.Type || 'Component',
              category: comp.Category || asset.Category || existing.Category || '',
              lastupdated: new Date().toISOString(),
              noqr: 1
          };

          if (isPostgres) {
              await db('components').insert(compInsert);
          } else {
              const sqliteCompInsert = {};
              Object.keys(compInsert).forEach(k => {
                  const pKey = k === 'id' ? 'ID' : k === 'parentid' ? 'ParentId' : k === 'itemname' ? 'ItemName' : k === 'lastupdated' ? 'LastUpdated' : k === 'noqr' ? 'NoQR' : k.charAt(0).toUpperCase() + k.slice(1);
                  sqliteCompInsert[pKey] = compInsert[k];
              });
              await db('components').insert(sqliteCompInsert);
          }
          updatedCompIds.push(compId);
        }
      }

      // Delete orphaned NoQR components
      const orphanedIds = currentComponents.filter(childId => !updatedCompIds.includes(childId));
      if (orphanedIds.length > 0) {
        let deleteOp = db('components');
        if (isPostgres) {
            deleteOp = deleteOp.whereIn('id', orphanedIds).andWhere('parentid', id).delete();
        } else {
            deleteOp = deleteOp.whereIn('ID', orphanedIds).andWhere('ParentId', id).delete();
        }
        await deleteOp;
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds)) {
      // 1. Identify currently linked assets (NoQR = 0)
      let linkedQuery = db('components');
      if (isPostgres) {
          linkedQuery = linkedQuery.where('parentid', id).andWhere('noqr', 0).select('id as ID');
      } else {
          linkedQuery = linkedQuery.where('ParentId', id).andWhere('NoQR', 0).select('ID');
      }
      
      const rows = await linkedQuery;
      const currentLinked = rows.map(c => c.ID);
      
      // 2. Unlink those that are no longer in linkedIds
      const toUnlink = currentLinked.filter(linkId => !asset.linkedIds.includes(linkId));
      for (const unlinkId of toUnlink) {
        let unlinkCompOp = db('components');
        let unlinkAssetOp = db('assets');
        
        if (isPostgres) {
            await unlinkCompOp.where('id', unlinkId).andWhere('parentid', id).delete();
            await unlinkAssetOp.where('id', unlinkId).update({ parentid: null });
          } else {
            await unlinkCompOp.where('ID', unlinkId).andWhere('ParentId', id).delete();
            await unlinkAssetOp.where('ID', unlinkId).update({ ParentId: null });
          }
        
        appendAudit({ 
          Action: 'UNLINK_COMPONENT', 
          User: req.headers['x-user'] || 'web', 
          AssetId: unlinkId, 
          Severity: 'INFO', 
          Details: `Component unlinked from parent ${id}` 
        });
      }

      for (const linkId of asset.linkedIds) {
        // Validation: Check if asset is already assigned to a parent
        let assetLookup = db('assets');
        if (isPostgres) assetLookup = assetLookup.whereRaw('LOWER(id) = LOWER(?)', [linkId]);
        else assetLookup = assetLookup.where('ID', linkId);
        
        const existingAsset = await assetLookup.first();
        if (!existingAsset) continue;

        const existingParentInAssets = existingAsset.ParentId || existingAsset.parentid;
        
        let compLookup = db('components');
        if (isPostgres) compLookup = compLookup.whereRaw('LOWER(id) = LOWER(?)', [linkId]);
        else compLookup = compLookup.where('ID', linkId);
        
        const existingComp = await compLookup.first();
        const existingParentInComps = existingComp ? (existingComp.ParentId || existingComp.parentid) : null;

        // Only block if it's assigned to a DIFFERENT parent
        if ((existingParentInAssets && existingParentInAssets !== id) || 
            (existingParentInComps && existingParentInComps !== id)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        const linkInsert = {
          id: linkId,
          parentid: id,
          itemname: existingAsset.ItemName || existingAsset.itemname,
          make: existingAsset.Make || existingAsset.make || '',
          model: existingAsset.Model || existingAsset.model || '',
          srno: existingAsset.SrNo || existingAsset.srno || '',
          status: existingAsset.Status || existingAsset.status || 'In Store',
          type: existingAsset.Type || existingAsset.type || 'Component',
          category: existingAsset.Category || existingAsset.category || '',
          lastupdated: new Date().toISOString(),
          noqr: 0
        };

        if (isPostgres) {
            await db('components').insert(linkInsert).onConflict('id').merge();
            await db('assets').where('id', linkId).update({ parentid: id });
        } else {
            const sqliteLinkInsert = {};
            Object.keys(linkInsert).forEach(k => {
                const pKey = k === 'id' ? 'ID' : k === 'parentid' ? 'ParentId' : k === 'itemname' ? 'ItemName' : k === 'lastupdated' ? 'LastUpdated' : k === 'noqr' ? 'NoQR' : k.charAt(0).toUpperCase() + k.slice(1);
                sqliteLinkInsert[pKey] = linkInsert[k];
            });
            await db('components').insert(sqliteLinkInsert).onConflict('ID').merge();
            await db('assets').where('ID', linkId).update({ ParentId: id });
        }
      }
    }


    appendAudit({ 
      Action: 'UPDATE', 
      User: req.headers['x-user'] || 'web', 
      AssetId: id, 
      Severity: 'INFO', 
      Details: `Asset updated: ${asset.ItemName || existing.ItemName}` 
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update asset:', err);
    res.status(500).send('Error updating asset: ' + err.message);
  }
});

app.put('/api/orders/:orderId/status', authenticateJWT, async (req, res) => {
  try {
    const { orderId } = req.params;
    const { Status } = req.body;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    await db('project_orders')
      .where(isPostgres ? 'id' : 'ID', orderId)
      .update(isPostgres ? { status: Status } : { Status });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/assets/bulk', authenticateJWT, async (req, res) => {
  try {
    const { ids } = req.body;
    const username = req.user.username || 'web';

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).send('No asset IDs provided');
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    if (!isAdmin) {
      await appendAudit({ Action: 'BULK_DELETE_DENIED', User: username, AssetId: ids.join(','), Severity: 'WARN', Details: 'Unauthorized bulk delete attempt' });
      return res.status(403).send('Forbidden');
    }

    const now = new Date().toISOString();
    let deletedCount = 0;

    await db.transaction(async (trx) => {
      for (const id of ids) {
        const asset = await trx('assets').where('id', id).first();
        if (!asset) continue;

        // 1. Quantity Logic for Bulk
        if (asset.quantity_root_id) {
          const isRoot = String(asset.quantity_root_id).toLowerCase() === String(id).toLowerCase();
          if (isRoot) {
            // Root: Only delete if no active children
            const activeChildren = await trx('assets')
              .where('quantity_parent_id', id)
              .andWhere(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
              })
              .first();
            if (activeChildren) continue; // Skip root with children
          } else {
            // Child: Return quantity to parent
            const qtyToReturn = asset.quantity_total || 0;
            const parentId = asset.quantity_parent_id;
            if (qtyToReturn > 0 && parentId) {
              await applyQuantityEvent({
                rootId: asset.quantity_root_id,
                type: 'BULK_RETURN_ON_DELETE',
                actor: username,
                note: `Returned quantity from bulk deleted split: ${id}`,
                lines: [
                  { assetId: parentId, deltaAvailable: qtyToReturn, deltaTotal: 0 },
                  { assetId: id, deltaAvailable: -qtyToReturn, deltaTotal: -qtyToReturn }
                ]
              });
            }
          }
        } else {
          // 2. Component Logic for Bulk
          const qtyChildren = await trx('assets').where('quantity_parent_id', id).first();
          if (qtyChildren) continue;
        }

        // Clear ParentId for linked assets
        const linkedComponents = await trx('components').where('parentid', id).select('id');
        for (const comp of linkedComponents) {
          await trx('assets').where('id', comp.id).update({ parentid: null });
        }

        await trx('components').where('id', id).delete();
        await trx('components').where('parentid', id).delete();

        const changes = await trx('assets')
          .where('id', id)
          .update({ is_deleted: 1, deleted_at: now });
        if (changes > 0) deletedCount++;
      }
    });

    await appendAudit({ 
      Action: 'BULK_DELETE', 
      User: username, 
      AssetId: ids.join(','), 
      Severity: 'INFO', 
      Details: `Marked ${deletedCount} assets for deletion (30-day grace period)` 
    });

    res.json({ success: true, count: deletedCount, message: `Successfully marked ${deletedCount} assets for deletion` });
  } catch (err) {
    console.error('Failed bulk delete:', err);
    res.status(500).send('Error in bulk deletion: ' + err.message);
  }
});

app.delete('/api/assets/:id', authenticateJWT, async (req, res) => {
  try {
    const id = req.params.id;
    const username = req.user.username || 'web';

    // 1. Fetch asset details for quantity check
    const asset = await db('assets').where('id', id).first();
    if (!asset) return res.status(404).send('Asset not found');

    // 2. Quantity Tracked Asset Logic
    if (asset.quantity_root_id) {
      const isRoot = String(asset.quantity_root_id).toLowerCase() === String(id).toLowerCase();
      
      if (isRoot) {
        // --- Root Asset Deletion ---
        // Check for active children (allocations/splits)
        const activeChildren = await db('assets')
          .where('quantity_parent_id', id)
          .andWhere(function() {
            this.where('is_deleted', 0).orWhereNull('is_deleted');
          })
          .first();
        if (activeChildren) {
          return res.status(400).send('Cannot delete Root Quantity asset while active splits exist. Return or delete all splits first.');
        }
        // If no active children, we can proceed to soft-delete the root
      } else {
        // --- Child Asset (Split) Deletion ---
        // We must return the quantity back to the parent before deleting the child
        const qtyToReturn = asset.quantity_total || 0;
        const parentId = asset.quantity_parent_id;
        
        if (qtyToReturn > 0 && parentId) {
          try {
            console.log(`[QTY RETURN] Returning ${qtyToReturn} from child ${id} to parent ${parentId}`);
            await applyQuantityEvent({
              rootId: asset.quantity_root_id,
              type: 'RETURN_ON_DELETE',
              actor: username,
              note: `Returned quantity from deleted split: ${id}`,
              lines: [
                { assetId: parentId, deltaAvailable: qtyToReturn, deltaTotal: 0 },
                { assetId: id, deltaAvailable: -qtyToReturn, deltaTotal: -qtyToReturn }
              ]
            });
          } catch (qtyErr) {
            console.error('[QTY RETURN ERROR]', qtyErr);
            return res.status(500).send('Failed to return quantity to parent: ' + qtyErr.message);
          }
        }
      }
    } else {
      // 3. Component Hierarchy Check (Non-quantity assets)
      const qtyChildren = await db('assets').where('quantity_parent_id', id).first();
      if (qtyChildren) {
        return res.status(400).send('Cannot delete asset with quantity children');
      }
    }

    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    if (!isAdmin) {
      await appendAudit({ Action: 'DELETE_DENIED', User: username, AssetId: id, Severity: 'WARN', Details: 'Unauthorized delete attempt' });
      return res.status(403).send('Forbidden');
    }

    // Delete from components table as well
    // For linked assets (NoQR = 0), we should also clear their ParentId in the assets table
    const linkedRows = await db('components').where(isPostgres ? 'parentid' : 'ParentId', id).select(isPostgres ? 'id' : 'ID');
    for (const comp of linkedRows) {
      const compId = comp.id || comp.ID;
      await db('assets').where(isPostgres ? 'id' : 'ID', compId).update(isPostgres ? { parentid: null } : { ParentId: null });
    }

    await db('components').where(isPostgres ? 'id' : 'ID', id).delete();
    await db('components').where(isPostgres ? 'parentid' : 'ParentId', id).delete();

    // Soft Delete: Mark as deleted instead of removing immediately
    const now = new Date().toISOString();
    const result = await db('assets')
      .where(isPostgres ? 'id' : 'ID', id)
      .update(isPostgres ? { is_deleted: 1, deleted_at: now } : { is_deleted: 1, deleted_at: now });

    if (result > 0) {
      await appendAudit({ Action: 'DELETE', User: username, AssetId: id, Severity: 'INFO', Details: 'Asset marked for deletion (30-day grace period)' });
      res.json({ success: true, message: 'Asset marked for deletion (30-day grace period)' });
    } else {
      res.status(404).send('Asset not found');
    }
  } catch (err) {
    console.error('Failed to delete asset:', err);
    res.status(500).send('Error deleting asset: ' + err.message);
  }
});

app.post('/api/assets/:id/link-po-item', authenticateJWT, (req, res) => {
  try {
    const { id } = req.params;
    const { poItemId } = req.body;
    
    // Check if it's a permanent or temporary asset
    const isTemp = id.startsWith('MUMT-');
    if (isTemp) {
      legacyDb.prepare('UPDATE temporary_assets SET linked_po_item_id = ? WHERE ID = ?').run(poItemId || null, id);
    } else {
      legacyDb.prepare('UPDATE assets SET linked_po_item_id = ? WHERE ID = ?').run(poItemId || null, id);
    }
    
    if (poItemId) {
      const item = legacyDb.prepare('SELECT * FROM project_order_items WHERE ID = ?').get(poItemId);
      const permanentFulfilled = legacyDb.prepare('SELECT COUNT(*) as count FROM assets WHERE linked_po_item_id = ?').get(poItemId).count;
      const temporaryFulfilled = legacyDb.prepare('SELECT COUNT(*) as count FROM temporary_assets WHERE linked_po_item_id = ?').get(poItemId).count;
      
      const fulfilledCount = permanentFulfilled + temporaryFulfilled;
      const newStatus = fulfilledCount >= item.QtyOrdered ? 'Shipped' : 'Partially Fulfilled';
      legacyDb.prepare('UPDATE project_order_items SET Status = ? WHERE ID = ?').run(newStatus, poItemId);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit', authenticateJWT, async (req, res) => {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    let log;
    if (isPostgres) {
        log = await db('audit_log').orderBy('timestamp', 'desc').limit(1000);
        log = normalizeResult(log);
    } else {
        log = legacyDb.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC LIMIT 1000').all();
    }
    res.json(log);
  } catch (err) {
    console.error('Failed to fetch audit log:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/reports/asset-history', (req, res) => {
  console.log(`[Report] Generating history report. Query:`, req.query);
  try {
    const { section, assetId, startDate, endDate } = req.query;
    let query = `
      SELECT a.*, pa.ProjectID, al.Action, al.User, al.Timestamp as HistoryTimestamp, al.Details, al.Severity
      FROM assets a
      LEFT JOIN project_assets pa ON a.ID = pa.AssetID
      LEFT JOIN audit_log al ON a.ID = al.AssetId
      WHERE 1=1
    `;
    const params = [];

    if (assetId) {
      query += ` AND a.ID = ?`;
      params.push(assetId);
    } else if (section) {
      query += ` AND (a.Category = ? OR a.Type = ? OR a.CurrentLocation = ?)`;
      params.push(section, section, section);
    }

    if (startDate) {
      query += ` AND al.Timestamp >= ?`;
      params.push(startDate);
    }
    if (endDate) {
      query += ` AND al.Timestamp <= ?`;
      params.push(endDate);
    }

    query += ` ORDER BY a.ID, al.Timestamp DESC`;
    const rows = legacyDb.prepare(query).all(...params);

    // Group by asset for a cleaner report structure
    const report = [];
    let currentAsset = null;

    rows.forEach(row => {
      if (!currentAsset || currentAsset.ID !== row.ID) {
        currentAsset = {
          ID: row.ID,
          ItemName: row.ItemName,
          Status: row.Status,
          Type: row.Type,
          Category: row.Category,
          CurrentLocation: row.CurrentLocation,
          AssignedTo: row.AssignedTo,
          ProjectID: row.ProjectID,
          QuantityTotal: row.quantity_total,
          QuantityAvailable: row.quantity_available,
          QuantityUnit: row.quantity_unit,
          History: []
        };
        report.push(currentAsset);
      }

      if (row.Action) {
        currentAsset.History.push({
          Action: row.Action,
          User: row.User,
          Timestamp: row.HistoryTimestamp,
          Details: row.Details,
          Severity: row.Severity
        });
      }
    });

    res.json(report);
  } catch (err) {
    console.error('Failed to generate history report:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});



app.get('/api/qr/:id', async (req, res) => {
  const id = req.params.id;
  
  try {
    const ip = getLocalIP();
    const port = process.env.PORT || 9090;

    const projectExists = legacyDb.prepare('SELECT 1 FROM projects WHERE ID = ?').get(id);
    if (projectExists) {
      const urlText = `http://${ip}:${port}/project/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      legacyDb.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
      res.setHeader('Content-Type', 'image/png');
      return res.send(png);
    }

    const asset = legacyDb.prepare('SELECT QRCode FROM assets WHERE ID = ?').get(id);
    if (asset && asset.QRCode && asset.QRCode.startsWith('data:image/')) {
      const base64Data = asset.QRCode.split(',')[1];
      const img = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(img);
    }

    const assetExists = legacyDb.prepare('SELECT 1 FROM assets WHERE ID = ?').get(id);
    if (assetExists) {
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      legacyDb.prepare('UPDATE assets SET QRCode = ? WHERE ID = ?').run(qrCode, id);
      res.setHeader('Content-Type', 'image/png');
      return res.send(png);
    }

    const png = await qrcode.toBuffer(id, { width: 512 });
    res.setHeader('Content-Type', 'image/png');
    res.send(png);
  } catch (e) { 
    console.error('QR API error:', e);
    res.status(500).send('QR error');
  }
})

app.post('/api/dynamic', (req, res) => {
  const { target, code } = req.body || {}
  if (!target) return res.status(400).send('target required')
  const dyn = readDynamic()
  const c = code && !dyn[code] ? code : genCode()
  dyn[c] = { target, created: new Date().toISOString(), scans: 0, events: [] }
  writeDynamic(dyn)
  appendAudit({ Action: 'DYNAMIC_CREATE', User: req.headers['x-user'] || 'web', AssetId: c, Severity: 'INFO', Details: `Dynamic created -> ${target}` })
  res.json({ code: c, url: `/d/${c}` })
})
app.put('/api/dynamic/:code', (req, res) => {
  const dyn = readDynamic()
  const c = req.params.code
  if (!dyn[c]) return res.status(404).send('Not found')
  dyn[c].target = req.body.target || dyn[c].target
  dyn[c].updated = new Date().toISOString()
  writeDynamic(dyn)
  appendAudit({ Action: 'DYNAMIC_UPDATE', User: req.headers['x-user'] || 'web', AssetId: c, Severity: 'INFO', Details: `Dynamic updated -> ${dyn[c].target}` })
  res.json({ code: c, target: dyn[c].target })
})
app.get('/api/dynamic/:code', (req, res) => {
  const dyn = readDynamic()
  const c = req.params.code
  if (!dyn[c]) return res.status(404).send('Not found')
  dyn[c].scans++
  dyn[c].events.push({ type: 'scan', timestamp: new Date().toISOString(), ip: req.ip })
  writeDynamic(dyn)
  appendAudit({ Action: 'DYNAMIC_SCAN', User: req.headers['x-user'] || 'web', AssetId: c, Severity: 'INFO', Details: `Dynamic scanned -> ${dyn[c].target}` })
  res.redirect(dyn[c].target)
})

app.get('/api/dynamic', (req, res) => {
  res.json(readDynamic())
})

app.delete('/api/dynamic/:code', (req, res) => {
  const username = req.headers['x-user'] || ''
  const user = legacyDb.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user || (user.role !== 'admin' && user.role !== 'superuser')) {
    appendAudit({ Action: 'DYNAMIC_DELETE_DENIED', User: username || 'web', AssetId: req.params.code, Severity: 'WARN', Details: 'Unauthorized dynamic delete attempt' })
    return res.status(403).send('Forbidden')
  }
  const dyn = readDynamic()
  const c = req.params.code
  if (!dyn[c]) return res.status(404).send('Not found')
  delete dyn[c]
  writeDynamic(dyn)
  appendAudit({ Action: 'DYNAMIC_DELETE', User: username || 'web', AssetId: c, Severity: 'INFO', Details: 'Dynamic deleted' })
  res.json({ ok: true })
})

app.get('/test-asset/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/test_asset_view.html'))
})

app.get('/asset/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/asset-view.html'))
})

app.get('/public/asset/:label', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/public-view.html'))
})

app.get('/project/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/project-view.html'))
})

app.get('/api/assets/search', (req, res) => {
  const query = req.query.q;
  const page = parseInt(req.query.page) || 1;
  const size = parseInt(req.query.size) || 20;

  if (!query) return res.json({ last_page: 1, data: [] });
  
  try {
    const tokens = query.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return res.json({ last_page: 1, data: [] });

    const fields = [
      'a.ItemName', 'a.ID', 'a.Model', 'a.SrNo',
      'a.CurrentLocation', 'a.Type', 'a.Category', 'a.Status',
      'a.AssignedTo', 'a.Remarks',
      'it.MACAddress', 'it.IPAddress', 'it.UserID', 'it.NetworkType', 'it.VLAN', 'it.SocketID'
    ];

    let baseSql = `
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
      LEFT JOIN project_assets pa ON a.ID = pa.AssetID
      LEFT JOIN projects p ON pa.ProjectID = p.ID
      WHERE `;
    
    const params = [];
    const tokenClauses = tokens.map(token => {
      const fieldClauses = fields.map(field => {
        params.push(`%${token}%`);
        return `${field} LIKE ?`;
      }).join(' OR ');
      return `(${fieldClauses})`;
    }).join(' AND ');

    baseSql += tokenClauses;

    // Count
    const countSql = `SELECT COUNT(*) as count ${baseSql}`;
    const totalResult = legacyDb.prepare(countSql).get(...params);
    const totalRecords = totalResult ? totalResult.count : 0;
    const last_page = Math.ceil(totalRecords / size);

    // Fetch
    const sql = `
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID,
             p.ProjectName as AssignedProjectName, p.ID as AssignedProjectID
      ${baseSql}
      LIMIT ? OFFSET ?
    `;
    
    const offset = (page - 1) * size;
    params.push(size, offset);
    
    const results = legacyDb.prepare(sql).all(...params);
    const data = results.map((r) => ({
      ...r,
      isQuantitySubAsset: r.quantity_root_id != null && String(r.quantity_root_id).trim() !== ''
    }));

    res.json({
        last_page: last_page,
        data: data,
        total_records: totalRecords
    });
  } catch (err) {
    console.error('Search failed:', err);
    res.status(500).send('Search failed');
  }
});

// Network Scanner APIs
app.get('/api/network-info', (req, res) => {
  try {
    const nets = os.networkInterfaces();
    const result = [];
    
    // Get client IP as seen by server
    let clientIp = req.ip || req.connection.remoteAddress;
    if (clientIp.includes('::ffff:')) clientIp = clientIp.split('::ffff:')[1];
    if (clientIp === '::1') clientIp = '127.0.0.1';

    console.log(`[NetworkInfo] Detecting interfaces for client: ${clientIp}`);

    for (const name of Object.keys(nets)) {
      for (const iface of nets[name]) {
        // Node.js 18+ uses numeric family (4 or 6), older versions use 'IPv4' or 'IPv6'
        const isIPv4 = iface.family === 'IPv4' || iface.family === 4;
        
        if (isIPv4 && !iface.internal) {
          const parts = iface.address.split('.');
          const subnet = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
          
          const isClientSubnet = clientIp.startsWith(`${parts[0]}.${parts[1]}.${parts[2]}`);
          
          result.push({
            name,
            address: iface.address,
            netmask: iface.netmask,
            subnet,
            isClientSubnet
          });
        }
      }
    }
    
    console.log(`[NetworkInfo] Found ${result.length} interfaces`);
    res.json({ interfaces: result, clientIp });
  } catch (err) {
    console.error('[NetworkInfo] Error:', err);
    res.status(500).json({ error: 'Failed to detect network info', details: err.message });
  }
});

// --- Network Scanning Helpers ---

/**
 * Robust hostname resolution for Windows environments.
 * Tries: DNS Reverse Lookup -> nbtstat (NetBIOS) -> ping -a
 */
async function resolveHostname(ip) {
  const { exec } = require('child_process');
  const util = require('util');
  const execAsync = util.promisify(exec);

  // 1. Try DNS Reverse Lookup
  try {
    const hostnames = await dns.reverse(ip);
    if (hostnames && hostnames.length > 0) {
      console.log(`[Resolve] DNS found ${ip} -> ${hostnames[0]}`);
      return hostnames[0];
    }
  } catch (e) {}

  // 2. Try nbtstat -A (NetBIOS - excellent for local Windows/Samba networks)
  try {
    const { stdout } = await execAsync(`nbtstat -A ${ip}`, { timeout: 2000 });
    // nbtstat output contains the name in a table format:
    // "    NAME           <00>  UNIQUE      Registered"
    const match = stdout.match(/\s+([A-Z0-9-]+)\s+<00>\s+UNIQUE/i);
    if (match && match[1]) {
      const name = match[1].trim();
      console.log(`[Resolve] NetBIOS found ${ip} -> ${name}`);
      return name;
    }
  } catch (e) {}

  // 3. Try ping -a (System resolver)
  try {
    const { stdout } = await execAsync(`ping -a -n 1 -w 500 ${ip}`, { timeout: 2000 });
    // ping -a output: "Pinging HOST [IP] with 32 bytes of data:"
    const match = stdout.match(/Pinging\s+([^\s\[]+)\s+\[/i);
    if (match && match[1] && match[1] !== ip) {
      console.log(`[Resolve] Ping -a found ${ip} -> ${match[1]}`);
      return match[1];
    }
  } catch (e) {}

  return 'Unknown';
}

/**
 * MAC Address to Manufacturer lookup using a public API.
 * Includes a simple cache and rate limiting (max 1 request per 600ms).
 */
const macCache = new Map();
let lastMacLookupTime = 0;
let macLookupQueue = Promise.resolve();

/**
 * Normalizes MAC address to lowercase with colons.
 */
function normalizeMac(mac) {
  if (!mac || mac === 'Unknown' || mac === 'unknown' || mac === '?') return 'Unknown';
  return mac.replace(/[:-]/g, ':').toLowerCase();
}

async function getManufacturer(mac) {
  if (!mac || mac === 'Unknown' || mac === 'unknown' || mac === '?') return 'Unknown';
  
  // Use only OUI (first 6 chars) for lookup to be faster and more private
  const cleanMac = mac.replace(/[:-]/g, '').toUpperCase().substring(0, 6);
  if (macCache.has(cleanMac)) {
    console.log(`[MAC] Cache hit for ${mac}: ${macCache.get(cleanMac)}`);
    return macCache.get(cleanMac);
  }

  // Use a queue to ensure strict rate limiting even with parallel calls
  return macLookupQueue = macLookupQueue.catch(() => {}).then(async () => {
    // Check cache again inside the queue
    if (macCache.has(cleanMac)) return macCache.get(cleanMac);

    const now = Date.now();
    const waitTime = Math.max(0, 1500 - (now - lastMacLookupTime)); 
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    lastMacLookupTime = Date.now();

    const https = require('https');
    console.log(`[MAC] Looking up manufacturer for OUI ${cleanMac} (${mac})...`);
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.macvendors.com',
        path: `/${encodeURIComponent(cleanMac)}`,
        method: 'GET',
        headers: {
          'User-Agent': 'AssetManager/1.0',
          'Accept': 'text/plain'
        },
        timeout: 5000
      };

      const req = https.get(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            const mfg = data.trim() || 'Unknown';
            console.log(`[MAC] Result for ${mac}: ${mfg}`);
            macCache.set(cleanMac, mfg);
            resolve(mfg);
          } else if (res.statusCode === 429) {
            console.warn(`[MAC] Rate limited (429) for ${mac}`);
            resolve('Unknown (Rate Limited)');
          } else if (res.statusCode === 404) {
            console.log(`[MAC] Not found (404) for ${mac}`);
            macCache.set(cleanMac, 'Unknown');
            resolve('Unknown');
          } else {
            console.log(`[MAC] No result (Status ${res.statusCode}) for ${mac}`);
            resolve('Unknown');
          }
        });
      });

      req.on('error', (err) => {
        console.error(`[MAC] Lookup error for ${mac}:`, err.message);
        resolve('Unknown');
      });

      req.on('timeout', () => {
        req.destroy();
        console.warn(`[MAC] Lookup timeout for ${mac}`);
        resolve('Unknown (Timeout)');
      });
    });
  });
}

/* 
app.get('/api/scan', async (req, res) => {
  const target = req.query.target;
  const ports = req.query.ports;
  
  if (!target) return res.status(400).send('Target IP range required');

  try {
    console.log(`Starting discovery scan on target: ${target}`);
    
    let devices = [];
    try {
      devices = await find();
      console.log(`ARP Discovery found ${devices.length} devices in total cache`);
    } catch (arpErr) {
      console.error('ARP Discovery error (non-fatal):', arpErr);
    }

    const scanPorts = ports || '21,22,23,25,53,80,110,135,139,443,445,1433,3306,3389,5357,8080,8443';
    const options = {
      target: target,
      port: scanPorts,
      status: 'O', 
      banner: true,
      timeout: 1000, 
      concurrency: 200
    };

    const scanner = new Evilscan(options);
    const finalResults = {};
    const targetPrefix = target.includes('/') ? target.split('/')[0].split('.').slice(0, 3).join('.') : target.split('.').slice(0, 3).join('.');
    const localNets = os.networkInterfaces();
    
    for (const name of Object.keys(localNets)) {
      for (const iface of localNets[name]) {
        if (!iface.internal && (iface.family === 'IPv4' || iface.family === 4)) {
          const localEntry = {
            ip: iface.address,
            name: os.hostname() + ' (Local)',
            mac: iface.mac || 'Unknown',
            manufacturer: 'Local Interface',
            ports: [],
            status: 'online'
          };
          
          const isExactMatch = iface.address === target;
          const isSubnetMatch = iface.address.startsWith(targetPrefix);
          
          if (isExactMatch || isSubnetMatch) {
            finalResults[iface.address] = localEntry;
          }
        }
      }
    }

    devices.forEach(d => {
      if (d.ip.startsWith(targetPrefix)) {
        finalResults[d.ip] = {
          ip: d.ip,
          name: d.name && d.name !== '?' ? d.name : 'Unknown',
          mac: normalizeMac(d.mac),
          manufacturer: 'Unknown',
          ports: [],
          status: 'online'
        };
      }
    });

    scanner.on('result', (data) => {
      if (!finalResults[data.ip]) {
        finalResults[data.ip] = {
          ip: data.ip,
          name: 'Unknown',
          mac: 'Unknown',
          manufacturer: 'Unknown',
          ports: [],
          status: 'online'
        };
      }
      if (data.status === 'open' && !finalResults[data.ip].ports.includes(data.port)) {
        finalResults[data.ip].ports.push(data.port);
      }
    });

    scanner.on('error', (err) => { console.error('Scanner error:', err); });

    scanner.on('done', async () => {
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      try {
        // Phase A: Resolve Hostnames (this pings the devices and populates ARP table)
        console.log(`[Scan] Starting robust hostname resolution for ${Object.keys(finalResults).length} devices...`);
        const hostnamePromises = Object.keys(finalResults).map(async (ip) => {
          const device = finalResults[ip];
          if (!device.name || device.name === 'Unknown') {
            const resolvedName = await resolveHostname(ip);
            if (resolvedName !== 'Unknown') {
              device.name = resolvedName;
            }
          }
        });
        await Promise.all(hostnamePromises);

        // Phase B: Final ARP refresh to catch MACs revealed by pings
        console.log('[Scan] Refreshing MAC addresses from ARP table...');
        try {
          const freshDevices = await find();
          freshDevices.forEach(d => {
            if (finalResults[d.ip] && (finalResults[d.ip].mac === 'Unknown')) {
               finalResults[d.ip].mac = normalizeMac(d.mac);
            }
          });
          
          const { execSync } = require('child_process');
          try {
            const stdout = execSync('arp -a').toString();
            const lines = stdout.split('\n');
            for (const line of lines) {
              const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{17})/);
              if (match) {
                const ip = match[1];
                const mac = normalizeMac(match[2]);
                if (finalResults[ip] && (finalResults[ip].mac === 'Unknown')) {
                  finalResults[ip].mac = mac;
                }
              }
            }
          } catch (e) {}
        } catch (e) {}

        // Phase C: Resolve Manufacturers for all found MACs
        const macToDevices = {};
        Object.values(finalResults).forEach(d => {
          if (d.mac && d.mac !== 'Unknown') {
            const norm = normalizeMac(d.mac);
            if (!macToDevices[norm]) macToDevices[norm] = [];
            macToDevices[norm].push(d);
          }
        });

        const uniqueNormMacs = Object.keys(macToDevices).filter(mac => {
          // Only lookup if any device for this MAC still has Unknown manufacturer
          return macToDevices[mac].some(d => d.manufacturer === 'Unknown');
        });

        console.log(`[Scan] Looking up manufacturers for ${uniqueNormMacs.size || uniqueNormMacs.length} unique normalized MAC addresses...`);
        
        const manufacturerPromises = uniqueNormMacs.map(async (normMac) => {
          try {
            const mfg = await getManufacturer(normMac);
            if (mfg && mfg !== 'Unknown') {
              macToDevices[normMac].forEach(d => {
                d.manufacturer = mfg;
              });
            }
          } catch (mfgErr) {
            console.error(`[Scan] Manufacturer lookup failed for ${normMac}:`, mfgErr.message);
          }
        });
        
        // Wait for manufacturers with a generous timeout (120s)
        await Promise.race([
          Promise.all(manufacturerPromises),
          new Promise(resolve => setTimeout(resolve, 120000))
        ]);

      } catch (err) {
        console.error('Post-scan processing error:', err);
      }
      
      const resultsArray = Object.values(finalResults);
      const devicesWithMfg = resultsArray.filter(d => d.manufacturer && d.manufacturer !== 'Unknown').length;
      console.log(`[Scan] Completed. Sending ${resultsArray.length} results. Devices with manufacturer: ${devicesWithMfg}`);
      
      // DEBUG: Log all results with manufacturers
      const mfgList = resultsArray.filter(d => d.manufacturer && d.manufacturer !== 'Unknown').map(d => `${d.ip} (${d.mac}): ${d.manufacturer}`);
      if (mfgList.length > 0) {
        console.log('[Scan] Final Manufacturers assigned:', mfgList.join(' | '));
      } else {
        console.warn('[Scan] NO manufacturers were assigned to the final results array!');
        console.log('[Scan] Sample result:', resultsArray[0]);
      }
      
      res.json(resultsArray);
    });

    scanner.run();
  } catch (err) {
    console.error('Scan process error:', err);
    res.status(500).send('Scan failed: ' + err.message);
  }
});
*/

// Background Network Monitor (DHCP Tracker)
let isBgScanning = false;
/*
async function runNetworkMonitor() {
  if (isBgScanning) return;
  isBgScanning = true;
  
  console.log(`[${new Date().toLocaleTimeString()}] [NetworkMonitor] Starting background IP/MAC sync...`);
  
  try {
    // 1. Get all active devices on the network using ARP discovery
    const devices = await find();
    
    let updateCount = 0;
    const now = new Date().toISOString();

    for (const device of devices) {
      if (!device.mac || device.mac === 'unknown') continue;

      // Normalize MAC for comparison
      const mac = device.mac.toLowerCase();

      // NEW: Try to resolve hostname and manufacturer for background devices if they don't have one
      let hostname = device.name && device.name !== '?' ? device.name : 'Unknown';
      if (hostname === 'Unknown' && device.ip) {
        hostname = await resolveHostname(device.ip);
      }

      let manufacturer = 'Unknown';
      if (device.mac && device.mac !== 'unknown') {
        manufacturer = await getManufacturer(device.mac);
      }

      // Check if this MAC address is linked to any asset in our database
      const existing = legacyDb.prepare(`
        SELECT AssetID, IPAddress, MACAddress 
        FROM asset_it_details 
        WHERE LOWER(MACAddress) = ?
      `).get(mac);

      if (existing) {
        // If the IP has changed, update it
        if (existing.IPAddress !== device.ip) {
          console.log(`[NetworkMonitor] Detected IP change for Asset ${existing.AssetID}: ${existing.IPAddress} -> ${device.ip} (MAC: ${mac}, Host: ${hostname}, Mfg: ${manufacturer})`);
          
          legacyDb.prepare('UPDATE asset_it_details SET IPAddress = ? WHERE AssetID = ?')
            .run(device.ip, existing.AssetID);
          
          legacyDb.prepare('UPDATE assets SET LastUpdated = ? WHERE ID = ?')
            .run(now, existing.AssetID);

          appendAudit({
            Action: 'IP_AUTO_SYNC',
            User: 'SYSTEM',
            AssetId: existing.AssetID,
            Severity: 'INFO',
            Details: `Automatically updated IP from ${existing.IPAddress} to ${device.ip} (Hostname: ${hostname}, Manufacturer: ${manufacturer}) based on background network scan.`
          });
          
          updateCount++;
        }
      }
    }

    if (updateCount > 0) {
      console.log(`[NetworkMonitor] Finished. Updated ${updateCount} assets with new IP addresses.`);
    } else {
      console.log(`[NetworkMonitor] Finished. No IP changes detected for known MAC addresses.`);
    }

  } catch (err) {
    console.error('[NetworkMonitor] Background sync error:', err);
  } finally {
    isBgScanning = false;
  }
}

// Run every 5 minutes
/*
const MONITOR_INTERVAL = 5 * 60 * 1000;
setInterval(runNetworkMonitor, MONITOR_INTERVAL);

// Initial run after server starts
setTimeout(runNetworkMonitor, 15000);
*/

const PORT = process.env.PORT || 9090
// 5. Update Project (e.g., for Kanban status moves or details editing)
app.patch('/api/external/projects/:id', checkApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Build dynamic update query
        const fields = Object.keys(updates).filter(key => 
            ['ProjectName', 'ClientName', 'Status', 'Description', 'StartDate', 'EndDate', 'Location', 'Currency', 'OwnerEmail', 'CoordinatorEmail'].includes(key)
        );
        
        if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const params = fields.map(field => updates[field]);
        params.push(id);

        const stmt = legacyDb.prepare(`UPDATE projects SET ${setClause} WHERE ID = ?`);
        const result = stmt.run(...params);

        if (result.changes > 0) {
            // Regenerate QR code if relevant fields changed
            const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
            if (fields.some(f => relevantFields.includes(f))) {
                try {
                    const project = legacyDb.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
                    if (project) {
                        const ip = getLocalIP();
                        const port = process.env.PORT || 9090;
                        
                        // Use the new standardized Project QR payload generator
                        const qrPayload = generateProjectQRPayload(project, ip, port);
                        
                        const qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });
                        legacyDb.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
                    }
                } catch (qrErr) {
                    console.error('Failed to regenerate project QR code (external):', qrErr);
                }
            }

            // Log the change
            logAudit('External API', 'Project Update', `Updated ${fields.join(', ')} for project ${id}`, id);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Get Single Project Details
app.get('/api/external/projects/:id', checkApiKey, (req, res) => {
    try {
        const { id } = req.params;
        const project = legacyDb.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
        
        if (project) {
            const assets = legacyDb.prepare(`
                SELECT a.* 
                FROM assets a 
                JOIN project_assets pa ON a.ID = pa.AssetID 
                WHERE pa.ProjectID = ?
            `).all(id);
            res.json({ ...project, assets });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// OCR and Document Export Helpers
function detectTable(text) {
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 2) return false;
    
    let tableIndicators = 0;
    for (const line of lines) {
        // Detect columns via 2+ spaces, tabs, or piped characters
        const hasColumns = line.match(/\t/) || line.match(/ {2,}/) || (line.match(/\|/) && line.split('|').length > 2);
        const hasNumbers = line.match(/\d+\.\d{2}/) || line.match(/\$\s*\d+/);
        
        if (hasColumns || hasNumbers) {
            tableIndicators++;
        }
    }
    // If more than 30% of lines look like table rows, consider it a table
    return tableIndicators > lines.length * 0.3;
}

// OCR and Document Export Endpoints
// --- Document AI Configuration ---
const DOC_AI_CONFIG = {
    // URL for the Document AI Service
    apiUrl: 'http://192.168.6.123:8000/api/v1/process/hybrid',
    timeout: 300000 // 300 second timeout
};

// --- Legacy Pro OCR Configuration (Kept for reference but disabled per user request) ---
const OCR_CONFIG = {
    tesseract: 'C:\\Program Files\\Tesseract-OCR',
    ghostscript: 'C:\\Program Files\\gs\\gs10.06.0\\bin',
    ocrmypdf: 'C:\\Users\\Admin\\AppData\\Roaming\\Python\\Python314\\Scripts\\ocrmypdf.exe'
};

// Function to process with external Document AI
async function processWithDocumentAI(buffer, originalName, mimetype) {
    try {
        const base64Content = buffer.toString('base64');
        const payload = { 
            source: { 
                content: base64Content,
                name: originalName,
                mime_type: mimetype
            }, 
            tasks: ["all"], 
            options: { ocr_model: "tesseract-ocr" } 
        };

        console.log(`\n********************************************************************************`);
        console.log(`OCR: Sending ${originalName} (${mimetype}) to Document AI at ${DOC_AI_CONFIG.apiUrl}...`);
        console.log(`********************************************************************************\n`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DOC_AI_CONFIG.timeout);

        const response = await fetch(DOC_AI_CONFIG.apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`AI Processing failed: ${response.status} ${errorText}`);
        }

        const result = await response.json();
        const data = result.data || result;

        // Map AI results to standard blocks format
        let blocks = [];
        const fullText = data.text || 
                        (data.ocr_results && data.ocr_results.map(r => r.text).join('\n')) ||
                        (data.analyzeResult && data.analyzeResult.content);
        
        if (data.ocr_results) {
             // ... existing mapping logic ...
             // For brevity, we'll return the raw result + text for now as the frontend handles it
             blocks = []; // The frontend integration_client.js seems to handle the raw response
        }

        return { 
            text: fullText || '', 
            blocks: blocks, // simplified for proxy
            raw: result,
            status: 'success' 
        };
    } catch (err) {
        console.error('Document AI Error:', err);
        throw err;
    }
}

async function processToExcelAI(buffer, originalName, mimetype) {
    const url = DOC_AI_CONFIG.apiUrl.replace('/process/hybrid', '/process/excel');
    console.log(`OCR: Sending ${originalName} (${mimetype}) to Document AI Excel endpoint at ${url}...`);
    const base64Content = buffer.toString('base64');
    const payload = { 
        source: { content: base64Content, name: originalName, mime_type: mimetype }, 
        tasks: ["all"], options: { ocr_model: "tesseract-ocr", layout_model: "yolo_layout_v1" } 
    };
    
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`Excel AI failed: ${response.status} ${await response.text()}`);
    return await response.blob();
}

async function processToExcelAIV2(buffer, originalName) {
    const url = DOC_AI_CONFIG.apiUrl.replace('/process/hybrid', '/process/v2/excel');
    console.log(`OCR: Sending ${originalName} to Document AI V2 Excel endpoint at ${url}...`);
    const base64Content = buffer.toString('base64');
    
    // V2 Payload Structure
    const payload = {
        file_content: base64Content,
        filename: originalName,
        options: {}
    };
    
    const response = await fetch(url, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`Excel V2 AI failed: ${response.status} ${await response.text()}`);
    return await response.blob();
}

async function extractColumnAI(buffer, originalName, mimetype, keywords) {
    const url = DOC_AI_CONFIG.apiUrl.replace('/process/hybrid', '/process/extract-column');
    console.log(`OCR: Sending ${originalName} (${mimetype}) to Document AI Extraction endpoint at ${url}...`);
    const base64Content = buffer.toString('base64');
    const payload = { 
        source: { content: base64Content, name: originalName, mime_type: mimetype }, 
        tasks: ["all"], options: { ocr_model: "tesseract-ocr", keywords: keywords } 
    };
    
    const response = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    
    if (!response.ok) throw new Error(`Extraction AI failed: ${response.status} ${await response.text()}`);
    return await response.json();
}


async function processFileWithProMode(inputBuffer, originalName, mimetype) {
    // This function is now redirected to Document AI per user request
    return processWithDocumentAI(inputBuffer, originalName, mimetype);
}

app.get('/api/ocr/history', (req, res) => {
    try {
        if (!fs.existsSync(uploadsDir)) return res.json([]);
        
        const files = fs.readdirSync(uploadsDir)
            .filter(f => f.startsWith('ocr_pro_') && f.endsWith('.pdf'))
            .map(f => {
                const stats = fs.statSync(path.join(uploadsDir, f));
                const jsonPath = path.join(uploadsDir, f.replace('.pdf', '.json'));
                const hasBlocks = fs.existsSync(jsonPath);
                
                return {
                    name: f,
                    url: `/uploads/${f}`,
                    date: stats.mtime,
                    size: stats.size,
                    hasBlocks: hasBlocks
                };
            })
            .sort((a, b) => b.date - a.date);
            
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ocr/history/:filename/blocks', (req, res) => {
    try {
        const filename = req.params.filename;
        const jsonPath = path.join(uploadsDir, filename.replace('.pdf', '.json'));
        
        if (!fs.existsSync(jsonPath)) {
            return res.status(404).json({ error: 'Blocks not found' });
        }
        
        const blocks = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        res.json(blocks);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Company Template API (Moved to prevent catch-all interception) ---

app.get('/api/company-templates', authenticateJWT, (req, res) => {
    try {
        const templates = legacyDb.prepare('SELECT * FROM company_templates ORDER BY name').all();
        res.json({ success: true, templates });
    } catch (err) {
        console.error('Error fetching company templates:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/company-templates', authenticateJWT, (req, res) => {
    try {
        const { name, company_name, address, gst, cin, state_name, state_code, is_default } = req.body;
        
        if (!name || !company_name) {
            return res.status(400).json({ success: false, error: 'Template name and Company Name are required' });
        }

        if (is_default) {
            legacyDb.prepare('UPDATE company_templates SET is_default = 0').run();
        }

        const stmt = legacyDb.prepare(`
            INSERT INTO company_templates (name, company_name, address, gst, cin, state_name, state_code, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const info = stmt.run(name, company_name, address, gst, cin, state_name, state_code, is_default ? 1 : 0);
        
        res.json({ success: true, id: info.lastInsertRowid });
    } catch (err) {
        console.error('Error creating company template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/company-templates/:id', authenticateJWT, (req, res) => {
    try {
        const { id } = req.params;
        const { name, company_name, address, gst, cin, state_name, state_code, is_default } = req.body;

        if (is_default) {
            legacyDb.prepare('UPDATE company_templates SET is_default = 0').run();
        }

        const stmt = legacyDb.prepare(`
            UPDATE company_templates 
            SET name = ?, company_name = ?, address = ?, gst = ?, cin = ?, state_name = ?, state_code = ?, is_default = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        stmt.run(name, company_name, address, gst, cin, state_name, state_code, is_default ? 1 : 0, id);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating company template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/company-templates/:id', authenticateJWT, (req, res) => {
    try {
        const { id } = req.params;
        legacyDb.prepare('DELETE FROM company_templates WHERE id = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting company template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/ocr/history/:filename/blocks', express.json({ limit: '100mb' }), (req, res) => {
    try {
        const filename = req.params.filename;
        const blocks = req.body.blocks;
        
        console.log(`OCR: Saving blocks for ${filename}...`);
        
        if (!filename.startsWith('ocr_pro_') || !filename.endsWith('.pdf')) {
            console.error(`OCR Save Error: Invalid filename ${filename}`);
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        if (!Array.isArray(blocks)) {
            console.error('OCR Save Error: Blocks is not an array', typeof blocks);
            return res.status(400).json({ error: 'Blocks must be an array' });
        }
        
        const jsonPath = path.join(uploadsDir, filename.replace('.pdf', '.json'));
        fs.writeFileSync(jsonPath, JSON.stringify(blocks, null, 2));
        
        console.log(`OCR: Blocks saved successfully to ${jsonPath}`);
        res.json({ success: true });
    } catch (err) {
        console.error('OCR Save Exception:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ocr/history/:filename', (req, res) => {
    try {
        const filename = req.params.filename;
        if (!filename.startsWith('ocr_pro_') || !filename.endsWith('.pdf')) {
            return res.status(400).json({ error: 'Invalid filename' });
        }
        
        const filePath = path.join(uploadsDir, filename);
        const jsonPath = path.join(uploadsDir, filename.replace('.pdf', '.json'));
        
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            if (fs.existsSync(jsonPath)) {
                fs.unlinkSync(jsonPath);
            }
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'File not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* 
app.post('/api/ocr/process', ocrUpload.single('document'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No document uploaded' });
        }

        const buffer = req.file.buffer;
        const mimetype = req.file.mimetype;
        const originalName = req.file.originalname;

        console.log(`OCR: Processing ${originalName} (${mimetype}) using Document AI...`);
        const result = await processWithDocumentAI(buffer, originalName, mimetype);
        
        // Save initial blocks to JSON for persistence if we have a way to track it
        // For now, we return the result directly as requested
        res.json({ 
            text: result.text, 
            blocks: result.blocks, 
            isPro: true,
            status: result.status,
            data: result.data || result // Include full data for potential download links
        });
        
        console.log(`OCR: Document AI processing completed for ${originalName}.`);
    } catch (err) {
        console.error('OCR Processing error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/excel', ocrUpload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
        
        console.log(`OCR: Generating Excel for ${req.file.originalname}...`);
        const blob = await processToExcelAI(req.file.buffer, req.file.originalname, req.file.mimetype);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="processed_${req.file.originalname}.xlsx"`);
        
        const arrayBuffer = await blob.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        console.error('Excel Processing error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/v2/excel', ocrUpload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
        
        console.log(`OCR: Generating V2 Excel for ${req.file.originalname}...`);
        const blob = await processToExcelAIV2(req.file.buffer, req.file.originalname);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="structured_${req.file.originalname}.xlsx"`);
        
        const arrayBuffer = await blob.arrayBuffer();
        res.send(Buffer.from(arrayBuffer));
    } catch (err) {
        console.error('Excel V2 Processing error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/extract-column', ocrUpload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No document uploaded' });
        
        console.log(`OCR: Extracting column for ${req.file.originalname}...`);
        let keywords = ["description", "product", "particulars", "item"];
        if (req.body.keywords) {
            try {
                keywords = JSON.parse(req.body.keywords);
            } catch (e) {
                // If sent as simple comma-separated string or just plain text
                keywords = req.body.keywords.split(',').map(k => k.trim());
            }
        }
        
        const result = await extractColumnAI(req.file.buffer, req.file.originalname, req.file.mimetype, keywords);
        res.json(result);
    } catch (err) {
        console.error('Extraction Processing error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/export/pdf', express.json({ limit: '100mb' }), async (req, res) => {
    try {
        const { blocks, filename } = req.body;
        if (!blocks || !Array.isArray(blocks)) return res.status(400).send('No blocks to export');

        const pdfDoc = await PDFDocument.create();
        const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
        const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
        const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);
        
        let page = pdfDoc.addPage();
        const { width, height } = page.getSize();
        
        const margin = 50;
        const maxWidth = width - (margin * 2);
        let yOffset = height - margin;

        // Add Header
        page.drawText('OCR EXTRACTED DOCUMENT', {
            x: margin,
            y: yOffset,
            size: 16,
            font: fontBold,
            color: rgb(0.1, 0.4, 0.7),
        });
        yOffset -= 20;

        page.drawText(`Source: ${filename || 'Unknown'}`, {
            x: margin,
            y: yOffset,
            size: 9,
            font: font,
            color: rgb(0.5, 0.5, 0.5),
        });
        yOffset -= 30;

        // Draw a separator line
        page.drawLine({
            start: { x: margin, y: yOffset + 10 },
            end: { x: width - margin, y: yOffset + 10 },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8),
        });

        for (const block of blocks) {
            const isTable = block.type === 'table';
            const isHeader = block.type === 'header';
            
            let currentFont = font;
            let fontSize = 10;
            let color = rgb(0, 0, 0);

            if (isHeader) {
                currentFont = fontBold;
                fontSize = 14;
                color = rgb(0.2, 0.2, 0.2);
            } else if (isTable) {
                currentFont = fontMono;
                fontSize = 8;
            }

            const textLines = block.text.split('\n');
            const wrappedLines = [];
            
            // Simple line wrapping
            const charsPerLine = isTable ? 100 : 85;
            for (const line of textLines) {
                if (line.length > charsPerLine) {
                    let remaining = line;
                    while (remaining.length > 0) {
                        wrappedLines.push(remaining.substring(0, charsPerLine));
                        remaining = remaining.substring(charsPerLine);
                    }
                } else {
                    wrappedLines.push(line);
                }
            }

            const lineHeight = fontSize + 4;
            const blockHeight = (wrappedLines.length * lineHeight) + (isTable ? 15 : 10);

            // Page break check
            if (yOffset - blockHeight < margin) {
                page = pdfDoc.addPage();
                yOffset = height - margin;
                
                // Add tiny header on new page
                page.drawText(`${filename} (continued...)`, {
                    x: margin,
                    y: height - 25,
                    size: 8,
                    font: font,
                    color: rgb(0.7, 0.7, 0.7),
                });
                yOffset -= 30;
            }

            // Table Background
            if (isTable) {
                page.drawRectangle({
                    x: margin - 5,
                    y: yOffset - blockHeight + 5,
                    width: maxWidth + 10,
                    height: blockHeight,
                    color: rgb(0.98, 0.98, 1),
                    borderColor: rgb(0.85, 0.85, 0.9),
                    borderWidth: 0.5
                });
                yOffset -= 5;
            }

            for (const line of wrappedLines) {
                page.drawText(line.trim(), {
                    x: margin + (isTable ? 5 : 0),
                    y: yOffset,
                    size: fontSize,
                    font: currentFont,
                    color: color,
                });
                yOffset -= lineHeight;
            }
            
            yOffset -= (isHeader ? 15 : 10); // Space after block
        }

        // Add Footer with Page Numbers
        const pages = pdfDoc.getPages();
        for (let i = 0; i < pages.length; i++) {
            const p = pages[i];
            p.drawText(`Page ${i + 1} of ${pages.length}`, {
                x: width / 2 - 30,
                y: 20,
                size: 8,
                font: font,
                color: rgb(0.6, 0.6, 0.6),
            });
        }

        const pdfBytes = await pdfDoc.save();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${filename || 'exported'}.pdf`);
        res.send(Buffer.from(pdfBytes));
    } catch (err) {
        console.error('PDF Export error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/export/excel', express.json({ limit: '100mb' }), (req, res) => {
    try {
        const { blocks, text, filename } = req.body;
        console.log(`OCR: Exporting to Excel. Blocks: ${blocks ? blocks.length : 0}, Filename: ${filename}`);
        if (!blocks && !text) return res.status(400).send('No data to export');

        let rows = [];
        if (blocks && Array.isArray(blocks)) {
            blocks.forEach(block => {
                if (block.type === 'table') {
                    const tableLines = block.text.split('\n');
                    tableLines.forEach(line => {
                        if (line.trim()) {
                            // Split by multiple spaces or tabs
                            rows.push(line.split(/ {2,}|\t+/).map(c => c.trim()));
                        }
                    });
                    rows.push([]); // Add empty row after table
                } else {
                    rows.push([block.text]);
                    rows.push([]); // Add empty row after block
                }
            });
        } else {
            // Fallback to text splitting
            rows = text.split('\n').map(line => line.split(/\t| {2,}/));
        }

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Extracted Data");

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${filename || 'exported'}.xlsx`);
        res.send(buf);
    } catch (err) {
        console.error('Excel Export error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ocr/export/word', express.json({ limit: '100mb' }), async (req, res) => {
    try {
        const { blocks, text, filename } = req.body;
        console.log(`OCR: Exporting to Word. Blocks: ${blocks ? blocks.length : 0}, Filename: ${filename}`);
        if (!blocks && !text) return res.status(400).send('No data to export');

        const children = [];

        if (blocks && Array.isArray(blocks)) {
            blocks.forEach(block => {
                const isHeader = block.type === 'header';
                const isTable = block.type === 'table';

                if (isHeader) {
                    children.push(new Paragraph({
                        children: [new TextRun({ text: block.text, bold: true, size: 28 })],
                        spacing: { before: 400, after: 200 }
                    }));
                } else if (isTable) {
                    const tableLines = block.text.split('\n');
                    tableLines.forEach(line => {
                        if (line.trim()) {
                            children.push(new Paragraph({
                                children: [new TextRun({ text: line, font: 'Courier New', size: 18 })],
                                spacing: { after: 100 }
                            }));
                        }
                    });
                    children.push(new Paragraph({ children: [] })); // spacer
                } else {
                    block.text.split('\n').forEach(line => {
                        children.push(new Paragraph({
                            children: [new TextRun({ text: line, size: 22 })],
                            spacing: { after: 150 }
                        }));
                    });
                    children.push(new Paragraph({ children: [] })); // spacer
                }
            });
        } else {
            text.split('\n').forEach(line => {
                children.push(new Paragraph({
                    children: [new TextRun(line)],
                }));
            });
        }

        const doc = new Document({
            sections: [{
                properties: {},
                children: children,
            }],
        });

        const buf = await Packer.toBuffer(doc);
        
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename=${filename || 'exported'}.docx`);
        res.send(buf);
    } catch (err) {
        console.error('Word Export error:', err);
        res.status(500).json({ error: err.message });
    }
});
*/

app.post('/api/assets/split', async (req, res) => {
  try {
    const { parentId, serials, autoAssign, projectId } = req.body;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    console.log(`[SPLIT] Request for Parent: ${parentId}, Serials: ${serials.join(', ')}`);
    
    if (!parentId || !serials || !Array.isArray(serials) || serials.length === 0) {
      return res.status(400).json({ error: 'Parent ID and serial numbers list required' });
    }

    let parent;
    if (isPostgres) {
        parent = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId]).first();
        parent = normalizeResult(parent);
    } else {
        parent = legacyDb.prepare('SELECT * FROM assets WHERE LOWER(ID) = LOWER(?)').get(parentId);
    }
    
    if (!parent) return res.status(404).json({ error: 'Parent asset not found' });

    const currentSerials = (parent.SrNo || '').split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
    const newSerials = currentSerials.filter(sn => !serials.includes(sn));
    const splitCount = currentSerials.length - newSerials.length;

    console.log(`[SPLIT] Parent S/Ns: ${currentSerials.length}, To Split: ${serials.length}, Remaining: ${newSerials.length}`);

    if (splitCount === 0) {
      return res.status(400).json({ error: 'None of the selected serial numbers were found in this batch' });
    }

    const ts = new Date().toISOString();
    const actor = getRequestActor(req);

    let projectName = projectId || 'N/A';
    let projectInitials = 'NA';
    try {
        const project = await db('projects').where(isPostgres ? 'id' : 'ID', projectId).select(isPostgres ? 'projectname' : 'ProjectName', isPostgres ? 'initials' : 'Initials').first();
        if (project) {
            projectName = project.projectname || project.ProjectName;
            projectInitials = project.initials || project.Initials || 'NA';
        }
    } catch (err) {
        console.warn(`[SPLIT] Could not fetch project name for ${projectId}:`, err.message);
    }

    if (isPostgres) {
        await db.transaction(async (trx) => {
            // 1. Force Sync Parent Quantity
            console.log(`[SPLIT] Syncing parent quantity to ${currentSerials.length}`);
            await trx('assets')
                .whereRaw('LOWER(id) = LOWER(?)', [parentId])
                .update({
                    quantity_total: currentSerials.length,
                    quantity_available: currentSerials.length,
                    quantity_unit: db.raw('COALESCE(quantity_unit, ?)', ['pcs']),
                    is_quantity_tracked: 1,
                    quantity_root_id: db.raw('COALESCE(quantity_root_id, id)')
                });

            // 2. Re-fetch parent to ensure we have the synchronized quantity
            let syncedParent = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId]).first();
            syncedParent = normalizeResult(syncedParent);

            // 3. Update Parent Serial Numbers
            console.log(`[SPLIT] Updating parent S/Ns to: ${newSerials.join(', ')}`);
            await trx('assets')
                .whereRaw('LOWER(id) = LOWER(?)', [parentId])
                .update({
                    srno: newSerials.join(', '),
                    lastupdated: ts
                });

            // 4. Create Children
            const createdChildren = [];
            for (const sn of serials) {
                const childId = generateModernAssetId(syncedParent.CurrentLocation, syncedParent.Type);
                console.log(`[SPLIT] Creating child asset: ${childId} with S/N: ${sn}`);
                
                let status = syncedParent.Status;
                let assignedTo = syncedParent.AssignedTo;
                let clientLabel = null;
                
                if (autoAssign) {
                    status = 'Assigned';
                    assignedTo = autoAssign;
                } else if (projectId) {
                    status = 'Project';
                    assignedTo = `Project: ${projectName}`;
                    
                    // Generate Client Label: (AssetKind)-(ProjectInitials)-(6DigitCodeFromAssetID)
                    const assetParts = childId.split('-');
                    const assetKind = assetParts[0] || 'AST';
                    const sixDigitCode = assetParts[3] || '000000';
                    clientLabel = `${assetKind}-${projectInitials}-${sixDigitCode}`;
                }

                const childRecord = {
                    id: childId,
                    itemname: syncedParent.ItemName,
                    itemdescription: syncedParent.ItemDescription,
                    status: status,
                    make: syncedParent.Make,
                    model: syncedParent.Model,
                    srno: sn,
                    type: syncedParent.Type,
                    category: syncedParent.Category,
                    icon: syncedParent.Icon,
                    isplaceholder: 0,
                    parentid: parentId,
                    currentlocation: syncedParent.CurrentLocation,
                    dispatchreceivedt: syncedParent.DispatchReceiveDt,
                    purchasedetails: syncedParent.PurchaseDetails,
                    remarks: syncedParent.Remarks,
                    purpose: syncedParent.Purpose,
                    lastupdated: ts,
                    qrcode: null,
                    assignedto: assignedTo,
                    client_label: clientLabel,
                    noqr: syncedParent.NoQR,
                    warranty_months: syncedParent.WarrantyMonths || 0,
                    amc_months: syncedParent.AMCMonths || 0,
                    asset_value: syncedParent.AssetValue || 0,
                    currency: syncedParent.Currency || 'INR',
                    purchasedate: syncedParent.PurchaseDate,
                    conversion_unit: syncedParent.conversion_unit,
                    conversion_factor: syncedParent.conversion_factor,
                    conversion_mode: syncedParent.conversion_mode,
                    is_quantity_tracked: 0,
                    is_batch: 0
                };

                // Clean up any undefined fields that might have come from normalizeResult
                Object.keys(childRecord).forEach(key => childRecord[key] === undefined && delete childRecord[key]);

                await trx('assets').insert(childRecord);
                createdChildren.push(childRecord);

                if (projectId) {
                    await trx('project_assets').insert({
                        projectid: projectId,
                        assetid: childId,
                        assigneddate: ts,
                        type: 'Permanent'
                    }).onConflict(['projectid', 'assetid']).merge();
                }
                
                await logAssetHistory(childId, 'SPLIT_CHILD_CREATED', null, sn, actor, `Created from parent ${parentId}`, trx);
            }

            // 5. Record Quantity Event for Parent
            if (syncedParent.is_quantity_tracked) {
                const note = autoAssign ? `Split ${serials.join(', ')} and assigned to ${autoAssign}` : 
                             (projectId ? `Split ${serials.join(', ')} and assigned to Project ${projectId}` : 
                             `Split ${splitCount} units to individual assets`);
                
                console.log(`[SPLIT] Applying quantity event for root: ${syncedParent.quantity_root_id || syncedParent.ID}`);
                await applyQuantityEvent({
                    rootId: syncedParent.quantity_root_id || syncedParent.ID,
                    type: 'SPLIT',
                    actor: actor,
                    note: note,
                    metadata: { 
                        parentId: syncedParent.ID, 
                        splitCount: splitCount, 
                        serials: serials.join(', '),
                        assignedTo: autoAssign || (projectId ? `PROJECT:${projectId}` : null)
                    },
                    lines: [
                        { assetId: syncedParent.ID, unit: syncedParent.quantity_unit || 'pcs', deltaAvailable: -splitCount, deltaTotal: -splitCount, precision: syncedParent.quantity_precision || 0 }
                    ]
                }, trx);
            }
            
            await logAssetHistory(parentId, 'SPLIT_PARENT_UPDATED', currentSerials.join(', '), newSerials.join(', '), actor, `Split ${splitCount} units`, trx);
            
            // Re-normalize created children for frontend
            res.locals.createdAssets = createdChildren.map(c => normalizeResult(c));
        });
    } else {
        // Legacy SQLite logic (keeping it as is but adding logging)
        legacyDb.transaction(() => {
          console.log(`[SPLIT-SQLITE] Syncing parent quantity to ${currentSerials.length}`);
          legacyDb.prepare(`
            UPDATE assets 
            SET 
              quantity_total = ?, 
              quantity_available = ?, 
              quantity_unit = COALESCE(quantity_unit, 'pcs'),
              is_quantity_tracked = 1,
              quantity_root_id = COALESCE(quantity_root_id, ID)
            WHERE LOWER(ID) = LOWER(?)
          `).run(currentSerials.length, currentSerials.length, parentId);
    
          const syncedParent = legacyDb.prepare('SELECT * FROM assets WHERE LOWER(ID) = LOWER(?)').get(parentId);
    
          console.log(`[SPLIT-SQLITE] Updating parent S/Ns to: ${newSerials.join(', ')}`);
          legacyDb.prepare(`
            UPDATE assets 
            SET SrNo = ?, LastUpdated = ?
            WHERE LOWER(ID) = LOWER(?)
          `).run(newSerials.join(', '), ts, parentId);
    
          const insertChild = legacyDb.prepare(`
            INSERT INTO assets (
              ID, ItemName, Status, Make, Model, SrNo, Type, Category, Icon, 
              isPlaceholder, ParentId, CurrentLocation, DispatchReceiveDt, 
              PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR, 
              warranty_months, amc_months, asset_value, Currency, PurchaseDate, 
              conversion_unit, conversion_factor, conversion_mode, is_quantity_tracked, is_batch
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
    
          const createdChildren = [];
          serials.forEach(sn => {
            const childId = generateModernAssetId(syncedParent.CurrentLocation, syncedParent.Type);
            console.log(`[SPLIT-SQLITE] Creating child asset: ${childId} with S/N: ${sn}`);
            let status = syncedParent.Status;
            let assignedTo = syncedParent.AssignedTo;
            if (autoAssign) {
                status = 'Assigned';
                assignedTo = autoAssign;
            } else if (projectId) {
                status = 'Project';
                assignedTo = `Project: ${projectName}`;
            }
    
            insertChild.run(
              childId, syncedParent.ItemName, status, syncedParent.Make, syncedParent.Model, sn, syncedParent.Type, syncedParent.Category, syncedParent.Icon,
              0, parentId, syncedParent.CurrentLocation, syncedParent.DispatchReceiveDt,
              syncedParent.PurchaseDetails, syncedParent.Remarks, ts, null, assignedTo, syncedParent.NoQR,
              syncedParent.warranty_months, syncedParent.amc_months, syncedParent.asset_value, syncedParent.Currency, syncedParent.PurchaseDate,
              syncedParent.conversion_unit, syncedParent.conversion_factor, syncedParent.conversion_mode, 0, 0
            );
    
            if (projectId) {
              legacyDb.prepare(`
                INSERT OR REPLACE INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
                VALUES (?, ?, ?, ?)
              `).run(projectId, childId, ts, 'Permanent');
            }

            createdChildren.push({
                ID: childId, ItemName: syncedParent.ItemName, Status: status, Make: syncedParent.Make, Model: syncedParent.Model,
                SrNo: sn, Type: syncedParent.Type, Category: syncedParent.Category, Icon: syncedParent.Icon,
                AssignedTo: assignedTo
            });
          });
          res.locals.createdAssets = createdChildren;
    
          if (syncedParent.is_quantity_tracked) {
            const note = autoAssign ? `Split ${serials.join(', ')} and assigned to ${autoAssign}` : 
                         (projectId ? `Split ${serials.join(', ')} and assigned to Project ${projectId}` : 
                         `Split ${splitCount} units to individual assets`);
                         
            applyQuantityEvent({
              rootId: syncedParent.quantity_root_id || syncedParent.ID,
              type: 'SPLIT',
              actor: actor,
              note: note,
              metadata: { 
                parentId: syncedParent.ID, 
                splitCount: splitCount, 
                serials: serials.join(', '),
                assignedTo: autoAssign || (projectId ? `PROJECT:${projectId}` : null)
              },
              lines: [
                { assetId: syncedParent.ID, unit: syncedParent.quantity_unit || 'pcs', deltaAvailable: -splitCount, deltaTotal: -splitCount, precision: syncedParent.quantity_precision || 0 }
              ]
            });
          }
        })();
    }

    console.log(`[SPLIT] Successfully split ${splitCount} units from ${parentId}`);
    res.json({ success: true, count: splitCount, assets: res.locals.createdAssets });
  } catch (err) {
    console.error('[SPLIT] Fatal Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/assets/unsplit', authenticateJWT, async (req, res) => {
  try {
    const { childIds } = req.body;
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    const actor = getRequestActor(req);
    const ts = new Date().toISOString();

    if (!childIds || !Array.isArray(childIds) || childIds.length === 0) {
      return res.status(400).json({ error: 'List of Child IDs required' });
    }

    console.log(`[UNSPLIT] Request to merge children: ${childIds.join(', ')}`);

    // We use a transaction to ensure all children are merged and parent updated
    if (isPostgres) {
      await db.transaction(async (trx) => {
        // 1. Get all children and their parent info
        let children = await trx('assets').whereIn('id', childIds);
        children = normalizeResult(children);

        if (children.length === 0) throw new Error('No valid children found');

        const parentId = children[0].ParentId;
        if (!parentId) throw new Error('Selected assets do not have a parent recorded');

        // Verify all children have the same parent
        if (children.some(c => c.ParentId !== parentId)) {
          throw new Error('All selected assets must belong to the same parent');
        }

        // 2. Get the parent
        let parent = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId]).first();
        parent = normalizeResult(parent);
        if (!parent) throw new Error('Parent asset not found in database');

        const childSerials = children.map(c => c.SrNo).filter(s => s);
        const currentParentSerials = (parent.SrNo || '').split(/[\n,]+/).map(s => s.trim()).filter(s => s);
        
        // Correct way: The new parent serial list is the union of existing and child serials
        const mergedSerials = [...new Set([...currentParentSerials, ...childSerials])];
        
        // CRITICAL FIX: The quantity MUST equal the total number of serial numbers in the batch.
        // We do not "add" quantity, we "sync" it to the actual count of serial numbers.
        const correctQuantity = mergedSerials.length;
        const currentQuantity = parseFloat(parent.quantity_total) || 0;
        const delta = correctQuantity - currentQuantity;

        console.log(`[UNSPLIT] Syncing parent ${parentId}. Current Qty: ${currentQuantity}, Target Qty (S/N count): ${correctQuantity}, Delta: ${delta}`);

        // 3. Update Parent Serial Numbers
        await trx('assets')
          .whereRaw('LOWER(id) = LOWER(?)', [parentId])
          .update({
            srno: mergedSerials.join(', '),
            lastupdated: ts
          });

        // 4. Delete Children
        const lowerChildIds = childIds.map(id => id.toLowerCase());
        await trx('project_assets').whereRaw('LOWER(assetid) IN (' + lowerChildIds.map(() => '?').join(',') + ')', lowerChildIds).delete();
        await trx('assets').whereRaw('LOWER(id) IN (' + lowerChildIds.map(() => '?').join(',') + ')', lowerChildIds).delete();

        // 5. Record Quantity Event (Only if there is a delta)
        if (delta !== 0) {
          if (parent.is_quantity_tracked) {
            console.log(`[UNSPLIT] Applying sync event for parent: ${parentId}, Delta: ${delta}`);
            await applyQuantityEvent({
              rootId: parent.quantity_root_id || parent.ID,
              type: 'SYNC',
              actor: actor,
              note: `Unsplit merge: Synced quantity to match Serial Number count (${correctQuantity})`,
              metadata: { parentId, mergedChildren: childIds, previousQty: currentQuantity, newQty: correctQuantity },
              lines: [
                { assetId: parent.ID, unit: parent.quantity_unit || 'pcs', deltaAvailable: delta, deltaTotal: delta, precision: parent.quantity_precision || 0 }
              ]
            }, trx);
          } else {
              await trx('assets')
                  .whereRaw('LOWER(id) = LOWER(?)', [parentId])
                  .update({
                      quantity_total: correctQuantity,
                      quantity_available: correctQuantity
                  });
          }
        }

        await logAssetHistory(parentId, 'UNSPLIT_MERGED', childSerials.join(', '), mergedSerials.join(', '), actor, `Merged ${addedCount} children back`, trx);
      });
    } else {
      // Legacy SQLite logic
      legacyDb.transaction(() => {
        const children = legacyDb.prepare(`SELECT * FROM assets WHERE ID IN (${childIds.map(() => '?').join(',')})`).all(...childIds);
        if (children.length === 0) throw new Error('No valid children found');

        const parentId = children[0].ParentId;
        if (!parentId) throw new Error('Selected assets do not have a parent recorded');

        const parent = legacyDb.prepare('SELECT * FROM assets WHERE ID = ?').get(parentId);
        if (!parent) throw new Error('Parent asset not found');

        const childSerials = children.map(c => c.SrNo).filter(s => s);
        const currentParentSerials = (parent.SrNo || '').split(/[\n,]+/).map(s => s.trim()).filter(s => s);
        const mergedSerials = [...new Set([...currentParentSerials, ...childSerials])];
        const addedCount = childIds.length;

        legacyDb.prepare(`
          UPDATE assets 
          SET SrNo = ?, LastUpdated = ?
          WHERE ID = ?
        `).run(mergedSerials.join(', '), ts, parentId);

        legacyDb.prepare(`DELETE FROM project_assets WHERE AssetID IN (${childIds.map(() => '?').join(',')})`).run(...childIds);
        legacyDb.prepare(`DELETE FROM assets WHERE ID IN (${childIds.map(() => '?').join(',')})`).run(...childIds);

        if (parent.is_quantity_tracked) {
          applyQuantityEvent({
            rootId: parent.quantity_root_id || parent.ID,
            type: 'UNSPLIT',
            actor: actor,
            note: `Merged children: ${childIds.join(', ')} back to parent`,
            metadata: { parentId, mergedChildren: childIds },
            lines: [
              { assetId: parent.ID, unit: parent.quantity_unit || 'pcs', deltaAvailable: addedCount, deltaTotal: addedCount, precision: parent.quantity_precision || 0 }
            ]
          });
        } else {
            legacyDb.prepare(`
                UPDATE assets 
                SET quantity_total = quantity_total + ?, quantity_available = quantity_available + ?
                WHERE ID = ?
            `).run(addedCount, addedCount, parentId);
        }
      })();
    }

    res.json({ success: true, message: `Successfully merged ${childIds.length} assets back to parent` });
  } catch (err) {
    console.error('[UNSPLIT] Error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:id/available-inventory', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const isPostgres = process.env.DB_CLIENT === 'postgresql';
        
        console.log(`[INVENTORY] Fetching available inventory for project: ${id}`);
        
        // This query finds all assets that are "In Store" or "Warehouse" and NOT assigned to any project
        // Or assets that are already assigned to THIS project but might be available for other uses
        
        let assets;
        if (isPostgres) {
            assets = await db('assets as a')
                .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
                .where(function() {
                    this.where('a.status', 'In Store')
                        .orWhere('a.status', 'Warehouse')
                        .orWhere('pa.projectid', id);
                })
                .andWhere(function() {
                    this.where('a.is_deleted', 0).orWhereNull('a.is_deleted');
                })
                .select('a.id', 'a.itemname', 'a.status', 'a.make', 'a.model', 'a.type', 'a.category', 'a.icon', 'a.currency', 'a.unitprice')
                .select(db.raw('CASE WHEN pa.projectid = ? THEN 1 ELSE 0 END as is_already_assigned', [id]))
                .orderBy('a.itemname', 'asc');
            
            assets = normalizeResult(assets);
        } else {
            assets = legacyDb.prepare(`
                SELECT a.ID, a.ItemName, a.Status, a.Make, a.Model, a.Type, a.Category, a.Icon, a.Currency, a.UnitPrice,
                       CASE WHEN pa.ProjectID = ? THEN 1 ELSE 0 END as is_already_assigned
                FROM assets a
                LEFT JOIN project_assets pa ON a.ID = pa.AssetID
                WHERE (a.Status IN ('In Store', 'Warehouse') OR pa.ProjectID = ?)
                AND (a.is_deleted = 0 OR a.is_deleted IS NULL)
                ORDER BY a.ItemName ASC
            `).all(id, id);
        }
        
        res.json({ success: true, assets });
    } catch (err) {
        console.error('[INVENTORY] Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${port}`);
  console.log(`Access locally at http://localhost:${port}`);
  console.log('Server started successfully.');
});

// Set timeout to 10 minutes for long OCR jobs
server.timeout = 600000;
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
