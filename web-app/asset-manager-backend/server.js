console.log('Starting server.js...');
const express = require('express')
const path = require('path')
const qrcode = require('qrcode')
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const dns = require('dns').promises;
const Evilscan = require('evilscan');
const find = require('local-devices');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
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
  getTallyConfig
} = require('./utils')
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-in-production';
const JWT_EXPIRES_IN_SECONDS = parseInt(process.env.JWT_EXPIRES_IN_SECONDS || '3600', 10);
const JWT_COOKIE_NAME = 'auth_token';
const DEFAULT_COMPANY_NAME = 'CINEOM';
let DEFAULT_COMPANY_ID = null;

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

function buildUserClaims(user, category) {
  const companyId = user.company_id || user.client_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
  return {
    user_id: String(user.username || user.id),
    role: user.role || 'employee',
    company_id: String(companyId),
    category: category || null
  };
}

function signJwtForUser(user, category) {
  const claims = buildUserClaims(user, category);
  const payload = {
    user_id: claims.user_id,
    role: claims.role,
    company_id: claims.company_id
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
      company_id: String(decoded.company_id)
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
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

let rolePermissionCache = {};

function loadRolePermissionsIntoCache() {
  try {
    const rows = db.prepare('SELECT role_name, permission_key FROM role_permissions').all();
    const map = {};
    rows.forEach(row => {
      if (!map[row.role_name]) {
        map[row.role_name] = new Set();
      }
      map[row.role_name].add(row.permission_key);
    });
    rolePermissionCache = map;
  } catch (err) {
    console.error('Error loading role permissions into cache:', err);
    rolePermissionCache = {};
  }
}

function hasPermission(roleName, permissionKey) {
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
try {
  // Check if projects table has QRCode column
  const tableInfo = db.prepare("PRAGMA table_info(projects)").all();
  const hasQRCode = tableInfo.some(col => col.name === 'QRCode');
  if (!hasQRCode) {
    db.prepare("ALTER TABLE projects ADD COLUMN QRCode TEXT").run();
    console.log('Added QRCode column to projects table');
  }
} catch (err) {
  console.error('Migration error (projects QRCode):', err);
}
try {
  const historyTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_history'").get();
  if (!historyTable) {
    db.prepare(`
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
try {
  const dcTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='delivery_challans'").get();
  if (!dcTable) {
    db.prepare(`
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
    const cols = db.prepare("PRAGMA table_info(delivery_challans)").all();
    const hasPayload = cols.some(c => c.name === 'PayloadJSON');
    if (!hasPayload) {
      db.prepare("ALTER TABLE delivery_challans ADD COLUMN PayloadJSON TEXT").run();
      console.log('Added PayloadJSON column to delivery_challans table');
    }
  }
} catch (err) {
  console.error('Migration error (delivery_challans PayloadJSON):', err);
}

try {
  const cols = db.prepare("PRAGMA table_info(assets)").all();
  const hasCol = (name) => cols.some((c) => c.name === name);

  if (!hasCol('quantity_parent_id')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_parent_id TEXT').run();
  if (!hasCol('quantity_root_id')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_root_id TEXT').run();
  if (!hasCol('quantity_unit')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_unit TEXT').run();
  if (!hasCol('quantity_total')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_total REAL').run();
  if (!hasCol('quantity_available')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_available REAL').run();
  if (!hasCol('quantity_precision')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_precision INTEGER').run();
  if (!hasCol('quantity_updated_at')) db.prepare('ALTER TABLE assets ADD COLUMN quantity_updated_at TEXT').run();
  if (!hasCol('conversion_unit')) db.prepare('ALTER TABLE assets ADD COLUMN conversion_unit TEXT').run();
  if (!hasCol('conversion_factor')) db.prepare('ALTER TABLE assets ADD COLUMN conversion_factor REAL').run();
  if (!hasCol('conversion_mode')) db.prepare('ALTER TABLE assets ADD COLUMN conversion_mode TEXT').run();
  if (!hasCol('is_quantity_tracked')) {
    db.prepare('ALTER TABLE assets ADD COLUMN is_quantity_tracked INTEGER DEFAULT 0').run();
    // Proactively enable it for assets that already have quantity data
    db.prepare("UPDATE assets SET is_quantity_tracked = 1 WHERE quantity_unit IS NOT NULL OR quantity_total > 0").run();
  }
} catch (err) {
  console.error('Migration error (assets quantity columns):', err);
}

try {
  const cols = db.prepare("PRAGMA table_info(asset_kinds)").all();
  const hasIdentifier = cols.some(c => c.name === 'Identifier');
  if (!hasIdentifier) {
    db.prepare("ALTER TABLE asset_kinds ADD COLUMN Identifier TEXT").run();
    console.log('Added Identifier column to asset_kinds table');
  }
} catch (err) {
  console.error('Migration error (asset_kinds Identifier):', err);
}

try {
  db.exec(`
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
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasCompanyId = cols.some(c => c.name === 'company_id');
  const hasEmployeeId = cols.some(c => c.name === 'employee_id');
  const hasClientId = cols.some(c => c.name === 'client_id');
  if (!hasCompanyId) {
    db.prepare("ALTER TABLE users ADD COLUMN company_id TEXT").run();
    console.log('Added company_id column to users table');
  }
  if (!hasEmployeeId) {
    db.prepare("ALTER TABLE users ADD COLUMN employee_id TEXT").run();
    console.log('Added employee_id column to users table');
  }
   if (!hasClientId) {
    db.prepare("ALTER TABLE users ADD COLUMN client_id TEXT").run();
    console.log('Added client_id column to users table');
  }
  db.prepare("CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)").run();
  let company = db.prepare("SELECT id FROM companies WHERE name = ?").get(DEFAULT_COMPANY_NAME);
  if (!company) {
    const newId = (crypto.randomUUID && crypto.randomUUID()) || [
      crypto.randomBytes(4).toString('hex'),
      crypto.randomBytes(2).toString('hex'),
      crypto.randomBytes(2).toString('hex'),
      crypto.randomBytes(2).toString('hex'),
      crypto.randomBytes(6).toString('hex')
    ].join('-');
    db.prepare("INSERT INTO companies (id, name) VALUES (?, ?)").run(newId, DEFAULT_COMPANY_NAME);
    company = { id: newId };
    console.log('Created default company record for', DEFAULT_COMPANY_NAME);
  }
  DEFAULT_COMPANY_ID = company.id;
  db.prepare("UPDATE users SET company_id = ? WHERE company_id IS NULL OR company_id = ?").run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME);
  db.prepare("UPDATE users SET client_id = ? WHERE client_id IS NULL OR client_id = ?").run(DEFAULT_COMPANY_ID, DEFAULT_COMPANY_NAME);
} catch (err) {
  console.error('Migration error (users company_id):', err);
}

try {
  db.prepare(`
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

try {
  db.prepare(`
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

try {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS roles (
      name TEXT PRIMARY KEY,
      description TEXT
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS permissions (
      key TEXT PRIMARY KEY,
      description TEXT
    )
  `).run();
  db.prepare(`
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
  const insertRole = db.prepare("INSERT OR IGNORE INTO roles (name, description) VALUES (?, ?)");
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
    { key: 'logs.view', description: 'View change logs' }
  ];
  const insertPerm = db.prepare("INSERT OR IGNORE INTO permissions (key, description) VALUES (?, ?)");
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

    ['manager', 'module.assets.access'],
    ['manager', 'asset.view'],
    ['manager', 'asset.create'],
    ['manager', 'asset.edit'],
    ['manager', 'asset.search'],
    ['manager', 'category.create'],

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
  const insertRolePerm = db.prepare("INSERT OR IGNORE INTO role_permissions (role_name, permission_key) VALUES (?, ?)");
  db.transaction((pairs) => {
    pairs.forEach(([roleName, permKey]) => insertRolePerm.run(roleName, permKey));
  })(rolePermissionPairs);

  loadRolePermissionsIntoCache();
} catch (err) {
  console.error('Migration error (RBAC tables):', err);
}
// ---------------------------

const app = express()
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))

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

function getUserFromDb(username) {
  if (!username) return null
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username)
}

function requireAdmin(req) {
  const username = String(req.headers['x-user'] || '')
  const user = getUserFromDb(username)
  if (!user || (user.role !== 'admin' && user.role !== 'superuser')) return null
  return user
}

function getQuantityAsset(id) {
  return db.prepare(`
    SELECT
      a.ID,
      a.ItemName,
      a.Status,
      a.CurrentLocation,
      a.quantity_parent_id,
      a.quantity_root_id,
      a.quantity_unit,
      a.quantity_total,
      a.quantity_available,
      a.quantity_precision,
      a.conversion_unit,
      a.conversion_factor,
      pa.ProjectID
    FROM assets a
    LEFT JOIN project_assets pa ON a.ID = pa.AssetID
    WHERE a.ID = ?
  `).get(id)
}

const applyQuantityEvent = db.transaction((event) => {
  const now = new Date().toISOString()
  const root = getQuantityAsset(event.rootId)
  if (!root || !root.quantity_root_id || root.quantity_root_id !== event.rootId) {
    throw new Error('Invalid quantity root')
  }
  const unit = normalizeQtyUnit(root.quantity_unit)
  if (!unit) throw new Error('Root asset is missing quantity unit')

  const insertEvent = db.prepare(`
    INSERT INTO quantity_events (root_id, type, actor, timestamp, note, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `)
  const insertLine = db.prepare(`
    INSERT INTO quantity_event_lines (event_id, asset_id, unit, delta_available, delta_total)
    VALUES (?, ?, ?, ?, ?)
  `)
  const updateAsset = db.prepare(`
    UPDATE assets
    SET
      quantity_unit = COALESCE(quantity_unit, ?),
      quantity_available = COALESCE(quantity_available, 0) + ?,
      quantity_total = COALESCE(quantity_total, 0) + ?,
      quantity_updated_at = ?,
      quantity_precision = COALESCE(quantity_precision, ?)
    WHERE ID = ?
      AND quantity_root_id = ?
      AND (COALESCE(quantity_available, 0) + ?) >= 0
      AND (COALESCE(quantity_total, 0) + ?) >= 0
      AND (COALESCE(quantity_available, 0) + ?) <= (COALESCE(quantity_total, 0) + ?)
  `)

  const metadataJson = event.metadata ? JSON.stringify(event.metadata) : null
  const note = event.note ? String(event.note) : null
  const actor = event.actor ? String(event.actor) : null

  const eventResult = insertEvent.run(event.rootId, event.type, actor, now, note, metadataJson)
  const eventId = eventResult.lastInsertRowid

  for (const line of event.lines) {
    const lineUnit = normalizeQtyUnit(line.unit) || unit
    if (lineUnit !== unit) throw new Error('Unit mismatch')

    const deltaAvailable = parseQtyNumber(line.deltaAvailable) ?? 0
    const deltaTotal = parseQtyNumber(line.deltaTotal) ?? 0
    if (!Number.isFinite(deltaAvailable) || !Number.isFinite(deltaTotal)) throw new Error('Invalid quantity delta')

    insertLine.run(eventId, line.assetId, unit, deltaAvailable, deltaTotal)

    const precision = Number.isFinite(line.precision) ? line.precision : (root.quantity_precision ?? null)
    const changes = updateAsset.run(
      unit,
      deltaAvailable,
      deltaTotal,
      now,
      precision,
      line.assetId,
      event.rootId,
      deltaAvailable,
      deltaTotal,
      deltaAvailable,
      deltaTotal
    ).changes

    if (changes !== 1) {
      throw new Error('Quantity update rejected')
    }
  }

  return { eventId: Number(eventId), timestamp: now, unit }
})

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
app.get('/api/recent-activity', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT Action, User, AssetId, Details, Timestamp 
            FROM audit_log 
            ORDER BY Timestamp DESC 
            LIMIT 10
        `);
        const rows = stmt.all();
        res.json(rows);
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity log' });
    }
});

// API to get all audit logs
app.get('/api/audit-logs', (req, res) => {
    try {
        const stmt = db.prepare(`
            SELECT * FROM audit_log 
            ORDER BY Timestamp DESC
            LIMIT 1000
        `);
        const rows = stmt.all();
        res.json(rows);
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// API to export audit logs as JSON
app.get('/api/audit-logs/export/json', (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC');
        const rows = stmt.all();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.json"');
        res.send(JSON.stringify(rows, null, 2));
    } catch (err) {
        console.error('Error exporting audit logs JSON:', err);
        res.status(500).json({ error: 'Failed to export logs' });
    }
});

// API to export audit logs as Excel
app.get('/api/audit-logs/export/excel', (req, res) => {
    try {
        const stmt = db.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC');
        const rows = stmt.all();

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        XLSX.utils.book_append_sheet(wb, ws, 'Audit Logs');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

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
         const project = db.prepare('SELECT ProjectName, ClientName FROM projects WHERE ID = ?').get(asset.ProjectID);
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
            employeeEmailStmt = db.prepare(`
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
            assetUserIdStmt = db.prepare('SELECT UserID FROM asset_it_details WHERE AssetID = ?');
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
        const assets = db.prepare(`
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
                        const project = db.prepare('SELECT OwnerEmail, CoordinatorEmail FROM projects WHERE ID = ?').get(asset.ProjectID);
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

// Existing routes follow...
app.use('/js', express.static(path.join(__dirname, '../asset-manager-frontend/js')));
app.use(express.static(path.join(__dirname, '../asset-manager-frontend/dist')));
app.use('/static', express.static(path.join(__dirname, '../asset-manager-frontend/dist/static')));
app.use('/uploads', express.static(uploadsDir));
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
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/dist/index.html'));
});


// Helper to check asset assignment status
function getAssetAssignmentStatus(assetId) {
    const asset = db.prepare('SELECT AssignedTo FROM assets WHERE ID = ?').get(assetId);
    if (asset && asset.AssignedTo && asset.AssignedTo.trim() !== '') {
        return { type: 'user', assignedTo: asset.AssignedTo };
    }

    const projectLink = db.prepare(`
        SELECT pa.ProjectID, p.ProjectName, p.Status
        FROM project_assets pa
        JOIN projects p ON pa.ProjectID = p.ID
        WHERE pa.AssetID = ?
    `).get(assetId);

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

app.get('/api/assets', (req, res) => {
  try {
    const { projectId, all } = req.query;
    
    // If 'all' is requested, return all assets (flat array) for global cache
    if (all === 'true') {
        let baseQuery = `
          SELECT a.*, 
                 it.MACAddress, it.IPAddress, it.NetworkType, 
                 it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
          FROM assets a
          LEFT JOIN asset_it_details it ON a.ID = it.AssetID
        `;
        let params = [];
        
        if (projectId) {
            baseQuery += ` INNER JOIN project_assets pa ON a.ID = pa.AssetID WHERE pa.ProjectID = ?`;
            params.push(projectId);
        }
        
        baseQuery += ` ORDER BY a.LastUpdated DESC`;
        
        const assets = db.prepare(baseQuery).all(...params);
        
        // Process assets (mark components)
        const componentIds = new Set(db.prepare('SELECT ID FROM components').all().map(c => c.ID));
        const processed = assets.map(a => ({
          ...a,
          isComponent: componentIds.has(a.ID) || (a.ParentId !== null && a.ParentId !== ''),
          isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
        }));
        
        return res.json(processed);
    }

    const page = parseInt(req.query.page) || 1;
    const size = parseInt(req.query.size) || 50;
    
    // Tabulator sends sorters and filters
    let sorters = req.query.sorters || [];
    let filters = req.query.filters || [];

    // Base query
    let baseQuery = `
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
    `;
    let whereClauses = ["1=1"];
    let params = [];

    // 1. Apply Project Filter
    if (projectId) {
      baseQuery += ` INNER JOIN project_assets pa ON a.ID = pa.AssetID `;
      whereClauses.push(`pa.ProjectID = ?`);
      params.push(projectId);
    }

    // 1.5 Apply Global Search (Google-like Multi-Keyword Search)
    const search = req.query.search;
    if (search) {
        console.log('Search Request:', search);
        // Split search string into terms (space-separated)
        const terms = search.trim().split(/\s+/);
        console.log('Search Terms:', terms);
        
        terms.forEach(term => {
            const searchParam = `%${term}%`;
            whereClauses.push(`(
                a.ID LIKE ? OR 
                a.ItemName LIKE ? OR 
                a.Make LIKE ? OR 
                a.Model LIKE ? OR 
                a.SrNo LIKE ? OR 
                a.CurrentLocation LIKE ? OR 
                a.AssignedTo LIKE ? OR
                a.Type LIKE ? OR
                a.Category LIKE ? OR
                a.Status LIKE ?
            )`);
            // Push param once for each ? placeholder in the OR group
            for(let i=0; i<10; i++) params.push(searchParam);
        });
    }

    // 2. Apply Tabulator Filters
    if (Array.isArray(filters)) {
      filters.forEach(f => {
        const field = f.field;
        const value = f.value;
        const type = f.type; 

        const allowedFields = ['ID', 'ItemName', 'Status', 'Type', 'Category', 'Make', 'Model', 'SerialNo', 'CurrentLocation', 'AssignedTo'];
        if (allowedFields.includes(field)) {
            if (type === 'like') {
                whereClauses.push(`a.${field} LIKE ?`);
                params.push(`%${value}%`);
            } else if (type === '=') {
                whereClauses.push(`a.${field} = ?`);
                params.push(value);
            } else if (type === '!=') {
                whereClauses.push(`a.${field} != ?`);
                params.push(value);
            }
        }
      });
    }

    // 3. Count Total for Pagination
    const whereSql = " WHERE " + whereClauses.join(" AND ");
    const countSql = `SELECT COUNT(*) as count ${baseQuery} ${whereSql}`;
    const totalResult = db.prepare(countSql).get(...params);
    const totalRecords = totalResult ? totalResult.count : 0;
    const last_page = Math.ceil(totalRecords / size);

    // 4. Fetch Data
    let dataQuery = `
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      ${baseQuery}
      ${whereSql}
    `;

    // 5. Apply Sorters
    if (Array.isArray(sorters) && sorters.length > 0) {
        const sortClauses = sorters.map(s => {
            const field = s.field;
            const dir = s.dir.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
            if (/^[a-zA-Z0-9_]+$/.test(field)) {
                return `a.${field} ${dir}`;
            }
            return null;
        }).filter(s => s);
        
        if (sortClauses.length > 0) {
            dataQuery += ` ORDER BY ${sortClauses.join(', ')}`;
        } else {
             dataQuery += ` ORDER BY a.LastUpdated DESC`;
        }
    } else {
        dataQuery += ` ORDER BY a.LastUpdated DESC`;
    }

    // 6. Pagination
    const offset = (page - 1) * size;
    dataQuery += ` LIMIT ? OFFSET ?`;
    params.push(size, offset);

    const assets = db.prepare(dataQuery).all(...params);

    // 7. Process Assets (Mark components)
    const componentIds = new Set(db.prepare('SELECT ID FROM components').all().map(c => c.ID));
    
    const processedAssets = assets.map(a => ({
      ...a,
      isComponent: componentIds.has(a.ID) || (a.ParentId !== null && a.ParentId !== ''),
      isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
    }));

    // Return format for Tabulator Remote Pagination
    res.json({
        last_page: last_page,
        data: processedAssets,
        total_records: totalRecords
    });

  } catch (err) {
    console.error('Failed to fetch assets:', err);
    try {
        fs.appendFileSync('error.log', `${new Date().toISOString()} - Failed to fetch assets: ${err.message}\n${err.stack}\n`);
    } catch (e) {}
    res.status(500).send('Database error');
  }
});

app.get('/api/asset-details/:id', (req, res) => {
  const id = req.params.id;
  console.log(`[API] Fetching details for ID: ${id}`);
  
  try {
    // Try assets table first
    let asset = db.prepare(`
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
      WHERE a.ID = ?
    `).get(id);

    // If not found in assets, try components table
    if (!asset) {
      console.log(`[API] ID ${id} not found in assets, checking components...`);
      asset = db.prepare('SELECT * FROM components WHERE ID = ?').get(id);
      if (asset) {
        asset.isComponent = true;
      }
    }

    if (!asset) {
      console.warn(`[API] Asset/Component not found: ${id}`);
      return res.status(404).send('Asset not found');
    }

    const children = db.prepare('SELECT * FROM components WHERE ParentId = ?').all(id);
    const history = db.prepare('SELECT * FROM audit_log WHERE AssetId = ? ORDER BY Timestamp DESC').all(id);
    const parent = asset.ParentId ? db.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.ParentId) : null;

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

      quantityChildren = db.prepare('SELECT * FROM assets WHERE quantity_parent_id = ? ORDER BY LastUpdated DESC').all(id)
      quantityParent = asset.quantity_parent_id ? db.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.quantity_parent_id) : null
      quantityRoot = asset.quantity_root_id ? db.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.quantity_root_id) : null
      
      // Fetch detailed quantity events for this root
      quantityEvents = db.prepare(`
        SELECT id, root_id, type, actor, timestamp, note, metadata_json
        FROM quantity_events
        WHERE root_id = ?
        ORDER BY timestamp DESC
        LIMIT 50
      `).all(asset.quantity_root_id).map(e => ({
        ...e,
        metadata: e.metadata_json ? JSON.parse(e.metadata_json) : null
      }))
    }

    console.log(`[API] Successfully fetched details for ${id}`);
    res.json({ asset, children, history, parent, quantity, quantityChildren, quantityParent, quantityRoot, quantityEvents });
  } catch (err) {
    console.error(`[API] Error fetching asset details for ${id}:`, err);
    res.status(500).send('Database error: ' + err.message);
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
    const existingIds = new Set(db.prepare('SELECT ID FROM assets').all().map(a => a.ID));
    
    const insertStmt = db.prepare(`
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
app.get('/api/hsn', (req, res) => {
    try {
        const query = req.query.q || '';
        let sql = 'SELECT * FROM hsn_codes';
        const params = [];
        
        if (query) {
            sql += ' WHERE code LIKE ? OR description LIKE ?';
            params.push(`%${query}%`, `%${query}%`);
        }
        
        sql += ' ORDER BY code ASC LIMIT 50';
        const rows = db.prepare(sql).all(...params);
        res.json({ success: true, data: rows });
    } catch (err) {
        console.error('HSN Fetch Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/hsn', (req, res) => {
    try {
        const { code, description, gst_rate } = req.body;
        if (!code) return res.status(400).json({ success: false, error: 'HSN Code is required' });

        const stmt = db.prepare('INSERT OR REPLACE INTO hsn_codes (code, description, gst_rate) VALUES (?, ?, ?)');
        stmt.run(code, description, gst_rate || 0);
        
        res.json({ success: true, message: 'HSN Code saved successfully' });
    } catch (err) {
        console.error('HSN Save Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delivery Challan Endpoints
app.get('/api/dc', (req, res) => {
  const dcs = db.prepare('SELECT * FROM delivery_challans ORDER BY Timestamp DESC').all();
  res.json(dcs);
});

app.get('/api/dc/:id', (req, res) => {
  try {
    const id = req.params.id;
    // Search by either internal ID or user-facing ChallanNo
    const row = db.prepare('SELECT * FROM delivery_challans WHERE ID = ? OR ChallanNo = ?').get(id, id);
    if (!row) return res.status(404).json({ success: false, error: 'DC not found' });

    let payload = null;
    try {
      payload = row.PayloadJSON ? JSON.parse(row.PayloadJSON) : null;
    } catch {
      payload = null;
    }

    let assetIds = [];
    try {
      assetIds = row.AssetIds ? JSON.parse(row.AssetIds) : [];
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
    const { CustomerName, DeliveryDate, AssetIds, CreatedBy, payload } = req.body || {};
    // 1. Prepare Data (Sync)
    const normalizedAssetIds = Array.isArray(AssetIds) ? AssetIds : [];
    const assetsForDc = normalizedAssetIds.map((assetId) => {
      const row = db.prepare(`
        SELECT ID, ItemName, quantity_root_id, quantity_parent_id, quantity_unit, quantity_total, quantity_available, quantity_precision
        FROM assets
        WHERE ID = ?
      `).get(assetId)
      return row || { ID: assetId }
    });

    // 2. Atomic Transaction: Get Next ID -> Insert Placeholder
    const createResult = db.transaction(() => {
        const year = new Date().getFullYear();
        let nextSeq = 1;
        try {
            const lastDc = db.prepare(`SELECT ChallanNo FROM delivery_challans WHERE ChallanNo LIKE 'DC/${year}/%' ORDER BY Timestamp DESC LIMIT 1`).get();
            if (lastDc && lastDc.ChallanNo) {
                const parts = lastDc.ChallanNo.split('/');
                if (parts.length === 3) {
                    const lastSeq = parseInt(parts[2], 10);
                    if (!isNaN(lastSeq)) {
                        nextSeq = lastSeq + 1;
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching last DC number:', err);
            nextSeq = Math.floor(1000 + Math.random() * 9000); 
        }
        
        const challanNo = `DC/${year}/${String(nextSeq).padStart(4, '0')}`;
        const id = `DC${Date.now()}`;
        
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

        db.prepare(`
          INSERT INTO delivery_challans (ID, ChallanNo, CustomerName, DeliveryDate, AssetIds, Status, QRCode, CreatedBy, Timestamp, PayloadJSON)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          challanNo,
          CustomerName || '',
          DeliveryDate || '',
          JSON.stringify(normalizedAssetIds),
          'Initializing', // Temporary status
          '', // Empty QR initially
          CreatedBy || 'System',
          new Date().toISOString(),
          JSON.stringify(initialPayload)
        );

        return { id, challanNo, payload: initialPayload };
    })();

    const { id, challanNo, payload: dcPayload } = createResult;

    // 3. Generate QR Code (Async)
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

    // 4. Update Record with QR Code & Final Status
    db.prepare(`UPDATE delivery_challans SET QRCode = ?, Status = 'Pending' WHERE ID = ?`).run(qrCode, id);

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

// DC Remark Templates Endpoints
app.get('/api/dc-remarks', (req, res) => {
    try {
        const table = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='dc_remark_templates'").get();
        if (!table) {
            db.prepare(`
                CREATE TABLE dc_remark_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT,
                    updated_at TEXT
                )
            `).run();
        }
        const templates = db.prepare('SELECT * FROM dc_remark_templates ORDER BY title ASC').all();
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
        const stmt = db.prepare('INSERT INTO dc_remark_templates (title, content, created_at, updated_at) VALUES (?, ?, ?, ?)');
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
        const stmt = db.prepare('UPDATE dc_remark_templates SET title = ?, content = ?, updated_at = ? WHERE id = ?');
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
        const stmt = db.prepare('DELETE FROM dc_remark_templates WHERE id = ?');
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
app.get('/api/employees', (req, res) => {
  try {
    const { page, size, search, all, department } = req.query;

    // If 'all' is requested, return all employees (for dropdowns/lookups)
    if (all === 'true') {
        const employees = db.prepare('SELECT * FROM employees ORDER BY Name ASC').all();
        return res.json(employees);
    }

    // Pagination logic
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 20; // Default to 20 for cards view
    const offset = (pageNum - 1) * sizeNum;
    
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
    const totalResult = db.prepare(countSql).get(...params);
    const totalRecords = totalResult ? totalResult.count : 0;
    const lastPage = Math.ceil(totalRecords / sizeNum);

    // Fetch data
    const dataSql = `SELECT * ${baseQuery} ${whereSql} ORDER BY Name ASC LIMIT ? OFFSET ?`;
    params.push(sizeNum, offset);
    
    const employees = db.prepare(dataSql).all(...params);

    res.json({
        data: employees,
        last_page: lastPage,
        total_records: totalRecords,
        page: pageNum,
        size: sizeNum
    });

  } catch (err) {
    console.error('Failed to fetch employees:', err);
    res.status(500).send('Database error');
  }
});

// --- Department Quotas ---
db.prepare(`
    CREATE TABLE IF NOT EXISTS department_quotas (
        Department TEXT,
        Category TEXT,
        Quota INTEGER,
        PRIMARY KEY (Department, Category)
    )
`).run();

app.get('/api/quotas', (req, res) => {
    try {
        const quotas = db.prepare('SELECT * FROM department_quotas').all();
        res.json(quotas);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/quotas', (req, res) => {
    const { department, category, quota } = req.body;
    try {
        const stmt = db.prepare('INSERT OR REPLACE INTO department_quotas (Department, Category, Quota) VALUES (?, ?, ?)');
        stmt.run(department, category, quota);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/api/quotas/:dept/:cat', (req, res) => {
    try {
        const stmt = db.prepare('DELETE FROM department_quotas WHERE Department = ? AND Category = ?');
        stmt.run(req.params.dept, req.params.cat);
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Get employee asset history
app.get('/api/employees/:name/history', (req, res) => {
    const name = req.params.name;
    console.log(`[DEBUG] Fetching history for employee: [${name}]`);
    try {
        const stmt = db.prepare(`
            SELECT a.AssetId, a.Timestamp, a.Details, assets.ItemName, assets.Model
            FROM audit_log a
            LEFT JOIN assets ON a.AssetId = assets.ID
            WHERE (a.Action = 'ASSIGN' OR a.Action = 'BULK_ASSIGN' OR a.Action = 'RETURN')
            AND (a.Details LIKE ? OR a.Details LIKE ?)
            ORDER BY a.Timestamp DESC
        `);
        
        const history = stmt.all(`%${name}%`, `% "${name}" %`);
        console.log(`[DEBUG] Found ${history.length} history records for employee: ${name}`);
        res.json(history);
    } catch (err) {
        console.error('[ERROR] Error fetching employee history:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', (req, res) => {
  try {
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;
    if (!Name || !EmployeeID) return res.status(400).send('Name and EmployeeID are required');

    const id = `EMP${Date.now()}`;
    const stmt = db.prepare(`
      INSERT INTO employees (ID, EmployeeID, Name, Department, Designation, Email, Phone, Status, LastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(id, EmployeeID, Name, Department || '', Designation || '', Email || '', Phone || '', Status || 'ACTIVE', new Date().toISOString());
    res.json({ success: true, id });
  } catch (err) {
    console.error('Failed to create employee:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/api/employees/bulk', (req, res) => {
  try {
    const employees = req.body;
    if (!Array.isArray(employees)) {
      return res.status(400).send('Expected an array of employees');
    }

    const timestamp = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO employees (ID, EmployeeID, Name, Department, Designation, Email, Phone, Status, LastUpdated)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((empList) => {
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
    res.json({ success: true, count: employees.length });
  } catch (err) {
    console.error('Bulk employee upload error:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.put('/api/employees/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;

    const stmt = db.prepare(`
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
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update employee:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/employees/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = db.prepare('DELETE FROM employees WHERE ID = ?').run(id);
    if (result.changes === 0) return res.status(404).send('Employee not found');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete employee:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/asset_kinds', (req, res) => {
  try {
    const kinds = db.prepare('SELECT * FROM asset_kinds').all();
    res.json(kinds);
  } catch (err) {
    console.error('Failed to fetch asset kinds:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/folders', (req, res) => {
  try {
    const folders = db.prepare('SELECT * FROM folders ORDER BY "Order" ASC').all();
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
    const stmt = db.prepare(`
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

    const stmt = db.prepare(`
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

app.post('/api/login', async (req, res) => {
  const { username, password, category } = req.body || {};
  console.log(`Login attempt for user: ${username} (Category: ${category})`);
  if (!username || !password) {
    return res.status(400).json({ ok: false, message: 'Username and password are required' });
  }
  try {
    const user = getUserFromDb(username);
    if (!user) {
      console.log('Login failed');
      return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    }
    const stored = user.password || '';
    let passwordMatch = false;
    if (stored && typeof stored === 'string' && stored.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, stored);
    } else {
      if (stored === password) {
        passwordMatch = true;
        const newHash = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET password = ? WHERE username = ?').run(newHash, user.username);
      }
    }
    if (!passwordMatch) {
      console.log('Login failed');
      return res.status(401).json({ ok: false, message: 'Invalid credentials' });
    }
    console.log('Login successful');
    return res.json({
      ok: true,
      user: {
        username: user.username,
        fullname: user.fullname,
        role: user.role,
        projectId: user.project_id,
        clientId: user.client_id,
        category
      }
    });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const body = req.body || {};
  const username = body.username;
  const password = body.password;
  const category = body.category;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  try {
    const user = getUserFromDb(username);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const stored = user.password || '';
    let passwordMatch = false;
    if (stored && typeof stored === 'string' && stored.startsWith('$2')) {
      passwordMatch = await bcrypt.compare(password, stored);
    } else {
      if (stored === password) {
        passwordMatch = true;
        const newHash = await bcrypt.hash(password, 12);
        db.prepare('UPDATE users SET password = ? WHERE username = ?').run(newHash, user.username);
      }
    }
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const signed = signJwtForUser(user, category);
    res.cookie(JWT_COOKIE_NAME, signed.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: JWT_EXPIRES_IN_SECONDS * 1000
    });
    return res.json({
      ok: true,
      token: signed.token,
      user: {
        id: signed.claims.user_id,
        username: user.username,
        fullname: user.fullname,
        role: signed.claims.role,
        projectId: user.project_id,
        clientId: user.client_id,
        category: signed.claims.category
      }
    });
  } catch (err) {
    console.error('Auth login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.cookie(JWT_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    expires: new Date(0)
  });
  res.json({ ok: true });
});

app.get('/api/auth/me', authenticateJWT, (req, res) => {
  try {
    const userRow = db.prepare('SELECT username, fullname, role, client_id, project_id FROM users WHERE username = ?').get(req.user.user_id);
    if (!userRow) {
      return res.status(404).json({ error: 'User not found' });
    }
    return res.json({
      ok: true,
      user: {
        id: req.user.user_id,
        username: userRow.username,
        fullname: userRow.fullname,
        role: userRow.role,
        clientId: userRow.client_id,
        projectId: userRow.project_id
      }
    });
  } catch (err) {
    console.error('Auth me error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/tenant/users', authenticateJWT, authorizeRoles('admin', 'manager', 'superuser'), requirePermission('user.manage'), (req, res) => {
  try {
    const companyId = req.user.company_id;
    const users = db.prepare('SELECT username, fullname, role FROM users WHERE company_id = ?').all(companyId);
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
    const existing = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (existing) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    db.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(username, passwordHash, fullname || username, requestedRole, employeeId || null, companyId, companyId);
    
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

app.put('/api/tenant/users/:username/role', authenticateJWT, authorizeRoles('admin', 'superuser'), requirePermission('user.manage'), (req, res) => {
  try {
    const targetUsername = req.params.username;
    const { role } = req.body || {};
    if (!targetUsername || !role) {
      return res.status(400).json({ ok: false, message: 'Username and role are required' });
    }
    const companyId = req.user.company_id;

    if (role === 'superuser' && req.user.role !== 'superuser' && String(targetUsername) !== String(req.user.user_id)) {
      const existingSuper = db
        .prepare('SELECT username FROM users WHERE company_id = ? AND role = ? LIMIT 1')
        .get(companyId, 'superuser');

      if (existingSuper) {
        return res.status(403).json({ ok: false, message: 'Only an existing superuser can assign superuser role' });
      }
    }

    const info = db.prepare('UPDATE users SET role = ? WHERE username = ?')
      .run(role, targetUsername);
    if (!info.changes) {
      return res.status(404).json({ ok: false, message: 'User not found for this company' });
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

app.delete('/api/tenant/users/:username', authenticateJWT, authorizeRoles('admin', 'superuser'), requirePermission('user.manage'), (req, res) => {
  try {
    const targetUsername = req.params.username;
    if (!targetUsername) {
      return res.status(400).json({ ok: false, message: 'Username is required' });
    }
    if (String(req.user.user_id) === String(targetUsername)) {
      return res.status(400).json({ ok: false, message: 'You cannot delete your own account' });
    }
    const companyId = req.user.company_id;
    const info = db.prepare('DELETE FROM users WHERE username = ? AND company_id = ?')
      .run(targetUsername, companyId);
    if (!info.changes) {
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

app.get('/api/company', authenticateJWT, (req, res) => {
  try {
    const companyId = req.user.company_id;
    if (!companyId) {
      return res.status(400).json({ ok: false, message: 'Missing company id in token' });
    }
    const row = db.prepare('SELECT name, created_at FROM companies WHERE id = ?').get(companyId);
    if (!row) {
      return res.json({
        ok: true,
        company: { name: DEFAULT_COMPANY_NAME }
      });
    }
    return res.json({
      ok: true,
      company: {
        name: row.name,
        createdAt: row.created_at
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
    const existingUser = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const fullname = email || username;
    const role = 'user';
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    const stmt = db.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(username, passwordHash, fullname, role, employeeId || null, companyId, companyId);
    console.log(`User ${username} created successfully`);
    res.json({ ok: true, message: 'User registered successfully' });
  } catch (err) {
    console.error('Signup error:', err);
    const msg = (err && err.message) ? err.message : 'Unknown error';
    res.status(500).json({ ok: false, message: msg });
  }
});

// Network Credentials API
app.get('/api/network/credentials', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), (req, res) => {
  try {
    const creds = db.prepare('SELECT * FROM network_credentials ORDER BY device_name').all();
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
    
    db.prepare(`
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

    const info = db.prepare(`
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
    const info = db.prepare('DELETE FROM network_credentials WHERE id = ?').run(id);

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
    const contacts = db.prepare('SELECT * FROM network_contacts ORDER BY service').all();
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
    
    db.prepare(`
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

    const info = db.prepare(`
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
    const info = db.prepare('DELETE FROM network_contacts WHERE id = ?').run(id);

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
    const existingUser = db.prepare('SELECT username FROM users WHERE username = ?').get(username);
    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    const stmt = db.prepare('INSERT INTO users (username, password, fullname, role, employee_id, company_id, client_id) VALUES (?, ?, ?, ?, ?, ?, ?)');
    stmt.run(username, passwordHash, fullname || username, requestedRole, employeeId || null, companyId, companyId);
    return res.json({ ok: true, message: 'User created successfully' });
  } catch (err) {
    console.error('Error creating user:', err);
    return res.status(500).json({ ok: false, message: 'Internal server error while creating user' });
  }
});

app.get('/api/users', (req, res) => {
    try {
        const users = db.prepare('SELECT username, fullname, role FROM users').all();
        res.json({ ok: true, users });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ ok: false, message: 'Database error' });
    }
});

app.post('/api/users/update-role', (req, res) => {
    const { username, role } = req.body;
    if (!username || !role) {
        return res.status(400).json({ ok: false, message: 'Username and role are required' });
    }
    
    try {
        const stmt = db.prepare('UPDATE users SET role = ? WHERE username = ?');
        const info = stmt.run(role, username);
        
        if (info.changes > 0) {
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

const STATIC_IP = process.env.STATIC_IP || '192.168.6.59'; // User preferred static IP

app.get('/api/qr/dynamic/asset/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Prefer STATIC_IP if configured, otherwise fallback to detected IP
    const ip = STATIC_IP || getLocalIP();
    const port = process.env.PORT || 8080;
    
    // Generate URL-based QR code for compatibility with standard camera apps
    // Point to the dedicated public asset view instead of the main app
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(id)}`;
    
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
    // Prefer STATIC_IP if configured
    const ip = STATIC_IP || getLocalIP();
    const port = process.env.PORT || 8080;
    
    // URL for project details (Public View)
    const urlText = `http://${ip}:${port}/project/${encodeURIComponent(id)}`;
    
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

app.post('/api/assets', async (req, res) => {
  try {
    const asset = req.body;
    
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
      const existing = db.prepare('SELECT ID FROM assets WHERE ID = ?').get(newId);
      if (existing) {
        return res.status(400).json({ success: false, error: `Asset ID ${newId} already exists` });
      }
    }

    // Generate QR Code if not present and NoQR is not true
    let qrCode = asset.QRCode;
    if (!qrCode && !asset.NoQR) {
      const ip = getLocalIP();
      const port = process.env.PORT || 8080;
      // Direct URL to open asset details in the public view
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`;
      qrCode = await qrcode.toDataURL(urlText, { width: 512 });
    }

    const stmt = db.prepare(`
      INSERT INTO assets (
        ID, ItemName, Status, Make, Model, SrNo, Type,
        Category, Icon, isPlaceholder, ParentId,
        CurrentLocation,
        DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
        warranty_months, amc_months, asset_value, Currency, PurchaseDate,
        conversion_unit, conversion_factor, conversion_mode,
        is_quantity_tracked
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      newId,
      asset.ItemName || '',
      asset.Status || 'In Store',
      asset.Make || '',
      asset.Model || '',
      asset.SrNo || '',
      asset.Type || '',
      asset.Category || '',
      asset.Icon || '',
      0, // isPlaceholder
      asset.ParentId || null,
      asset.CurrentLocation || '',
      asset.DispatchReceiveDt || '',
      asset.PurchaseDetails || '',
      asset.Remarks || '',
      new Date().toISOString(),
      qrCode || null,
      asset.AssignedTo || '',
      asset.NoQR ? 1 : 0,
      asset.warranty_months || 0,
      asset.amc_months || 0,
      asset.asset_value || 0,
      asset.Currency || 'USD',
      asset.PurchaseDate || '',
      asset.conversion_unit || null,
      asset.conversion_factor || null,
      asset.conversion_mode || 'multiply',
      asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0
    );

    const qtyUnit = normalizeQtyUnit(asset.quantity_unit || asset.quantityUnit || asset.qty_unit || asset.qtyUnit)
    const qtyTotal = parseQtyNumber(asset.quantity_total ?? asset.quantityTotal ?? asset.qty_total ?? asset.qtyTotal)
    const qtyPrecision = parseQtyNumber(asset.quantity_precision ?? asset.quantityPrecision ?? asset.qty_precision ?? asset.qtyPrecision)
    const isQtyTracked = asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0;

    if (isQtyTracked && qtyUnit && qtyTotal !== null && qtyTotal > 0) {
      db.prepare(`
        UPDATE assets
        SET
          quantity_root_id = ?,
          quantity_unit = ?,
          quantity_total = 0,
          quantity_available = 0,
          quantity_precision = ?,
          quantity_updated_at = ?,
          is_quantity_tracked = 1
        WHERE ID = ?
      `).run(newId, qtyUnit, qtyPrecision, new Date().toISOString(), newId)

      applyQuantityEvent({
        rootId: newId,
        type: 'INIT',
        actor: getRequestActor(req),
        note: asset.quantity_note || asset.quantityNote || null,
        metadata: { source: 'asset_create' },
        lines: [
          { assetId: newId, unit: qtyUnit, deltaAvailable: qtyTotal, deltaTotal: qtyTotal, precision: qtyPrecision }
        ]
      })
    }

    // Save IT details to separate table if any exist
    if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
      db.prepare(`
        INSERT OR REPLACE INTO asset_it_details (
          AssetID, MACAddress, IPAddress, NetworkType, PhysicalPort, VLAN, SocketID, UserID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId,
        asset.MACAddress || '',
        asset.IPAddress || '',
        asset.NetworkType || '',
        asset.PhysicalPort || '',
        asset.VLAN || '',
        asset.SocketID || '',
        asset.UserID || ''
      );
    }

    // Handle nested components (new child assets)
    if (Array.isArray(asset.components) && asset.components.length > 0) {
      const compStmt = db.prepare(`
        INSERT INTO components (
          ID, ParentId, ItemName, Make, Model, SrNo, Status, Type,
          Category, LastUpdated, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of asset.components) {
        const compId = generateModernAssetId(asset.CurrentLocation || '');
        compStmt.run(
          compId,
          newId, // ParentId
          comp.ItemName || '',
          comp.Make || '',
          comp.Model || '',
          comp.SrNo || '',
          comp.Status || asset.Status || 'In Store',
          comp.Type || 'Component',
          comp.Category || asset.Category || '',
          new Date().toISOString(),
          1 // NoQR = true
        );
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds) && asset.linkedIds.length > 0) {
      const compStmt = db.prepare(`
        INSERT OR REPLACE INTO components (
          ID, ParentId, ItemName, Make, Model, SrNo, Status, Type,
          Category, LastUpdated, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const getAssetStmt = db.prepare('SELECT * FROM assets WHERE ID = ?');
      const checkComponentStmt = db.prepare('SELECT ParentId FROM components WHERE ID = ?');

      for (const linkId of asset.linkedIds) {
        const existingAsset = getAssetStmt.get(linkId);
        if (!existingAsset) continue;

        // Validation: Check if asset is already assigned to a parent
        const existingParentInAssets = existingAsset.ParentId;
        const existingComp = checkComponentStmt.get(linkId);
        const existingParentInComps = existingComp ? existingComp.ParentId : null;

        if ((existingParentInAssets && existingParentInAssets !== newId) || 
            (existingParentInComps && existingParentInComps !== newId)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          // Note: Since this is a new asset, we might want to be careful about returning 400 here
          // as the main asset was already created. But it's better to be consistent.
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        compStmt.run(
          linkId,
          newId,
          existingAsset.ItemName,
          existingAsset.Make || '',
          existingAsset.Model || '',
          existingAsset.SrNo || '',
          existingAsset.Status || 'In Store',
          existingAsset.Type || 'Component',
          existingAsset.Category || '',
          new Date().toISOString(),
          0 // NoQR = false (it's a QR asset)
        );
        // Update ParentId in assets table instead of clearing it
        db.prepare('UPDATE assets SET ParentId = ? WHERE ID = ?').run(newId, linkId);
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
    const existing = db.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    let qrCode = child.QRCode || null
    const noQr = child.NoQR ? 1 : 0
    if (!qrCode && !noQr) {
      const ip = getLocalIP()
      const port = process.env.PORT || 8080
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
      qrCode = await qrcode.toDataURL(urlText, { width: 512 })
    }

    const splitTx = db.transaction(() => {
      const insert = db.prepare(`
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
        db.prepare(`
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
    const existing = db.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 8080
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const issueTx = db.transaction(() => {
      const insert = db.prepare(`
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
        db.prepare(`
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
    const existing = db.prepare('SELECT 1 FROM assets WHERE ID = ?').get(newId)
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 8080
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const consumeTx = db.transaction(() => {
      const insert = db.prepare(`
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
        db.prepare(`
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

app.get('/api/quantity/events/:rootId', (req, res) => {
  try {
    const rootId = String(req.params.rootId || '').trim()
    if (!rootId) return res.status(400).json({ success: false, error: 'rootId is required' })

    const root = getQuantityAsset(rootId)
    if (!root || root.quantity_root_id !== rootId) {
      return res.status(404).json({ success: false, error: 'Quantity root not found' })
    }

    const events = db.prepare(`
      SELECT id, root_id, type, actor, timestamp, note, metadata_json
      FROM quantity_events
      WHERE root_id = ?
      ORDER BY id ASC
      LIMIT 2000
    `).all(rootId)

    const lines = db.prepare(`
      SELECT event_id, asset_id, unit, delta_available, delta_total
      FROM quantity_event_lines
      WHERE event_id IN (SELECT id FROM quantity_events WHERE root_id = ?)
      ORDER BY event_id ASC
    `).all(rootId)

    const linesByEvent = new Map()
    for (const l of lines) {
      const arr = linesByEvent.get(l.event_id) || []
      arr.push(l)
      linesByEvent.set(l.event_id, arr)
    }

    res.json({
      success: true,
      rootId,
      events: events.map((e) => ({
        ...e,
        metadata: e.metadata_json ? JSON.parse(e.metadata_json) : null,
        lines: linesByEvent.get(e.id) || []
      }))
    })
  } catch (err) {
    console.error('Quantity events fetch failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.get('/api/quantity/replay/:rootId', (req, res) => {
  try {
    const rootId = String(req.params.rootId || '').trim()
    if (!rootId) return res.status(400).json({ success: false, error: 'rootId is required' })

    const root = getQuantityAsset(rootId)
    if (!root || root.quantity_root_id !== rootId) {
      return res.status(404).json({ success: false, error: 'Quantity root not found' })
    }

    const rows = db.prepare(`
      SELECT asset_id, unit,
             SUM(delta_available) AS delta_available_sum,
             SUM(delta_total) AS delta_total_sum
      FROM quantity_event_lines
      WHERE event_id IN (SELECT id FROM quantity_events WHERE root_id = ?)
      GROUP BY asset_id, unit
    `).all(rootId)

    const balances = rows.map((r) => ({
      assetId: r.asset_id,
      unit: r.unit,
      availableFromEvents: r.delta_available_sum || 0,
      totalFromEvents: r.delta_total_sum || 0
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
    const checkStmt = db.prepare('SELECT ID FROM assets WHERE ID = ?');
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

    const insertAssetStmt = db.prepare(`
      INSERT INTO assets (
        ID, ItemName, Status, Make, Model, SrNo, Type,
        Category, Icon, isPlaceholder, ParentId,
        CurrentLocation,
        DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
        warranty_months, amc_months, asset_value, Currency, PurchaseDate, warranty_tracking
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertItStmt = db.prepare(`
      INSERT OR REPLACE INTO asset_it_details (
        AssetID, MACAddress, IPAddress, NetworkType, PhysicalPort, VLAN, SocketID, UserID
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = db.transaction((assetsList) => {
      for (const asset of assetsList) {
        insertAssetStmt.run(
          asset.ID,
          asset.ItemName || '',
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
        const projects = db.prepare(`
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
        const port = process.env.PORT || 8080;
        
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

        const stmt = db.prepare(`
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
        const assets = db.prepare(`
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
app.get('/api/external/stats', checkApiKey, (req, res) => {
    try {
        const stats = {
            totalAssets: db.prepare('SELECT COUNT(*) as count FROM assets').get().count,
            totalProjects: db.prepare('SELECT COUNT(*) as count FROM projects').get().count,
            activeProjects: db.prepare("SELECT COUNT(*) as count FROM projects WHERE Status = 'Active'").get().count,
            assetsInUse: db.prepare("SELECT COUNT(*) as count FROM assets WHERE Status = 'In Use'").get().count
        };
        res.json({ success: true, data: stats });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- Project Management Endpoints ---

app.get('/api/projects', (req, res) => {
    try {
        const { projectId } = req.query;
        let query = `
            SELECT ID, ProjectName as Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, 
                   OwnerEmail, CoordinatorEmail, Timestamp, QRCode,
                   ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
                   BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
            FROM projects
        `;
        let params = [];

        if (projectId) {
            query += ' WHERE ID = ?';
            params.push(projectId);
        }

        query += ' ORDER BY Timestamp DESC';
        const projects = db.prepare(query).all(...params);
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects', async (req, res) => {
    try {
        const { 
            name, client, location, currency, description, status, startDate, endDate, 
            createdBy, ownerEmail, coordinatorEmail,
            consigneeName, consigneeAddress, consigneeGSTIN, consigneeState, consigneeStateCode,
            buyerName, buyerAddress, buyerGSTIN, buyerState, buyerStateCode
        } = req.body;
        
        // Use the new standardized Project ID generator
        const id = generateProjectId(location || 'MUMBAI');
        
        const ip = getLocalIP();
        const port = process.env.PORT || 8080;
        
        // Use the new standardized Project QR payload generator
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
            CoordinatorEmail: coordinatorEmail
        }, ip, port);
        
        const qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });

        const stmt = db.prepare(`
            INSERT INTO projects (
                ID, ProjectName, ClientName, Location, Currency, Description, Status, StartDate, EndDate, 
                CreatedBy, OwnerEmail, CoordinatorEmail, Timestamp, QRCode,
                ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
                BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const ts = new Date().toISOString();
        stmt.run(
            id, name || '', client || '', location || 'MUMBAI', currency || 'INR', description || '', status || 'Planning', startDate || '', endDate || '', 
            createdBy || 'System', ownerEmail || '', coordinatorEmail || '', ts, qrCode,
            consigneeName || '', consigneeAddress || '', consigneeGSTIN || '', consigneeState || '', consigneeStateCode || '',
            buyerName || '', buyerAddress || '', buyerGSTIN || '', buyerState || '', buyerStateCode || ''
        );

        // Record initial project history
        db.prepare(`
          INSERT INTO project_history (ProjectID, Status, Note, Timestamp)
          VALUES (?, ?, ?, ?)
        `).run(id, status || 'Planning', 'Project initialized', ts);

        res.json({ success: true, id });
    } catch (err) {
        console.error('Failed to create project:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id', (req, res) => {
    try {
        const { id } = req.params;
        const project = db.prepare(`
            SELECT ID, ProjectName as Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, 
                   OwnerEmail, CoordinatorEmail, Timestamp, QRCode,
                   ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
                   BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
            FROM projects WHERE ID = ?
        `).get(id);
        if (!project) return res.status(404).send('Project not found');
        res.json(project);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/history', (req, res) => {
    try {
        const { id } = req.params;
        const rows = db.prepare('SELECT ID, ProjectID, Status, Note, Timestamp FROM project_history WHERE ProjectID = ? ORDER BY Timestamp ASC').all(id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/orders', (req, res) => {
    try {
        const { id } = req.params;
        const rows = db.prepare('SELECT * FROM project_orders WHERE ProjectID = ? ORDER BY Timestamp DESC').all(id);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/orders', (req, res) => {
    try {
        const { id } = req.params;
        const { 
            OrderNo, OrderDate, 
            ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
            BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode
        } = req.body;

        const orderId = `ORD-${Date.now()}-${Math.floor(Math.random()*1000)}`;
        const ts = new Date().toISOString();

        const stmt = db.prepare(`
            INSERT INTO project_orders (
                ID, ProjectID, OrderNo, OrderDate,
                ConsigneeName, ConsigneeAddress, ConsigneeGSTIN, ConsigneeState, ConsigneeStateCode,
                BuyerName, BuyerAddress, BuyerGSTIN, BuyerState, BuyerStateCode,
                CreatedBy, Timestamp
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
            orderId, id, OrderNo, OrderDate,
            ConsigneeName || '', ConsigneeAddress || '', ConsigneeGSTIN || '', ConsigneeState || '', ConsigneeStateCode || '',
            BuyerName || '', BuyerAddress || '', BuyerGSTIN || '', BuyerState || '', BuyerStateCode || '',
            'System', ts
        );

        res.json({ success: true, id: orderId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:projectId/orders/:orderId', (req, res) => {
    try {
        const { projectId, orderId } = req.params;
        const result = db.prepare('DELETE FROM project_orders WHERE ID = ? AND ProjectID = ?').run(orderId, projectId);
        if (result.changes === 0) return res.status(404).json({ error: 'Order not found' });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/projects/:id', async (req, res) => {
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
            'BuyerName', 'BuyerAddress', 'BuyerGSTIN', 'BuyerState', 'BuyerStateCode'
        ];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0 && !updates.status) {
             // Backward compatibility for old simple status updates
             if (updates.status) {
                 fields.push('Status');
                 updates.Status = updates.status;
             } else {
                 return res.status(400).json({ error: 'No valid fields to update' });
             }
        }

        // Map status to Status if needed
        if (updates.status && !updates.Status) {
            updates.Status = updates.status;
            if (!fields.includes('Status')) fields.push('Status');
        }

        const existing = db.prepare('SELECT Status FROM projects WHERE ID = ?').get(id);

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const params = fields.map(field => updates[field]);
        params.push(id);

        const stmt = db.prepare(`UPDATE projects SET ${setClause} WHERE ID = ?`);
        const result = stmt.run(...params);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        // Record status change in history if applicable
        if (existing && updates.Status && updates.Status !== existing.Status) {
            db.prepare(`
              INSERT INTO project_history (ProjectID, Status, Note, Timestamp)
              VALUES (?, ?, ?, ?)
            `).run(id, updates.Status, `Status changed from ${existing.Status || 'Unknown'} to ${updates.Status}`, new Date().toISOString());
        }

        // Regenerate QR code if name, client, location, status, or contact info changed
        const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
        if (fields.some(f => relevantFields.includes(f))) {
            try {
                const project = db.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
                if (project) {
                    const ip = getLocalIP();
                    const port = process.env.PORT || 8080;
                    
                    // Use the new standardized Project QR payload generator
                    const qrPayload = generateProjectQRPayload(project, ip, port);
                    
                    const qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });
                    db.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
                }
            } catch (qrErr) {
                console.error('Failed to regenerate project QR code:', qrErr);
            }
        }

        appendAudit({ 
            Action: 'UPDATE_PROJECT', 
            User: req.headers['x-user'] || 'web', 
            AssetId: id, 
            Severity: 'INFO', 
            Details: `Project updated: ${fields.join(', ')}` 
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update project:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/assets', (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Fetching assets for project: ${id}`);
        const assets = db.prepare(`
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
        console.log(`Found ${assets.length} assets for project ${id}`);
        res.json(assets);
    } catch (err) {
        console.error('Error fetching project assets:', err);
        // Log to file for extra visibility
        try {
            fs.appendFileSync('error.log', `${new Date().toISOString()} - Error fetching project assets for ${req.params.id}: ${err.message}\n${err.stack}\n`);
        } catch (e) {}
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/assign-asset', (req, res) => {
    try {
        const { id } = req.params;
        const { AssetID, Type } = req.body;

        // Validation logic for project assignment
        const status = getAssetAssignmentStatus(AssetID);
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

        const stmt = db.prepare(`
            INSERT OR REPLACE INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
            VALUES (?, ?, ?, ?)
        `);
        stmt.run(id, AssetID, new Date().toISOString(), Type || 'Permanent');
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id/unassign-asset/:assetId', (req, res) => {
    try {
        const { id, assetId } = req.params;
        db.prepare('DELETE FROM project_assets WHERE ProjectID = ? AND AssetID = ?').run(id, assetId);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/create-user', (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, fullname } = req.body;
        
        const project = db.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
        if (!project) return res.status(404).send('Project not found');

        db.prepare(`
            INSERT INTO users (username, password, fullname, role, project_id, client_id)
            VALUES (?, ?, ?, 'client', ?, ?)
        `).run(username, password, fullname || project.ClientName, id, project.ID);

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/temporary-assets', (req, res) => {
    try {
        const { id } = req.params;
        const assets = db.prepare('SELECT * FROM temporary_assets WHERE ProjectId = ? AND IsPermanent = 0').all(id);
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/temporary-assets', (req, res) => {
    try {
        const { id } = req.params;
        const { itemName, make, model, estimatedPrice, type, category, quantity, currency } = req.body;
        
        // Fetch project location for ID generation
        const project = db.prepare('SELECT Location FROM projects WHERE ID = ?').get(id);
        const location = project ? project.Location : 'MUMBAI';
        
        const assetId = generateTempAssetId(location);
        const stmt = db.prepare(`
            INSERT INTO temporary_assets (ID, ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Timestamp, Currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(assetId, itemName, type || '', category || '', make || '', model || '', estimatedPrice || 0, quantity || 1, id, new Date().toISOString(), currency || 'USD');
        res.json({ success: true, id: assetId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/temporary-assets', (req, res) => {
    try {
        const assets = db.prepare('SELECT * FROM temporary_assets WHERE IsPermanent = 0 ORDER BY Timestamp DESC').all();
        res.json(assets);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets', (req, res) => {
    try {
        const { ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Currency } = req.body;
        
        // Fetch project location for ID generation
        const project = db.prepare('SELECT Location FROM projects WHERE ID = ?').get(ProjectId);
        const location = project ? project.Location : 'MUMBAI';
        
        const id = generateTempAssetId(location);
        const stmt = db.prepare(`
            INSERT INTO temporary_assets (ID, ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Timestamp, Currency)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, ItemName, Type || '', Category || '', Make || '', Model || '', EstimatedPrice || 0, Quantity || 1, ProjectId, new Date().toISOString(), Currency || 'USD');
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets/:id/make-permanent', async (req, res) => {
    try {
        const { id } = req.params;
        const tempAsset = db.prepare('SELECT * FROM temporary_assets WHERE ID = ?').get(id);
        if (!tempAsset) return res.status(404).send('Temporary asset not found');

        // Get project location for ID generation
        const project = db.prepare('SELECT Location FROM projects WHERE ID = ?').get(tempAsset.ProjectId);
        const location = project ? project.Location : 'MUMBAI';

        // Create permanent asset using modern ID generation
        const newAssetId = generateModernAssetId(location);
        
        const ip = getLocalIP();
        const port = process.env.PORT || 8080;
        const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newAssetId)}`;
        const qrCode = await qrcode.toDataURL(urlText, { width: 512 });

        db.transaction(() => {
            // 1. Insert into assets
            db.prepare(`
                INSERT INTO assets (
                  ID, No, ItemName, Status, Make, Model, Type, 
                  Category, Icon, isPlaceholder, LastUpdated, QRCode, NoQR, CurrentLocation, asset_value, Currency
                ) VALUES (?, ?, ?, 'In Store', ?, ?, ?, ?, '🧩', 0, ?, ?, 0, ?, ?, ?)
            `).run(
              newAssetId, 
              newAssetId, 
              tempAsset.ItemName || 'Unnamed Asset', 
              tempAsset.Make || '', 
              tempAsset.Model || '', 
              tempAsset.Type || 'AST', 
              tempAsset.Category || 'General', 
              new Date().toISOString(), 
              qrCode,
              location,
              tempAsset.EstimatedPrice || 0,
              tempAsset.Currency || 'USD'
            );

            // 2. Link to project
            db.prepare(`
                INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
                VALUES (?, ?, ?, 'Permanent')
            `).run(tempAsset.ProjectId, newAssetId, new Date().toISOString());

            // 3. Mark temporary as permanent
            db.prepare('UPDATE temporary_assets SET IsPermanent = 1, PermanentAssetId = ? WHERE ID = ?')
                .run(newAssetId, id);

            // 4. Audit Log
            appendAudit({ 
                Action: 'CONVERT_TEMP', 
                User: req.headers['x-user'] || 'web', 
                AssetId: newAssetId, 
                Severity: 'INFO', 
                Details: `Converted temporary asset "${tempAsset.ItemName}" to permanent asset. Linked to Project ID: ${tempAsset.ProjectId}` 
            });
        })();

        res.json({ success: true, permanentId: newAssetId });
    } catch (err) {
        console.error('Error making asset permanent:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/temporary-assets/:id', (req, res) => {
    try {
        const { id } = req.params;
        db.prepare('DELETE FROM temporary_assets WHERE ID = ?').run(id);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting temporary asset:', err);
        res.status(500).json({ error: err.message });
    }
});





app.put('/api/assets/:id', (req, res) => {
  try {
    const id = req.params.id;
    const asset = req.body;
    console.log(`Updating asset ${id}:`, JSON.stringify(asset));
    
    // Check if asset exists in assets table
    let existing = db.prepare(`
      SELECT a.*, it.MACAddress, it.IPAddress, it.NetworkType, it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
      WHERE LOWER(a.ID) = LOWER(?)
    `).get(id);

    // CRITICAL: Normalize existing.ID if it exists to match the requested id
    if (existing && existing.ID) {
      existing.ID = String(existing.ID).trim();
    }

    let isComp = false;
    if (!existing) {
      // Check components table
      existing = db.prepare('SELECT * FROM components WHERE LOWER(ID) = LOWER(?)').get(id);
      if (existing) {
        isComp = true;
        existing.ID = String(existing.ID).trim();
      }
    }

    if (!existing) {
      return res.status(404).send('Asset not found');
    }

    if (isComp) {
      // Update component in components table
      const compStmt = db.prepare(`
        UPDATE components SET
          ItemName = ?, Make = ?, Model = ?, SrNo = ?, Status = ?,
          Type = ?, Category = ?, LastUpdated = ?
        WHERE ID = ?
      `);
      compStmt.run(
        asset.ItemName || existing.ItemName || '',
        asset.Make || existing.Make || '',
        asset.Model || existing.Model || '',
        asset.SrNo || existing.SrNo || '',
        asset.Status || existing.Status || 'In Store',
        asset.Type || existing.Type || 'Component',
        asset.Category || existing.Category || '',
        new Date().toISOString(),
        id
      );

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

    const stmt = db.prepare(`
      UPDATE assets SET
        ItemName = ?, Status = ?, Make = ?, Model = ?, SrNo = ?, 
        Type = ?, Category = ?, Icon = ?, ParentId = ?, 
        CurrentLocation = ?, 
        DispatchReceiveDt = ?, PurchaseDetails = ?, Remarks = ?, 
        LastUpdated = ?, AssignedTo = ?, NoQR = ?,
        warranty_months = ?, amc_months = ?, asset_value = ?, Currency = ?, PurchaseDate = ?,
        conversion_unit = ?, conversion_factor = ?, conversion_mode = ?,
        quantity_unit = ?, quantity_total = ?, quantity_precision = ?,
        quantity_available = COALESCE(quantity_available, 0) + ?,
        is_quantity_tracked = ?
      WHERE LOWER(ID) = LOWER(?)
    `);

    stmt.run(
      asset.ItemName || existing.ItemName || '',
      asset.Status || existing.Status || 'In Store',
      asset.Make || existing.Make || '',
      asset.Model || existing.Model || '',
      asset.SrNo || existing.SrNo || '',
      asset.Type || existing.Type || '',
      asset.Category || existing.Category || '',
      asset.Icon || existing.Icon || '',
      asset.ParentId !== undefined ? asset.ParentId : (existing.ParentId || null),
      asset.CurrentLocation || existing.CurrentLocation || '',
      asset.DispatchReceiveDt || existing.DispatchReceiveDt || '',
      asset.PurchaseDetails || existing.PurchaseDetails || '',
      asset.Remarks || existing.Remarks || '',
      new Date().toISOString(),
      asset.AssignedTo !== undefined ? asset.AssignedTo : (existing.AssignedTo || ''),
      asset.NoQR !== undefined ? (asset.NoQR ? 1 : 0) : (existing.NoQR || 0),
      asset.warranty_months !== undefined ? asset.warranty_months : (existing.warranty_months || 0),
      asset.amc_months !== undefined ? asset.amc_months : (existing.amc_months || 0),
      asset.asset_value !== undefined ? asset.asset_value : (existing.asset_value || 0),
      asset.Currency !== undefined ? asset.Currency : (existing.Currency || 'INR'),
      asset.PurchaseDate !== undefined ? asset.PurchaseDate : (existing.PurchaseDate || null),
      asset.conversion_unit !== undefined ? asset.conversion_unit : (existing.conversion_unit || null),
      asset.conversion_factor !== undefined ? asset.conversion_factor : (existing.conversion_factor || null),
      asset.conversion_mode !== undefined ? asset.conversion_mode : (existing.conversion_mode || 'multiply'),
      asset.quantity_unit !== undefined ? asset.quantity_unit : (existing.quantity_unit || null),
      asset.quantity_total !== undefined ? asset.quantity_total : (existing.quantity_total || 0),
      asset.quantity_precision !== undefined ? asset.quantity_precision : (existing.quantity_precision || 0),
      qtyAvailableDelta,
      asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : (existing.is_quantity_tracked || 0),
      id
    );

    // Propagate quantity_unit change to all descendants if this is the root asset
    const newQtyUnit = asset.quantity_unit !== undefined ? asset.quantity_unit : existing.quantity_unit;
    const rootIdForProp = String(existing.quantity_root_id || '').trim().toLowerCase();
    const currentIdForProp = String(id).trim().toLowerCase();
    const isRootAssetForProp = rootIdForProp !== '' && rootIdForProp === currentIdForProp;
    
    if (isRootAssetForProp && newQtyUnit && newQtyUnit !== existing.quantity_unit) {
      console.log(`Propagating quantity_unit change from "${existing.quantity_unit}" to "${newQtyUnit}" for root ${id}`);
      db.prepare(`
        UPDATE assets 
        SET quantity_unit = ?, quantity_updated_at = ?
        WHERE LOWER(quantity_root_id) = LOWER(?)
      `).run(newQtyUnit, new Date().toISOString(), existing.quantity_root_id);
      
      // Also update quantity_event_lines to keep history consistent if desired
      db.prepare(`
        UPDATE quantity_event_lines
        SET unit = ?
        WHERE event_id IN (SELECT id FROM quantity_events WHERE LOWER(root_id) = LOWER(?))
      `).run(newQtyUnit, existing.quantity_root_id);
    }

    // Handle quantity initialization if applicable
    if (isInitializingQuantity) {
      const qtyUnit = normalizeQtyUnit(asset.quantity_unit || asset.quantityUnit || asset.qty_unit || asset.qtyUnit)
      const qtyTotal = parseQtyNumber(asset.quantity_total ?? asset.quantityTotal ?? asset.qty_total ?? asset.qtyTotal)
      const qtyPrecision = parseQtyNumber(asset.quantity_precision ?? asset.quantityPrecision ?? asset.qty_precision ?? asset.qtyPrecision)

      if (qtyUnit && qtyTotal !== null && qtyTotal > 0) {
        db.prepare(`
          UPDATE assets
          SET
            quantity_root_id = ?,
            quantity_unit = ?,
            quantity_total = 0,
            quantity_available = 0,
            quantity_precision = ?,
            quantity_updated_at = ?
          WHERE ID = ?
        `).run(id, qtyUnit, qtyPrecision, new Date().toISOString(), id)

        applyQuantityEvent({
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

      db.prepare(`
        INSERT OR REPLACE INTO asset_it_details (
          AssetID, MACAddress, IPAddress, NetworkType, PhysicalPort, VLAN, SocketID, UserID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        asset.MACAddress !== undefined ? asset.MACAddress : (existing.MACAddress || ''),
        asset.IPAddress !== undefined ? asset.IPAddress : (existing.IPAddress || ''),
        asset.NetworkType !== undefined ? asset.NetworkType : (existing.NetworkType || ''),
        asset.PhysicalPort !== undefined ? asset.PhysicalPort : (existing.PhysicalPort || ''),
        asset.VLAN !== undefined ? asset.VLAN : (existing.VLAN || ''),
        asset.SocketID !== undefined ? asset.SocketID : (existing.SocketID || ''),
        asset.UserID !== undefined ? asset.UserID : (existing.UserID || '')
      );
    }

    // Handle nested components (child assets)
    if (Array.isArray(asset.components)) {
      // Get current NoQR components in components table
      const currentComponents = db.prepare('SELECT ID FROM components WHERE ParentId = ? AND NoQR = 1').all(id).map(c => c.ID);
      const updatedCompIds = [];

      const insertStmt = db.prepare(`
        INSERT INTO components (
          ID, ParentId, ItemName, Make, Model, SrNo, Status, Type,
          Category, LastUpdated, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const updateStmt = db.prepare(`
        UPDATE components SET
          ItemName = ?, Make = ?, Model = ?, SrNo = ?, Status = ?,
          Type = ?, Category = ?, LastUpdated = ?, NoQR = 1
        WHERE ID = ? AND ParentId = ?
      `);

      for (const comp of asset.components) {
        if (comp.ID && currentComponents.includes(comp.ID)) {
          // Update existing component
          updateStmt.run(
            comp.ItemName || '',
            comp.Make || '',
            comp.Model || '',
            comp.SrNo || '',
            comp.Status || asset.Status || existing.Status || 'In Store',
            comp.Type || 'Component',
            comp.Category || asset.Category || existing.Category || '',
            new Date().toISOString(),
            comp.ID,
            id
          );
          updatedCompIds.push(comp.ID);
        } else {
          // Insert new component
          const compId = generateModernAssetId(asset.CurrentLocation || existing.CurrentLocation || '');
          insertStmt.run(
            compId,
            id, // ParentId
            comp.ItemName || '',
            comp.Make || '',
            comp.Model || '',
            comp.SrNo || '',
            comp.Status || asset.Status || existing.Status || 'In Store',
            comp.Type || 'Component',
            comp.Category || asset.Category || existing.Category || '',
            new Date().toISOString(),
            1 // NoQR = true
          );
          updatedCompIds.push(compId);
        }
      }

      // Delete orphaned NoQR components
      const orphanedIds = currentComponents.filter(childId => !updatedCompIds.includes(childId));
      if (orphanedIds.length > 0) {
        const deleteStmt = db.prepare('DELETE FROM components WHERE ID = ? AND ParentId = ?');
        for (const orphanId of orphanedIds) {
          deleteStmt.run(orphanId, id);
        }
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds)) {
      // 1. Identify currently linked assets (NoQR = 0)
      const currentLinked = db.prepare('SELECT ID FROM components WHERE ParentId = ? AND NoQR = 0').all(id).map(c => c.ID);
      
      // 2. Unlink those that are no longer in linkedIds
      const toUnlink = currentLinked.filter(linkId => !asset.linkedIds.includes(linkId));
      for (const unlinkId of toUnlink) {
        db.prepare('DELETE FROM components WHERE ID = ? AND ParentId = ?').run(unlinkId, id);
        db.prepare('UPDATE assets SET ParentId = NULL WHERE ID = ?').run(unlinkId);
        
        appendAudit({ 
          Action: 'UNLINK_COMPONENT', 
          User: req.headers['x-user'] || 'web', 
          AssetId: unlinkId, 
          Severity: 'INFO', 
          Details: `Component unlinked from parent ${id}` 
        });
      }

      const compStmt = db.prepare(`
        INSERT OR REPLACE INTO components (
          ID, ParentId, ItemName, Make, Model, SrNo, Status, Type,
          Category, LastUpdated, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      const getAssetStmt = db.prepare('SELECT * FROM assets WHERE ID = ?');
      const checkComponentStmt = db.prepare('SELECT ParentId FROM components WHERE ID = ?');

      for (const linkId of asset.linkedIds) {
        // Validation: Check if asset is already assigned to a parent
        const existingAsset = getAssetStmt.get(linkId);
        if (!existingAsset) continue;

        const existingParentInAssets = existingAsset.ParentId;
        const existingComp = checkComponentStmt.get(linkId);
        const existingParentInComps = existingComp ? existingComp.ParentId : null;

        // Only block if it's assigned to a DIFFERENT parent
        if ((existingParentInAssets && existingParentInAssets !== id) || 
            (existingParentInComps && existingParentInComps !== id)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        compStmt.run(
          linkId,
          id,
          existingAsset.ItemName,
          existingAsset.Make || '',
          existingAsset.Model || '',
          existingAsset.SrNo || '',
          existingAsset.Status || 'In Store',
          existingAsset.Type || 'Component',
          existingAsset.Category || '',
          new Date().toISOString(),
          0 // NoQR = false
        );
        // Update ParentId in assets table instead of clearing it
        db.prepare('UPDATE assets SET ParentId = ? WHERE ID = ?').run(id, linkId);
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

app.delete('/api/assets/:id', (req, res) => {
  try {
    const id = req.params.id;
    const username = req.headers['x-user'] || 'web';

    const qtyInfo = db.prepare('SELECT quantity_root_id FROM assets WHERE ID = ?').get(id)
    if (qtyInfo && qtyInfo.quantity_root_id) {
      return res.status(400).send('Cannot delete quantity-tracked assets')
    }

    const qtyChildren = db.prepare('SELECT 1 FROM assets WHERE quantity_parent_id = ? LIMIT 1').get(id)
    if (qtyChildren) {
      return res.status(400).send('Cannot delete asset with quantity children')
    }

    // Check permissions using the database
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || (user.role !== 'admin' && user.role !== 'superuser')) {
      appendAudit({ Action: 'DELETE_DENIED', User: username, AssetId: id, Severity: 'WARN', Details: 'Unauthorized delete attempt' });
      return res.status(403).send('Forbidden');
    }

    // Delete from components table as well
    // For linked assets (NoQR = 0), we should also clear their ParentId in the assets table
    const linkedComponents = db.prepare('SELECT ID FROM components WHERE ParentId = ? AND NoQR = 0').all(id);
    for (const comp of linkedComponents) {
      db.prepare('UPDATE assets SET ParentId = NULL WHERE ID = ?').run(comp.ID);
    }

    db.prepare('DELETE FROM components WHERE ID = ?').run(id);
    db.prepare('DELETE FROM components WHERE ParentId = ?').run(id);

    const stmt = db.prepare('DELETE FROM assets WHERE ID = ?');
    const result = stmt.run(id);

    if (result.changes > 0) {
      appendAudit({ Action: 'DELETE', User: username, AssetId: id, Severity: 'INFO', Details: 'Asset deleted' });
      res.json({ ok: true });
    } else {
      res.status(404).send('Asset not found');
    }
  } catch (err) {
    console.error('Failed to delete asset:', err);
    res.status(500).send('Error deleting asset: ' + err.message);
  }
});

app.get('/api/audit', (req, res) => {
  try {
    const log = db.prepare('SELECT * FROM audit_log ORDER BY Timestamp DESC LIMIT 1000').all();
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
    const rows = db.prepare(query).all(...params);

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
    const port = process.env.PORT || 8080;

    const projectExists = db.prepare('SELECT 1 FROM projects WHERE ID = ?').get(id);
    if (projectExists) {
      const urlText = `http://${ip}:${port}/project/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      db.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
      res.setHeader('Content-Type', 'image/png');
      return res.send(png);
    }

    const asset = db.prepare('SELECT QRCode FROM assets WHERE ID = ?').get(id);
    if (asset && asset.QRCode && asset.QRCode.startsWith('data:image/')) {
      const base64Data = asset.QRCode.split(',')[1];
      const img = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(img);
    }

    const assetExists = db.prepare('SELECT 1 FROM assets WHERE ID = ?').get(id);
    if (assetExists) {
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      db.prepare('UPDATE assets SET QRCode = ? WHERE ID = ?').run(qrCode, id);
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
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
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

app.get('/asset/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/dist/asset-view.html'))
})

app.get('/project/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/dist/project-view.html'))
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
    const totalResult = db.prepare(countSql).get(...params);
    const totalRecords = totalResult ? totalResult.count : 0;
    const last_page = Math.ceil(totalRecords / size);

    // Fetch
    const sql = `
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      ${baseSql}
      LIMIT ? OFFSET ?
    `;
    
    const offset = (page - 1) * size;
    params.push(size, offset);
    
    const results = db.prepare(sql).all(...params);
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

// Background Network Monitor (DHCP Tracker)
let isBgScanning = false;
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
      const existing = db.prepare(`
        SELECT AssetID, IPAddress, MACAddress 
        FROM asset_it_details 
        WHERE LOWER(MACAddress) = ?
      `).get(mac);

      if (existing) {
        // If the IP has changed, update it
        if (existing.IPAddress !== device.ip) {
          console.log(`[NetworkMonitor] Detected IP change for Asset ${existing.AssetID}: ${existing.IPAddress} -> ${device.ip} (MAC: ${mac}, Host: ${hostname}, Mfg: ${manufacturer})`);
          
          db.prepare('UPDATE asset_it_details SET IPAddress = ? WHERE AssetID = ?')
            .run(device.ip, existing.AssetID);
          
          db.prepare('UPDATE assets SET LastUpdated = ? WHERE ID = ?')
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
const MONITOR_INTERVAL = 5 * 60 * 1000;
setInterval(runNetworkMonitor, MONITOR_INTERVAL);

// Initial run after server starts
setTimeout(runNetworkMonitor, 15000);

const PORT = process.env.PORT || 8080
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

        const stmt = db.prepare(`UPDATE projects SET ${setClause} WHERE ID = ?`);
        const result = stmt.run(...params);

        if (result.changes > 0) {
            // Regenerate QR code if relevant fields changed
            const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
            if (fields.some(f => relevantFields.includes(f))) {
                try {
                    const project = db.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
                    if (project) {
                        const ip = getLocalIP();
                        const port = process.env.PORT || 8080;
                        
                        // Use the new standardized Project QR payload generator
                        const qrPayload = generateProjectQRPayload(project, ip, port);
                        
                        const qrCode = await qrcode.toDataURL(qrPayload, { width: 512 });
                        db.prepare('UPDATE projects SET QRCode = ? WHERE ID = ?').run(qrCode, id);
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
        const project = db.prepare('SELECT * FROM projects WHERE ID = ?').get(id);
        
        if (project) {
            const assets = db.prepare(`
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

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Access locally at http://localhost:${PORT}`);
  console.log('Server started successfully.');
});

// Set timeout to 10 minutes for long OCR jobs
server.timeout = 600000;
