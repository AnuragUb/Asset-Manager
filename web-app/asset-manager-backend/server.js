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
const bcrypt = require('bcryptjs');
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
  appendAudit,
  readJson, 
  writeJson, 
  getLocalIP, 
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
  normalizeDBData
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
 * Universal Normalizer for Database results.
 * Maps lowercase database keys to CamelCase/PascalCase keys expected by the frontend.
 * Also handles common type conversions and date formatting.
 */
function normalizeResult(data) {
    if (!data) return data;
    if (Array.isArray(data)) return data.map(item => normalizeResult(item));
    if (typeof data !== 'object') return data;

    const result = { ...data };

  
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
    'assignedprojectname': 'AssignedProjectName',
    'assignedprojectid': 'AssignedProjectID',
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
    'qtyordered': 'QtyOrdered',
    'uom': 'UOM',
    'unitprice': 'UnitPrice',
    'total': 'Total',
    'fulfilledqty': 'fulfilledQty',
    'challanno': 'ChallanNo',
    'customername': 'CustomerName',
    'deliverydate': 'DeliveryDate',
    'assetids': 'AssetIds',
    'payloadjson': 'PayloadJSON',
    'createdby': 'CreatedBy',
    'module': 'Module',
    'parentname': 'ParentName',
    'parent_folder': 'ParentFolder',
    'displayimage': 'DisplayImage',
    'identifier': 'Identifier',
    'description': 'Description',
    'hsn_code': 'HSNCode',
    'condition': 'Condition',
    'is_retired': 'IsRetired',
    'sale_details': 'SaleDetails',
    'is_deleted': 'IsDeleted',
    'is_batch': 'IsBatch',
    'is_quantity_tracked': 'IsQuantityTracked',
    'is_set': 'IsSet',
    'set_price_mode': 'SetPriceMode',
    'vendoraddress': 'VendorAddress',
    'vendorcontact': 'VendorContact',
    'vendoremail': 'VendorEmail',
    'vendorgst': 'VendorGST',
    // History Mappings
    'oldvalue': 'OldValue',
    'newvalue': 'NewValue',
    'assetid': 'AssetID',
    'timestamp': 'Timestamp',
    'action': 'Action',
    'user': 'User'
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

        // 3. Runtime Repair: Check for corrupted icons in the result
        if (result.Icon && (result.Icon.includes('?') || result.Icon.includes('�'))) {
            // If it's a known kind, we could repair it here too, 
            // but usually startup repair is enough.
            // For now, just fallback to a safe emoji if still corrupted.
            result.Icon = '📦';
        }

        return result;
    }

/**
 * ATOMIC PROMOTION LOGIC: Moves an item from 'components' to 'assets'.
 * Ensures the move is permanent, atomic, and logged in history.
 * Prevents duplicates by checking existence in both tables.
 */
async function promoteToAsset(targetId, targetData, trx, user = 'system') {
    console.log(`[PROMOTION] Starting atomic promotion for ${targetId}`);
    
    // 1. Check if it already exists as a full asset
    const existingAsset = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [targetId.toLowerCase()]).first();
    if (existingAsset) {
        console.warn(`[PROMOTION] Asset ${targetId} already exists in 'assets' table. Updating instead.`);
        await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [targetId.toLowerCase()]).update({
            ...targetData,
            noqr: 0,
            lastupdated: new Date().toISOString()
        });
        // Delete from components if it was there
        await trx('components').whereRaw('LOWER(id) = LOWER(?)', [targetId.toLowerCase()]).del();
        return targetId;
    }

    // 2. Insert into assets
    await trx('assets').insert({
        ...targetData,
        id: targetId,
        noqr: 0, // Logic: Promoted means it's now a tracked asset with QR
        lastupdated: new Date().toISOString()
    });

    // 3. Delete from components (The cleanup)
    const deleted = await trx('components').whereRaw('LOWER(id) = LOWER(?)', [targetId.toLowerCase()]).del();
    
    // 4. Log the life-long history
    await logAssetHistory(targetId, 'PROMOTED', 'COMPONENT', 'ASSET', user, `Permanently promoted to full asset. Table cleanup performed: ${deleted > 0}`, trx);
    
    console.log(`[PROMOTION] Success: ${targetId} is now a full asset.`);
    return targetId;
}

/**
 * RELIABLE STATUS TRANSITION HELPER
 * Ensures status updates are atomic, logged, and propagated to children.
 * Forces cache invalidation to prevent "disappearing" assets.
 * Optional projectId: If provided, also handles project_assets linking/unlinking.
 */
async function updateAssetStatus(assetId, newStatus, updates, trx, user = 'system', historyDetails = '', recursive = true, projectId = null) {
    console.log(`[STATUS] Transitioning ${assetId}: Status -> ${newStatus}. Project: ${projectId || 'N/A'}`);
    
    const assetRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
    const asset = normalizeResult(assetRow);
    if (!asset) {
        console.warn(`[STATUS] Asset ${assetId} not found. Skipping status update.`);
        return;
    }

    const oldStatus = asset.Status || asset.status;

    // 1. Perform the update
    await trx('assets')
        .whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()])
        .update({
            ...updates,
            status: newStatus,
            lastupdated: new Date().toISOString()
        });

    // 2. Project Linking Logic
    if (projectId) {
        if (newStatus === 'Project') {
            // Link to project
            await trx('project_assets').insert({
                projectid: projectId,
                assetid: asset.id || asset.ID,
                assigneddate: new Date().toISOString(),
                type: 'Permanent'
            }).onConflict(['projectid', 'assetid']).merge();
        } else if (newStatus === 'Under Inspection' || newStatus === 'In Store') {
            // Unlink from project (Note: usually unassign-asset handles this, but here for safety)
            await trx('project_assets').where({ projectid: projectId, assetid: asset.id || asset.ID }).delete();
        }
    }

    // 3. Log History
    await logAssetHistory(assetId, 'STATUS_CHANGE', oldStatus, newStatus, user, historyDetails || `Status updated to ${newStatus}`, trx);

    // 4. Recursive Propagation (for Sets/Supersets)
    if (recursive && (asset.IsSet || asset.is_set)) {
        const children = await trx('assets').whereRaw('LOWER(parentid) = LOWER(?)', [assetId.toLowerCase()]).select('id');
        for (const child of children) {
            await updateAssetStatus(child.id, newStatus, updates, trx, user, historyDetails ? `Propagated: ${historyDetails}` : `Propagated from parent set ${assetId}`, true, projectId);
        }
    }
}


/**
 * Executes a query against the active database (Knex).
 * Automatically normalizes results.
 */
async function executeQuery(tableName, callback) {
  try {
    const result = await callback(db(tableName));
    return normalizeResult(result);
  } catch (err) {
    console.error(`[DB] Query Error on ${tableName}:`, err.message);
    throw err;
  }
}

// --- CACHE INVALIDATION HELPERS ---

async function invalidateAssetKindsCache() {
  console.log('[CACHE] Invalidating asset kinds cache');
  await cache.delPattern('asset:kinds:*');
}

async function invalidateEmployeesCache() {
  console.log('[CACHE] Invalidating employees cache');
  await cache.delPattern('employees:all:*');
}

async function invalidateAssetsCache() {
  console.log('[CACHE] Performing FULL cache flush');
  try {
    // Clear all asset-related patterns
    await cache.delPattern('assets:*');
    await cache.delPattern('projects:*');
    // If user is really suspicious of Redis, we can do a full flush
    // await cache.flush(); 
  } catch (err) {
    console.error('[CACHE] Invalidation failed:', err);
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

    const now = new Date();
    const ts = now.getFullYear() + 
               String(now.getMonth() + 1).padStart(2, '0') + 
               String(now.getDate()).padStart(2, '0') + '_' + 
               String(now.getHours()).padStart(2, '0') + 
               String(now.getMinutes()).padStart(2, '0');
    
    const filename = `pg_backup_${ts}.sql`;
    const backupPath = path.join(targetDir, filename);
    
    // Use pg_dump via Docker
    const dbName = process.env.DB_NAME || 'asset_manager';
    const dbUser = process.env.DB_USER || 'postgres';
    const containerName = 'asset-manager-db';

    console.log(`[BACKUP] Starting PostgreSQL backup for ${dbName}...`);
    
    // Command: docker exec asset-manager-db pg_dump -U postgres asset_manager > path/to/backup.sql
    try {
      // FIX: Use absolute path without the c: special character issues in some environments
      // We use a simpler path joining for the execSync command
      const absoluteBackupPath = path.resolve(backupPath);
      execSync(`docker exec ${containerName} pg_dump -U ${dbUser} ${dbName} > "${absoluteBackupPath}"`);
      console.log(`[BACKUP] Success! Saved to: ${absoluteBackupPath}`);
    } catch (dumpErr) {
      console.error('[BACKUP] pg_dump failed:', dumpErr.message);
      return;
    }
    
    // Cleanup: Keep only last 30 backups
    const files = fs.readdirSync(targetDir)
      .filter(f => f.startsWith('pg_backup_') && f.endsWith('.sql'))
      .map(f => ({ name: f, time: fs.statSync(path.join(targetDir, f)).mtime.getTime() }))
      .sort((a, b) => b.time - a.time);

    if (files.length > 30) {
      files.slice(30).forEach(f => {
        fs.unlinkSync(path.join(targetDir, f.name));
        console.log(`[BACKUP] Cleaned up old backup: ${f.name}`);
      });
    }
  } catch (err) {
    console.error('[BACKUP] Global Backup Error:', err);
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
    const hasTable = await db.schema.hasTable('asset_history');
    
    if (hasTable) {
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
        table.string('assetid').notNullable();
        table.string('action').notNullable();
        table.text('oldvalue');
        table.text('newvalue');
        table.string('user');
        table.timestamp('timestamp').defaultTo(db.fn.now());
        table.text('details');
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
async function logAssetHistory(assetId, action, oldValue, newValue, user, details = '', trx = null) {
  try {
    const timestamp = new Date().toISOString();
    const query = trx || db;
    await query('asset_history').insert(normalizeDBData({
      AssetID: assetId,
      Action: action,
      OldValue: oldValue,
      NewValue: newValue,
      User: user || 'web',
      Timestamp: timestamp,
      Details: details
    }));
  } catch (err) {
    console.error('[HISTORY] Failed to log:', err);
  }
}

// Unified logAudit
async function logAudit(user, action, details, assetId = 'N/A', severity = 'INFO', trx = null) {
    try {
        const timestamp = new Date().toISOString();
        const query = trx || db;
        await query('audit_log').insert(normalizeDBData({
            User: user || 'web',
            Action: action,
            Details: details,
            AssetId: assetId,
            Severity: severity,
            Timestamp: timestamp
        }));
    } catch (err) {
        console.error('[AUDIT] Failed to log audit:', err.message);
    }
}

function formatDisplayDate(val) {
    if (!val) return '-';
    
    let date;
    if (val instanceof Date) {
        date = val;
    } else if (typeof val === 'string') {
        date = new Date(val);
    } else {
        return val;
    }

    if (isNaN(date.getTime())) return val;

    const d = String(date.getDate()).padStart(2, '0');
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const y = date.getFullYear();
    return `${d}-${m}-${y}`;
}

// Helper to normalize Excel date numbers or various date formats to YYYY-MM-DD for DB
const normalizeDate = (val) => {
    if (!val) return null;
    
    let date;
    if (val instanceof Date) {
        date = val;
    } else if (typeof val === 'number' || (!isNaN(val) && !isNaN(parseFloat(val)))) {
        // If it's a number (Excel serial date format)
        const num = parseFloat(val);
        // Excel dates start from 1900-01-01. 
        // 25569 is the number of days between 1900-01-01 and 1970-01-01 (Unix Epoch)
        date = new Date((num - 25569) * 86400 * 1000);
        console.log(`[DATE] Converted Excel serial ${num} to ${date.toISOString().split('T')[0]}`);
    } else {
        date = new Date(val);
    }

    if (date && !isNaN(date.getTime())) {
        const iso = date.toISOString().split('T')[0];
        return iso;
    }
    console.warn(`[DATE] Failed to normalize date value: "${val}"`);
    return null;
};

// QA Test Route
app.get('/api/test-ping', (req, res) => res.json({ pong: true, time: new Date().toISOString() }));

// Debug Endpoint
app.get('/api/debug/diagnose/:id', async (req, res) => {
  const id = req.params.id;
  
  let asset = null;
  let recent = [];
  let error = null;

  try {
    asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
    recent = await db('assets').select('id', 'itemname', 'lastupdated').orderBy('lastupdated', 'desc').limit(5);
    asset = normalizeResult(asset);
    recent = normalizeResult(recent);
  } catch (err) {
    error = err.message;
  }

  res.json({
    requested_id: id,
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

// --- Asset Lifecycle Endpoints ---
app.post('/api/assets/:id/sell', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { buyerName, saleDate, salePrice, invoiceNo, remarks } = req.body;
        const username = req.user.user_id || 'web';

        await db.transaction(async (trx) => {
            const asset = await trx('assets').where('id', id).first();
            if (!asset) throw new Error('Asset not found');

            const saleDetails = JSON.stringify({
                buyer: buyerName,
                date: saleDate,
                price: salePrice,
                invoice: invoiceNo,
                remarks: remarks
            });

            await trx('assets')
                .where('id', id)
                .update({
                    status: 'Sold',
                    is_retired: 1,
                    sale_details: saleDetails,
                    lastupdated: new Date().toISOString()
                });

            await logAssetHistory(id, 'ASSET_SOLD', asset.status, 'Sold', username, `Sold to ${buyerName} for ${salePrice}. Invoice: ${invoiceNo}`, trx);
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Sell asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/assets/:id/release-to-store', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { condition, remarks } = req.body;
        const username = req.user.user_id || 'web';

        await db.transaction(async (trx) => {
            const assetRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).first();
            const asset = normalizeResult(assetRow);
            if (!asset) return;

            // Use the Reliable Status Helper
            await updateAssetStatus(
                id,
                'In Store',
                {
                    condition: condition || 'Good',
                    currentlocation: 'Mumbai', // Reset to main hub on release
                    remarks: remarks ? `${asset.remarks || ''}\n[Inspection]: ${remarks}` : asset.remarks
                },
                trx,
                username,
                `Passed inspection. Condition: ${condition}. ${remarks}`,
                true // Recursive for sets
            );
        });

        await invalidateAssetsCache();
        res.json({ success: true });
    } catch (err) {
        console.error('Release asset error:', err);
        res.status(500).json({ error: err.message });
    }
});


app.get('/api/assets/retired', authenticateJWT, async (req, res) => {
    try {
        const assets = await db('assets')
            .where(function() {
                // An asset is retired if it's explicitly sold/scraped OR marked retired BUT NOT 'In Store'
                this.whereRaw('LOWER(status) = ?', ['sold'])
                    .orWhereRaw('LOWER(status) = ?', ['scraped'])
                    .orWhere(function() {
                        this.where('is_retired', 1)
                            .andWhereRaw('LOWER(status) != ?', ['in store']);
                    });
            })
            .orderBy('lastupdated', 'desc');
        
        const normalizedAssets = normalizeResult(assets).map(a => {
            // Force status to "Retired" if it's not Sold/Scraped but is in this list
            const currentStatus = (a.Status || a.status || '').toLowerCase();
            if (currentStatus !== 'sold' && currentStatus !== 'scraped') {
                return { ...a, Status: 'Retired', status: 'Retired' };
            }
            return a;
        });

        console.log(`[RETIRED] Found ${normalizedAssets.length} retired assets`);
        res.json(normalizedAssets);
    } catch (err) {
        console.error('Fetch retired assets error:', err);
        res.status(500).json({ error: err.message });
    }
});

// --- Asset History Endpoint ---
app.get('/api/assets/:id/history', async (req, res) => {
  try {
    const { id } = req.params;
    const history = await db('asset_history').whereRaw('LOWER(assetid) = LOWER(?)', [id]).orderBy('timestamp', 'desc');
    res.json({ success: true, history: normalizeResult(history) });
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
async function initializeAuthTables() {
    // Force cache flush on startup to ensure consistency after rebuilds/migrations
    try {
        console.log('[STARTUP] Flushing Redis/Memory cache...');
        await cache.delPattern('*');
    } catch (e) {
        console.warn('[STARTUP] Cache flush failed (non-critical):', e.message);
    }

    try {
        const hasTokens = await db.schema.hasTable('auth_tokens');
        if (!hasTokens) {
            await db.schema.createTable('auth_tokens', table => {
                table.increments('id').primary();
                table.string('user_id').notNullable();
                table.text('token_hash').notNullable();
                table.string('expires_at').notNullable();
                table.string('created_at').notNullable();
            });
            await db.schema.table('auth_tokens', table => {
                table.index('token_hash', 'idx_auth_tokens_hash');
            });
        }

        const hasResets = await db.schema.hasTable('password_resets');
        if (!hasResets) {
            await db.schema.createTable('password_resets', table => {
                table.increments('id').primary();
                table.string('email').notNullable();
                table.text('token_hash').notNullable();
                table.string('expires_at').notNullable();
                table.string('created_at').notNullable();
            });
            await db.schema.table('password_resets', table => {
                table.index('token_hash', 'idx_password_resets_hash');
            });
        }
        console.log('Auth tables checked/created in Knex');
    } catch (err) {
        console.error('Auth migration error:', err);
    }
}
initializeAuthTables();

async function initializeHierarchyFolders() {
    try {
        const itRoot = await db('folders').where('name', 'IT Assets').first();
        if (!itRoot) return;

        const foldersToEnsure = [
            { id: 'Hardware', name: 'Hardware', parentid: itRoot.id, module: 'IT', icon: '💻' },
            { id: 'Networking', name: 'Networking', parentid: itRoot.id, module: 'IT', icon: '🌐' },
            { id: 'Media & Others', name: 'Media & Others', parentid: itRoot.id, module: 'IT', icon: '📁' }
        ];

        for (const f of foldersToEnsure) {
            const exists = await db('folders').where('id', f.id).first();
            if (!exists) {
                console.log(`[STARTUP] Creating hierarchy folder: ${f.name}`);
                await db('folders').insert({
                    id: f.id,
                    name: f.name,
                    parentid: f.parentid,
                    module: f.module,
                    icon: f.icon,
                    timestamp: new Date().toISOString()
                });
            } else if (!exists.icon || exists.icon.includes('?')) {
                console.log(`[STARTUP] Repairing corrupted/missing icon for folder: ${f.name}`);
                await db('folders').where('id', f.id).update({ icon: f.icon });
            }
        }


        // --- SELF-HEALING: Repair corrupted asset_kinds icons ---
        const corruptedKinds = await db('asset_kinds').where('icon', 'like', '%?%').orWhereNull('icon');
        if (corruptedKinds.length > 0) {
            console.log(`[STARTUP] Found ${corruptedKinds.length} corrupted/missing asset_kinds icons. Repairing...`);
            
            const repairMap = {
                'Laptop': '/static/icons/laptop.svg',
                'Desktop': '/static/icons/desktop.svg',
                'Monitor': '/static/icons/monitor.svg',
                'Server': '/static/icons/server.svg',
                'Switch': '/static/icons/switch.svg',
                'Camera': '/static/icons/camera.svg',
                'Keyboard': '⌨️',
                'Mouse': '🖱️',
                'License': '🔑',
                'Router': '📶',
                'Networking': '/static/icons/networking.svg',
                'Hardware': '/static/icons/hardware.svg',
                'Software': '/static/icons/software.svg',
                'Cables': '🔌',
                'Cable': '🔌',
                'Accessory': '⌨️',
                'Printer': '🖨️',
                'Projector': '📽️',
                'Scanner': '📠',
                'UPS': '🔋',
                'Rack': '🗄️',
                'Data Drives': '💾'
            };


            for (const kind of corruptedKinds) {
                const repairIcon = repairMap[kind.name] || '📦';
                console.log(`[STARTUP] Repairing Kind ${kind.name}: ${kind.icon || 'NULL'} -> ${repairIcon}`);
                await db('asset_kinds').where('name', kind.name).update({ icon: repairIcon });
            }
            console.log('[STARTUP] Asset kinds icons repaired.');
        }

    } catch (err) {
        console.error('Hierarchy initialization error:', err);
    }
}
initializeHierarchyFolders();

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
        await db('users').whereRaw('LOWER(username) = LOWER(?)', [user.username]).update({ password: newHash });
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
    secure: false, 
    sameSite: 'lax',
    maxAge: 0
  });
  
  res.cookie(REMEMBER_COOKIE_NAME, '', {
    httpOnly: true,
    secure: false, 
    sameSite: 'lax',
    maxAge: 0
  });

  res.json({ ok: true, message: 'Logged out' });
});

app.get('/api/auth/me', async (req, res) => {
    try {
        const cookies = parseCookies(req.headers.cookie || '');

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
                let user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [decoded.user_id]).first();
                user = normalizeResult(user);

                if (user) {
                    const permissions = Array.from(rolePermissionCache[decoded.role] || []);
                    return res.json({
                        ok: true,
                        user: {
                            id: decoded.user_id,
                            username: user.username,
                            fullname: user.fullname,
                            role: decoded.role,
                            permissions: permissions,
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
                let user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [userId]).first();
                user = normalizeResult(user);

                if (user) {
                    const category = 'IT';
                    const { token: newToken, claims } = signJwtForUser(user, category);
                    
                    res.cookie(JWT_COOKIE_NAME, newToken, {
                        httpOnly: true,
                        secure: false, 
                        sameSite: 'lax',
                        maxAge: JWT_EXPIRES_IN_SECONDS * 1000
                    });

                    const permissions = Array.from(rolePermissionCache[claims.role] || []);

                    return res.json({
                        ok: true,
                        user: {
                            id: claims.user_id,
                            username: user.username,
                            fullname: user.fullname,
                            role: claims.role,
                            permissions: permissions,
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
        let user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [email]).orWhereRaw('LOWER(fullname) = LOWER(?)', [email]).first();
        user = normalizeResult(user);

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
        await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).update({ password: passwordHash });
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
      console.log(`[AUTH] No token found for request to ${req.path}`);
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.user_id || !decoded.role || !decoded.company_id) {
      console.log(`[AUTH] Invalid token payload for ${req.path}`);
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
    console.log(`[AUTH] Token verification failed for ${req.path}: ${err.message}`);
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
      console.log(`[AUTH] authorizeRoles: No user/role for ${req.path}`);
      return res.status(401).json({ error: 'Authentication required' });
    }
    // superuser bypasses all role checks
    if (req.user.role === 'superuser') {
      return next();
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      console.log(`[AUTH] authorizeRoles: Access denied for ${req.user.user_id}. Role: ${req.user.role}. Allowed: ${allowedRoles}`);
      return res.status(403).json({ error: 'Forbidden' });
    }
    return next();
  };
}

let rolePermissionCache = {};

async function loadRolePermissionsIntoCache() {
  try {
    const rows = await db('role_permissions').select('role_name', 'permission_key');
      
    const map = {};
    rows.forEach(row => {
      const normalized = normalizeResult(row);
      const roleName = normalized.role_name; 
      const permKey = normalized.permission_key;
      
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

// --- Initialize Permissions Cache ---
loadRolePermissionsIntoCache().then(() => {
  console.log('[AUTH] Permissions cache initialized from PostgreSQL');
});
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
  const user = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();
  return normalizeResult(user);
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
        let users = await db('users').select('id', 'username', 'fullname', 'role', 'company_id', 'client_id', 'project_id', 'department', 'designation');
        res.json(normalizeResult(users));
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

        // Check if user already exists
        const existing = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();
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

        await db('users').insert(normalizeDBData(userData));

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

        await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).update(normalizeDBData(updateData));

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

        await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).delete();

        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/roles', authenticateJWT, async (req, res) => {
    try {
        const roles = await db('roles').select('*');
        res.json(normalizeResult(roles));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/permissions', authenticateJWT, async (req, res) => {
    try {
        const perms = await db('permissions').select('*');
        res.json(normalizeResult(perms));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/role-permissions', authenticateJWT, async (req, res) => {
    try {
        const rows = await db('role_permissions').select('*');
        res.json(normalizeResult(rows));
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

        await db('role_permissions').insert({ role_name, permission_key }).onConflict(['role_name', 'permission_key']).ignore();

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

        await db('role_permissions').where({ role_name, permission_key }).delete();

        await loadRolePermissionsIntoCache();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Enhanced RBAC Management Endpoints ---

// Get all roles with their permissions
app.get('/api/rbac/roles', authenticateJWT, authorizeRoles('superuser'), async (req, res) => {
    try {
        console.log(`[RBAC] Fetching roles for user: ${req.user.user_id} (${req.user.role})`);
        const roles = await db('roles').select('*');
        const rolePermissions = await db('role_permissions').select('*');
        
        console.log(`[RBAC] Found ${roles.length} roles and ${rolePermissions.length} mappings`);

        const rolesWithPerms = roles.map(role => {
            try {
                const normalized = normalizeResult(role);
                return {
                    ...normalized,
                    permissions: rolePermissions
                        .filter(rp => rp.role_name === role.name)
                        .map(rp => rp.permission_key)
                };
            } catch (e) {
                console.error('[RBAC] Error normalizing role:', role, e);
                return null;
            }
        }).filter(r => r !== null);
        
        res.json({ success: true, roles: rolesWithPerms });
    } catch (err) {
        console.error('[RBAC] Critical Error in GET /api/rbac/roles:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Create or Update a Role with Permissions
app.post('/api/rbac/roles', authenticateJWT, authorizeRoles('superuser'), async (req, res) => {
    const { name, description, permissions } = req.body;
    if (!name) return res.status(400).json({ success: false, error: 'Role name is required' });

    try {
        await db.transaction(async (trx) => {
            // 1. Upsert Role
            await trx('roles')
                .insert({ name, description })
                .onConflict('name')
                .merge();

            // 2. Update Permissions
            if (Array.isArray(permissions)) {
                // Remove existing
                await trx('role_permissions').where('role_name', name).delete();
                
                // Add new
                if (permissions.length > 0) {
                    const toInsert = permissions.map(pk => ({
                        role_name: name,
                        permission_key: pk
                    }));
                    await trx('role_permissions').insert(toInsert);
                }
            }
        });

        await loadRolePermissionsIntoCache();
        res.json({ success: true, message: `Role '${name}' updated successfully` });
    } catch (err) {
        console.error('RBAC Role Update Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delete a Role
app.delete('/api/rbac/roles/:name', authenticateJWT, authorizeRoles('superuser'), async (req, res) => {
    const { name } = req.params;
    if (['superuser', 'admin', 'user'].includes(name.toLowerCase())) {
        return res.status(400).json({ success: false, error: 'Cannot delete system-critical roles' });
    }

    try {
        await db('roles').where('name', name).delete();
        await loadRolePermissionsIntoCache();
        res.json({ success: true, message: `Role '${name}' deleted successfully` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Helper to get quantity-tracked asset (Async)
async function getQuantityAsset(id) {
  const asset = await db('assets as a')
    .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
    .select(
      'a.id as ID',
      'a.itemname as ItemName',
      'a.status as Status',
      'a.currentlocation as CurrentLocation',
      'a.quantity_parent_id',
      'a.quantity_root_id',
      'a.quantity_unit',
      'a.quantity_total',
      'a.quantity_available',
      'a.quantity_precision',
      'a.conversion_unit',
      'a.conversion_factor',
      'pa.projectid as ProjectID'
    )
    .whereRaw('LOWER(a.id) = LOWER(?)', [id])
    .first();
    
  return normalizeResult(asset);
}

const applyQuantityEvent = async (event, externalTrx = null) => {
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
    
    const eventId = insertResult[0].id || insertResult[0];

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
        .whereRaw('LOWER(id) = LOWER(?)', [line.assetId])
        .andWhereRaw('LOWER(quantity_root_id) = LOWER(?)', [event.rootId])
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
        const rows = await db('audit_log')
            .select('action as Action', 'user as User', 'assetid as AssetId', 'details as Details', 'timestamp as Timestamp')
            .orderBy('timestamp', 'desc')
            .limit(10);
        res.json(normalizeResult(rows));
    } catch (err) {
        console.error('Error fetching recent activity:', err);
        res.status(500).json({ error: 'Failed to fetch activity log' });
    }
});

// API to get all audit logs
app.get('/api/audit-logs', async (req, res) => {
    try {
        const rows = await db('audit_log')
            .orderBy('timestamp', 'desc')
            .limit(1000);
        res.json(normalizeResult(rows));
    } catch (err) {
        console.error('Error fetching audit logs:', err);
        res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
});

// API to export audit logs as JSON
app.get('/api/audit-logs/export/json', async (req, res) => {
    try {
        const rows = await db('audit_log').orderBy('timestamp', 'desc');
        const normalized = normalizeResult(rows);
        
        const filename = 'audit_logs_' + Date.now() + '.json';
        fs.writeFileSync(path.join(exportDir, filename), JSON.stringify(normalized, null, 2));

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', 'attachment; filename="audit_logs.json"');
        res.send(JSON.stringify(normalized, null, 2));
    } catch (err) {
        console.error('Error exporting audit logs JSON:', err);
        res.status(500).json({ error: 'Failed to export logs' });
    }
});

// API to export audit logs as Excel
app.get('/api/audit-logs/export/excel', async (req, res) => {
    try {
        const rows = await db('audit_log').orderBy('timestamp', 'desc');
        const normalized = normalizeResult(rows);

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(normalized);
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

    const assetId = asset.id || asset.ID;
    const itemName = asset.itemname || asset.ItemName;
    console.log(`Attempting to send warranty email for asset ${assetId} to ${recipients.join(', ')}`);
    
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
    const subject = `[WARRANTY ALERT] Asset ${assetId} - ${itemName} is ${status}`;
    
    // Determine Project Context using Knex
    let projectContext = '';
    const projectId = asset.projectid || asset.ProjectID;
    if (projectId) {
         const project = await db('projects').where('id', projectId).first();
         if (project) {
             projectContext = `
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Project:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${project.projectname} (${project.clientname})</td></tr>
             `;
         }
    }

    const html = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: ${daysLeft < 0 ? '#dc3545' : '#ff8c00'};">${status}</h2>
            <p>The warranty for the following asset is ${daysLeft < 0 ? 'already expired' : 'expiring soon'}:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Asset ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${assetId}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Item Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${itemName}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Model:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.model || asset.Model || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Serial No:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.serialno || asset.SerialNo || asset.srno || asset.SrNo || '-'}</td></tr>
                ${projectContext}
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Purchase Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${formatDisplayDate(asset.purchasedate || asset.PurchaseDate) || '-'}</td></tr>
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

        await logAudit('SYSTEM', 'WARRANTY_ALERT_SENT', `Sent ${status} email notification to ${recipients.join(', ')}`, assetId);
        
        console.log(`Notification sent for asset ${assetId} to ${recipients.join(', ')}`);
        return delivered;
    } catch (err) {
        console.error(`Failed to send email for asset ${assetId} to ${recipients.join(', ')}:`, err);
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

        // Fetch assets joined with project assignments using Knex
        const assets = await db('assets as a')
            .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
            .where('a.is_deleted', 0)
            .select('a.*', 'pa.projectid');
        
        const now = new Date();
        const thresholdDays = settings.threshold_days || 30;
        
        // Track notified assets in dynamic.json to avoid duplicate emails
        const notified = dynamic.notified_assets || {};
        let changed = false;

        for (const asset of assets) {
            if (!asset.purchasedate || !asset.warranty_months) continue;

            const pMonths = parseInt(asset.warranty_months);
            if (isNaN(pMonths)) continue;

            const pDate = new Date(asset.purchasedate);
            if (isNaN(pDate.getTime())) continue;

            const expiryDate = new Date(pDate);
            expiryDate.setMonth(pDate.getMonth() + pMonths);
            
            const diffTime = expiryDate - now;
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            // Notify if expired or expiring within threshold
            if (diffDays <= thresholdDays) {
                const notifiedKey = `${asset.id}_${expiryDate.getTime()}`;
                
                if (!notified[notifiedKey]) {
                    console.log(`Warranty Alert: Asset ${asset.id} expires in ${diffDays} days.`);

                    const recipientEmails = [];

                    if (sendToAdmin && settings.notification_email) {
                        recipientEmails.push(settings.notification_email);
                    }

                    if (sendToProjectEmails && asset.projectid) {
                        const project = await db('projects').where('id', asset.projectid).first();
                        if (project) {
                            if (project.owneremail && project.owneremail.trim() !== '') recipientEmails.push(project.owneremail);
                            if (project.coordinatoremail && project.coordinatoremail.trim() !== '') recipientEmails.push(project.coordinatoremail);
                        }
                    }

                    if (sendToEmployeeEmails) {
                        const tokens = [];
                        if (asset.assignedto && String(asset.assignedto).trim() !== '') tokens.push(...parseEmails(asset.assignedto));

                        const it = await db('asset_it_details').where('assetid', asset.id).first();
                        if (it && it.userid && String(it.userid).trim() !== '') tokens.push(...parseEmails(it.userid));

                        for (const token of tokens) {
                            const t = String(token).trim();
                            if (!t) continue;

                            if (t.includes('@') && t.includes('.')) {
                                recipientEmails.push(t);
                                continue;
                            }

                            const rows = await db('employees')
                                .whereRaw('LOWER(id) = LOWER(?)', [t])
                                .orWhereRaw('LOWER(employeeid) = LOWER(?)', [t])
                                .orWhereRaw('LOWER(name) = LOWER(?)', [t])
                                .orWhereRaw('LOWER(email) = LOWER(?)', [t]);
                                
                            for (const row of rows) {
                                if (row && row.email) recipientEmails.push(row.email);
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

// FAVICON FIX: Explicitly serve logo.png for /favicon.ico requests
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, '../asset-manager-frontend/static/logo.png'));
});

const distPath = path.join(__dirname, '../asset-manager-frontend/dist');
const useDist = false; // Force source assets to prevent 404s during rapid development

// Setup Icons Directory (Serve from Source or DIST based on environment)
const sourceIconsDir = path.join(__dirname, '../asset-manager-frontend/static/icons');
const distIconsDir = path.join(__dirname, '../asset-manager-frontend/dist/static/icons');

// Port-specific static file serving
// FORCE SOURCE ASSETS FOR ALL PORTS (Development Mode)
const forceSource = true; 

if (!forceSource && currentPort == 8080 && fs.existsSync(distPath)) {
    // Port 8080: Serve from DIST (Minified/Obfuscated/Hidden)
    console.log('[ENV] Serving minified assets from DIST folder on port 8080');
    app.use('/js', express.static(path.join(__dirname, '../asset-manager-frontend/dist/js')));
    app.use('/static', express.static(path.join(__dirname, '../asset-manager-frontend/dist/static')));
    app.use('/icons', express.static(distIconsDir));
    app.use(express.static(path.join(__dirname, '../asset-manager-frontend/dist')));
} else {
    // Port 9090 or Force Source: Serve from source (Easier debugging)
    console.log(`[ENV] Serving source assets from JS/STATIC folders on port ${currentPort}`);
    app.use('/js', express.static(path.join(__dirname, '../asset-manager-frontend/js')));
    app.use('/static', express.static(path.join(__dirname, '../asset-manager-frontend/static')));
    app.use('/icons', express.static(sourceIconsDir));
    app.use(express.static(path.join(__dirname, '../asset-manager-frontend')));
}

const iconsDir = (currentPort == 8080 && fs.existsSync(distPath)) ? distIconsDir : sourceIconsDir;

// Ensure icons directory exists
if (!fs.existsSync(iconsDir)) {
  console.log(`[STARTUP] Creating missing icons directory: ${iconsDir}`);
  fs.mkdirSync(iconsDir, { recursive: true });
}



app.use('/uploads', express.static(uploadsDir));
app.use('/input', express.static(uploadsDir));
// app.use('/icons', express.static(path.join(__dirname, '../asset-manager-frontend/dist/assets/icons'))); // REMOVED: Handled above

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
    // 1. Check user assignment
    const asset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId]).select('assignedto').first();
    const normalizedAsset = normalizeResult(asset);
    
    const assignedTo = normalizedAsset?.assignedto;
    if (assignedTo && assignedTo.trim() !== '') {
        return { type: 'user', assignedTo };
    }

    // 2. Check project assignment
    const projectLink = await db('project_assets as pa')
        .join('projects as p', 'pa.projectid', 'p.id')
        .whereRaw('LOWER(pa.assetid) = LOWER(?)', [assetId])
        .select('pa.projectid as ProjectID', 'p.projectname as ProjectName', 'p.status as Status')
        .first();

    const normalizedLink = normalizeResult(projectLink);
    if (normalizedLink) {
        return { 
            type: 'project', 
            projectId: normalizedLink.ProjectID || normalizedLink.projectId, 
            projectName: normalizedLink.ProjectName || normalizedLink.projectName,
            status: normalizedLink.Status || normalizedLink.status 
        };
    }

    return null;
}

// --- Public Asset View API ---
// This endpoint is for client-facing barcode scans. 
// It redacts sensitive internal information and enforces access via ClientLabel only.
app.get('/api/public/assets/:label', async (req, res) => {
    try {
        const { label } = req.params;

        // Security check: Only allow lookup by client_label, never by internal ID
        if (label.includes('-MUM-') || label.includes('SET-')) {
            return res.status(403).json({ error: 'Direct internal ID access is restricted for security.' });
        }

        const asset = await db('assets as a')
            .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
            .leftJoin('projects as p', 'pa.projectid', 'p.id')
            .whereRaw('LOWER(a.client_label) = LOWER(?)', [label])
            .select(
                'a.*',
                'p.projectname as project_name'
            )
            .first();

        if (!asset) {
            return res.status(404).json({ error: 'Asset not found' });
        }

        const normalized = normalizeResult(asset);

        // Redact internal data (Sanctity Check)
        const publicAsset = {
            ClientLabel: normalized.client_label,
            ItemName: normalized.itemname,
            ItemDescription: normalized.itemdescription,
            Make: normalized.make,
            Model: normalized.model,
            SerialNo: normalized.serialno || normalized.srno,
            Type: normalized.type,
            Category: normalized.category,
            AssignedProject: normalized.project_name || 'N/A',
            CurrentLocation: normalized.currentlocation,
            WarrantyMonths: normalized.warranty_months,
            Department: normalized.department,
            // Include specifications but strictly exclude Pricing, Vendor, and Purchase Date
            Specifications: normalized.remarks
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
    const currentPort = process.env.PORT || 8080;
    const cacheKey = `assets:list:${currentPort}:${hasViewPrice}:${projectId || 'all'}`;
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
            PurchaseDate: a.purchasedate,
            BoughtAgainstPO: a.boughtagainstpo,
            SentAgainstDC: a.sentagainstdc,
            Remarks: a.remarks,
            WarrantyMonths: a.warranty_months,
            AssetValue: a.asset_value,
            IsRetired: a.is_retired || 0,
            Weight: a.weight,
            HSNCode: a.hsn_code,
            Condition: a.condition || 'Good',
            SaleDetails: a.sale_details,
            IsSet: a.is_set === 1 || a.is_set === true,
            is_set: a.is_set === 1 || a.is_set === true,
            SetPriceMode: a.set_price_mode || 'SUM_OF_CHILDREN',
            set_price_mode: a.set_price_mode || 'SUM_OF_CHILDREN',
            // isComponent should ONLY be true for items in the components table
            // Items with a parentid but NOT in the components table are "Split Assets" or "Sub-Assets"
            // which should be counted as real assets in the dashboard.
            isComponent: isTrueComponent,
            isSplitChild: hasParent && !isTrueComponent,
            isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
          };
          
          // Decrypt sensitive fields
          try {
              if (a.serialno) {
                const val = encryptionService.universalDecrypt(a.serialno);
                decrypted.serialno = val;
                decrypted.SerialNo = val;
              }
              if (a.srno) {
                const val = encryptionService.universalDecrypt(a.srno);
                decrypted.srno = val;
                decrypted.SrNo = val;
              }
              if (a.macaddress) {
                const val = encryptionService.universalDecrypt(a.macaddress);
                decrypted.macaddress = val;
                decrypted.MACAddress = val;
              }
              if (a.ipaddress) {
                const val = encryptionService.universalDecrypt(a.ipaddress);
                decrypted.ipaddress = val;
                decrypted.IPAddress = val;
              }
              if (a.socketid) {
                const val = encryptionService.universalDecrypt(a.socketid);
                decrypted.socketid = val;
                decrypted.SocketID = val;
              }
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
                PurchaseDate: a.purchasedate,
                BoughtAgainstPO: a.boughtagainstpo,
                SentAgainstDC: a.sentagainstdc,
                Remarks: a.remarks,
                IsRetired: a.is_retired || 0,
                isComponent: false, // In fallback, we don't know for sure, so don't exclude
                isSplitChild: hasParent,
                isQuantitySubAsset: a.quantity_root_id != null && String(a.quantity_root_id).trim() !== ''
            };
        });
      }
    };

    // If 'all' is requested, return all assets (flat array) for global cache
    if (all === 'true') {
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

        const assets = await query
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

    // 1.3 Availability Filter (Strict for Workspace)
    if (req.query.availableOnly === 'true') {
        query.where(function() {
            this.where('a.quantity_available', '>', 0)
                .orWhereNull('a.quantity_available');
        });
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
                  .orWhere('a.hsn_code', 'like', searchParam)
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
        const allowedFields = ['id', 'itemname', 'status', 'type', 'category', 'make', 'model', 'serialno', 'currentlocation', 'assignedto', 'weight', 'hsn_code'];
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

    const response = {
        last_page: last_page,
        data: processedAssets,
        total_records: totalRecords
    };

    // Only cache the first page of "all" or "project" requests to keep cache size manageable
    if (page === 1 && !req.query.search && !req.query.filters) {
        await cache.set(cacheKey, response, 300); // Cache for 5 mins
    }

    res.json(response);

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
    let asset = await db('assets as a')
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
      .select('a.*', 'it.macaddress', 'it.ipaddress', 'it.networktype', 'it.physicalport', 'it.vlan', 'it.socketid', 'it.userid', 'p.projectname as AssignedProjectName', 'p.id as AssignedProjectID')
      .whereRaw('LOWER(a.id) = LOWER(?)', [id])
      .first();
      
    if (!asset) {
        asset = await db('components').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
        if (asset) asset.isComponent = true;
    }

    if (!asset) {
      console.warn(`[API] Asset/Component not found: ${id}`);
      return res.status(404).send('Asset not found');
    }

    const normalizedAsset = normalizeResult(asset);

    // Redact Price if unauthorized
    if (!hasViewPrice) {
      delete normalizedAsset.asset_value;
      delete normalizedAsset.unitprice;
      delete normalizedAsset.currency;
    }

    // Decrypt sensitive fields
    try {
        if (normalizedAsset.serialno) {
            const val = encryptionService.universalDecrypt(normalizedAsset.serialno);
            normalizedAsset.serialno = val;
            normalizedAsset.SerialNo = val;
        }
        if (normalizedAsset.srno) {
            const val = encryptionService.universalDecrypt(normalizedAsset.srno);
            normalizedAsset.srno = val;
            normalizedAsset.SrNo = val;
        }
        if (normalizedAsset.macaddress) {
            const val = encryptionService.universalDecrypt(normalizedAsset.macaddress);
            normalizedAsset.macaddress = val;
            normalizedAsset.MACAddress = val;
        }
        if (normalizedAsset.ipaddress) {
            const val = encryptionService.universalDecrypt(normalizedAsset.ipaddress);
            normalizedAsset.ipaddress = val;
            normalizedAsset.IPAddress = val;
        }
        if (normalizedAsset.socketid) {
            const val = encryptionService.universalDecrypt(normalizedAsset.socketid);
            normalizedAsset.socketid = val;
            normalizedAsset.SocketID = val;
        }
    } catch (e) {
        console.warn(`[ENCRYPT] Failed to decrypt sensitive fields for ${id}:`, e.message);
    }

    // Fetch True Components (from components table)
    const trueComponents = await db('components').whereRaw('LOWER(parentid) = LOWER(?)', [id.toLowerCase()]);
    // Fetch Split Children (from assets table where parentid is this id)
    const splitChildren = await db('assets').whereRaw('LOWER(parentid) = LOWER(?)', [id.toLowerCase()]);
    
    // --- ROBUST CHILD FETCHING: Ensure unique IDs across both tables ---
    const childMap = new Map();
    
    // 1. Add split children (real assets) first - they take priority
    normalizeResult(splitChildren).forEach(c => {
        childMap.set((c.id || c.ID).toLowerCase(), { ...c, isComponent: false, isSplitChild: true });
    });
    
    // 2. Add true components only if not already present as a full asset
    normalizeResult(trueComponents).forEach(c => {
        const cId = (c.id || c.ID).toLowerCase();
        if (!childMap.has(cId)) {
            childMap.set(cId, { ...c, isComponent: true });
        }
    });

    const children = Array.from(childMap.values());
    normalizedAsset.components = children;

    // --- SET PRICE CALCULATION ---
    if (normalizedAsset.IsSet && normalizedAsset.SetPriceMode === 'SUM_OF_CHILDREN') {
        let calculatedValue = 0;
        children.forEach(c => {
            // Only add assets that are not components of other sub-items (to avoid double counting if nested)
            // For now, just sum all direct split children that have a value
            if (c.AssetValue) {
                calculatedValue += parseFloat(c.AssetValue);
            }
        });
        // Add parent's own value if it has one (though usually the parent is just a container)
        // calculatedValue += parseFloat(normalizedAsset.asset_value || 0);
        
        normalizedAsset.AssetValue = calculatedValue;
        normalizedAsset.asset_value = calculatedValue;
    }

    const auditHistory = await db('audit_log').whereRaw('LOWER(assetid) = LOWER(?)', [id]).orderBy('timestamp', 'desc');
    const structuredHistory = await db('asset_history').whereRaw('LOWER(assetid) = LOWER(?)', [id]).orderBy('timestamp', 'desc');
    const parent = normalizedAsset.parentid ? await db('assets').whereRaw('LOWER(id) = LOWER(?)', [normalizedAsset.parentid]).first() : null;

    console.log(`[API] Asset History fetch for ${id}: audit_log=${auditHistory.length}, asset_history=${structuredHistory.length}`);

    let quantity = null
    let quantityChildren = []
    let quantityParent = null
    let quantityRoot = null
    let quantityEvents = []
    
    if (normalizedAsset.quantity_root_id) {
      quantity = {
        rootId: normalizedAsset.quantity_root_id,
        parentId: normalizedAsset.quantity_parent_id || null,
        unit: normalizedAsset.quantity_unit || null,
        total: normalizedAsset.quantity_total ?? null,
        available: normalizedAsset.quantity_available ?? null,
        precision: normalizedAsset.quantity_precision ?? null
      }

      quantityChildren = await db('assets').whereRaw('LOWER(quantity_parent_id) = LOWER(?)', [id]).orderBy('lastupdated', 'desc');
      quantityParent = normalizedAsset.quantity_parent_id ? await db('assets').whereRaw('LOWER(id) = LOWER(?)', [normalizedAsset.quantity_parent_id]).first() : null;
      quantityRoot = normalizedAsset.quantity_root_id ? await db('assets').whereRaw('LOWER(id) = LOWER(?)', [normalizedAsset.quantity_root_id]).first() : null;
      
      quantityEvents = await db('quantity_events')
        .whereRaw('LOWER(root_id) = LOWER(?)', [normalizedAsset.quantity_root_id])
        .orderBy('timestamp', 'desc')
        .limit(50);
    }

    console.log(`[API] Successfully fetched details for ${id}`);
    const payload = { 
      asset: normalizedAsset, 
      children: children || [], 
      history: normalizeResult(auditHistory) || [], 
      structuredHistory: normalizeResult(structuredHistory) || [],
      parent: normalizeResult(parent) || null, 
      quantity: quantity || null, 
      quantityChildren: normalizeResult(quantityChildren) || [], 
      quantityParent: normalizeResult(quantityParent) || null, 
      quantityRoot: normalizeResult(quantityRoot) || null, 
      quantityEvents: normalizeResult(quantityEvents) || [] 
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
    const assets = await db('assets').select('id');
    const existingIds = new Set(assets.map(a => a.id || a.ID));
    
    const now = new Date().toISOString();
    const toInsert = [];

    stockItems.forEach(item => {
      const name = item.NAME || item.NAME_ATTRIBUTE || 'Unknown Tally Item';
      const id = `TALLY_${name.replace(/\s+/g, '_')}`;
      
      if (!existingIds.has(id)) {
        toInsert.push(normalizeDBData({
          ID: id,
          ItemName: name,
          Status: 'In Store',
          Type: 'Tally Item',
          Category: 'Imported',
          LastUpdated: now,
          Remarks: `Imported from Tally (${reportName})`
        }));
        importedCount++;
      }
    });

    if (toInsert.length > 0) {
      // Chunk inserts for Postgres performance and safety
      const chunkSize = 50;
      for (let i = 0; i < toInsert.length; i += chunkSize) {
        await db('assets').insert(toInsert.slice(i, i + chunkSize)).onConflict('id').ignore();
      }
    }

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
        let q = db('hsn_codes');
        if (query) {
            const searchParam = `%${query}%`;
            q.where('code', 'ilike', searchParam).orWhere('description', 'ilike', searchParam);
        }
        const rows = await q.orderBy('code', 'asc').limit(50);
        res.json({ success: true, data: normalizeResult(rows) });
    } catch (err) {
        console.error('HSN Fetch Error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Delivery Challan Endpoints
app.get('/api/dc', async (req, res) => {
  try {
    const dcs = await db('delivery_challans').orderBy('timestamp', 'desc');
    const normalizedDcs = normalizeResult(dcs);
    
    // Enrich with serial numbers for display if missing in payload
    const enrichedDcs = await Promise.all(normalizedDcs.map(async (dc) => {
      let payload = null;
      try {
        payload = dc.PayloadJSON ? (typeof dc.PayloadJSON === 'string' ? JSON.parse(dc.PayloadJSON) : dc.PayloadJSON) : null;
      } catch (e) {}

      // If payload items already have srNo, just return
      if (payload && payload.items && payload.items.some(it => it.srNo)) {
        return dc;
      }

      // Otherwise, fetch asset IDs and their serial numbers
      let assetIds = [];
      try {
        assetIds = dc.AssetIds ? (typeof dc.AssetIds === 'string' ? JSON.parse(dc.AssetIds) : dc.AssetIds) : [];
      } catch (e) {}

      if (assetIds.length > 0) {
        const assets = await db('assets').select('id', 'srno').whereIn('id', assetIds);
        const srMap = {};
        assets.forEach(a => srMap[a.id.toLowerCase()] = a.srno);

        if (payload && payload.items) {
          payload.items = payload.items.map(it => ({
            ...it,
            srNo: srMap[String(it.assetId).toLowerCase()] || ''
          }));
          dc.PayloadJSON = payload; // Update the object for the response
        }
      }
      return dc;
    }));

    res.json(enrichedDcs);
  } catch (err) {
    console.error('DC Fetch Error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/dc/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const row = await db('delivery_challans')
      .where('id', id)
      .orWhere('challanno', id)
      .first();
    
    const normalized = normalizeResult(row);

    if (!normalized) return res.status(404).json({ success: false, error: 'DC not found' });

    let payload = null;
    try {
      payload = normalized.payloadjson ? (typeof normalized.payloadjson === 'string' ? JSON.parse(normalized.payloadjson) : normalized.payloadjson) : null;
    } catch {
      payload = null;
    }

    let assetIds = [];
    try {
      assetIds = normalized.assetids ? (typeof normalized.assetids === 'string' ? JSON.parse(normalized.assetids) : normalized.assetids) : [];
    } catch {
      assetIds = [];
    }

    res.json({
      success: true,
      dc: normalized,
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
    
    // 1. Prepare Data
    const normalizedAssetIds = Array.isArray(AssetIds) ? AssetIds : [];
    const assetsForDc = await Promise.all(normalizedAssetIds.map(async (assetId) => {
      const row = await db('assets')
        .select('id', 'itemname', 'srno', 'weight', 'is_set', 'quantity_root_id', 'quantity_parent_id', 'quantity_unit', 'quantity_total', 'quantity_available', 'quantity_precision')
        .whereRaw('LOWER(id) = LOWER(?)', [assetId])
        .first();
      
      const asset = normalizeResult(row) || { id: assetId };
      
      // If it's a set, fetch components for the "Hybrid" view
      if (asset.IsSet) {
          const children = await db('assets')
            .whereRaw('LOWER(parentid) = LOWER(?)', [assetId])
            .select('id', 'itemname', 'srno', 'make', 'model');
          asset.components = normalizeResult(children);
      }
      
      return asset;
    }));

    // 2. Atomic Transaction
    const runCreateTransaction = async (trx) => {
        const now = new Date();
        const shortYear = String(now.getFullYear()).slice(-2);
        let nextSeq = 1;

        try {
            const lastDc = await trx('delivery_challans')
                .whereRaw('challanno LIKE ?', [`${shortYear}/%`])
                .orderBy('timestamp', 'desc')
                .first();
            
            const normalizedLastDc = normalizeResult(lastDc);

            if (normalizedLastDc && normalizedLastDc.challanno) {
                const parts = normalizedLastDc.challanno.split('/');
                if (parts.length === 2) {
                    const lastSeq = parseInt(parts[1], 10);
                    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
                }
            }
        } catch (err) {
            console.error('Error fetching last DC number:', err);
            nextSeq = Math.floor(1000 + Math.random() * 9000); 
        }

        const challanNo = `${shortYear}/${String(nextSeq).padStart(4, '0')}`;
        const id = `DC${Date.now()}`;
        const timestamp = now.toISOString();

        // 3. Update Assets & Link to PO items
        if (normalizedAssetIds.length > 0) {
            await trx('assets')
                .whereIn('id', normalizedAssetIds)
                .update({
                    sentagainstdc: challanNo,
                    boughtagainstpo: POReference ? POReference.PONumber : null 
                });
            
            if (POReference) {
                for (const assetId of normalizedAssetIds) {
                    const asset = assetsForDc.find(a => a.id === assetId);
                    const itemName = asset?.itemname || '';
                    
                    const matchingItem = await trx('project_order_items')
                        .where('orderid', POReference.OrderID)
                        .andWhere(function() {
                            this.where('itemdescription', itemName).orWhere('itemdescription', 'like', `%${itemName}%`);
                        })
                        .select('srno')
                        .first();

                    const normalizedMatch = normalizeResult(matchingItem);
                    if (normalizedMatch) {
                        await trx('project_order_items')
                            .where({ orderid: POReference.OrderID, srno: normalizedMatch.srno })
                            .update({ assetid: assetId });
                    }
                }
            }
        }

        // 4. Initial Payload (without QR)
        let finalPayload;
        if (payload && typeof payload === 'object') {
            finalPayload = payload;
            // Enrich descriptions for sets if not already manually edited
            if (Array.isArray(finalPayload.items)) {
                finalPayload.items = finalPayload.items.map(item => {
                    const asset = assetsForDc.find(a => (a.id || a.ID).toLowerCase() === (item.assetId || '').toLowerCase());
                    if (asset && asset.IsSet && Array.isArray(asset.components) && asset.components.length > 0) {
                        const compList = asset.components.map(c => c.itemname || c.ItemName).join(', ');
                        const suffix = `\nwith: ${compList}`;
                        if (!item.description.includes('with:')) {
                            item.description += suffix;
                        }
                    }
                    return item;
                });
            }
        } else {
            finalPayload = {
              company: {},
              consignee: { name: CustomerName || '' },
              buyer: { name: CustomerName || '' },
              meta: {
                deliveryNoteNo: challanNo,
                dated: DeliveryDate || ''
              },
              items: assetsForDc.map((a) => {
                let description = a.itemname || a.id;
                
                // Hybrid View: Append components to description if it's a set
                if (a.IsSet && Array.isArray(a.components) && a.components.length > 0) {
                    const compList = a.components.map(c => c.itemname || c.ItemName).join(', ');
                    description += `\nwith: ${compList}`;
                }

                return {
                  assetId: a.id,
                  description: description,
                  srNo: a.srno || '',
                  hsn: '',
                  qty: 1,
                  per: 'NO',
                  rate: '',
                  amount: '',
                  isSet: a.IsSet ? 1 : 0,
                  quantity: a.quantity_root_id ? {
                    rootId: a.quantity_root_id,
                    parentId: a.quantity_parent_id || null,
                    unit: a.quantity_unit || null,
                    available: a.quantity_available ?? null,
                    total: a.quantity_total ?? null,
                    precision: a.quantity_precision ?? null
                  } : null
                };
              })
            };
        }

        const insertData = {
          id: id,
          challanno: challanNo,
          customername: CustomerName || '',
          deliverydate: DeliveryDate || '',
          assetids: JSON.stringify(normalizedAssetIds),
          status: 'Initializing',
          qrcode: '',
          createdby: CreatedBy || 'System',
          timestamp: timestamp,
          payloadjson: JSON.stringify(finalPayload)
        };

        await trx('delivery_challans').insert(insertData);

        return { id, challanNo, payload: finalPayload };
    };

    const createResult = await db.transaction(runCreateTransaction);
    const { id, challanNo, payload: dcPayload } = createResult;

    // 3. Check for Project Association
    try {
        const refNo = dcPayload.meta?.referenceNo;
        if (refNo) {
            const project = await db('projects').where('projectname', refNo).select('id').first();
            if (project) {
                const projectId = project.id;
                console.log(`Linking DC assets to Project: ${projectId} (${refNo})`);
                
                await db.transaction(async (trx) => {
                    for (const assetId of normalizedAssetIds) {
                        const existing = await trx('project_assets').where('assetid', assetId).select('projectid').first();
                        if (existing && existing.projectid !== projectId) {
                            console.warn(`Skipping auto-assignment for ${assetId}: Already assigned to ${existing.projectid}`);
                            continue; 
                        }

                        await trx('project_assets').insert({
                            projectid: projectId,
                            assetid: assetId,
                            assigneddate: new Date().toISOString(),
                            type: 'DC'
                        }).onConflict(['projectid', 'assetid']).ignore();
                        
                        await trx('assets').where('id', assetId).update({
                            assignedto: `Project: ${refNo}`,
                            currentlocation: 'On Site'
                        });

                        await logAssetHistory(assetId, 'PROJECT_CHANGE', 'General Stock', `Project: ${refNo}`, CreatedBy || 'System', `Assigned via Delivery Challan ${challanNo}`);
                    }
                });
            }
        }
    } catch (linkErr) {
        console.error('Error linking DC assets to project:', linkErr);
    }

    // 4. Generate QR Code
    const qrData = JSON.stringify({
      id: id,
      no: challanNo,
      customer: CustomerName,
      date: DeliveryDate,
      assets: normalizedAssetIds,
      Type: "DC",
      ID: id
    });
    
    const qrCode = await qrcode.toDataURL(qrData);
    await db('delivery_challans').where('id', id).update({ qrcode: qrCode, status: 'Pending' });

    // 5. Update PO Item Status
    if (POReference && POReference.OrderID) {
        for (const assetId of normalizedAssetIds) {
            const asset = await db('assets').where('id', assetId).select('linked_po_item_id').first();
            if (asset && asset.linked_po_item_id) {
                await db('project_order_items').where('id', asset.linked_po_item_id).update({ status: 'Shipped' });
                console.log(`[DC] Explicitly marked PO Item ${asset.linked_po_item_id} as Shipped via DC ${challanNo}`);
            }
        }
    }

    await logAudit(CreatedBy || 'System', 'DC_CREATED', `Created Delivery Challan ${challanNo} for ${CustomerName}`, id);

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

// DC Remarks Templates Endpoints
app.get('/api/dc-remarks', async (req, res) => {
    try {
        const hasTable = await db.schema.hasTable('dc_remark_templates');
        if (!hasTable) {
            await db.schema.createTable('dc_remark_templates', table => {
                table.increments('id').primary();
                table.string('title').notNullable();
                table.text('content').notNullable();
                table.timestamp('created_at').defaultTo(db.fn.now());
                table.timestamp('updated_at').defaultTo(db.fn.now());
            });
        }
        const templates = await db('dc_remark_templates').orderBy('title', 'asc');
        res.json({ success: true, templates: normalizeResult(templates) });
    } catch (err) {
        console.error('Error fetching remark templates:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/dc-remarks', async (req, res) => {
    try {
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }
        const now = new Date().toISOString();
        const ids = await db('dc_remark_templates').insert({
            title,
            content,
            created_at: now,
            updated_at: now
        }).returning('id');
        
        res.json({ success: true, id: ids[0].id || ids[0] });
    } catch (err) {
        console.error('Error creating remark template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/dc-remarks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { title, content } = req.body;
        if (!title || !content) {
            return res.status(400).json({ success: false, error: 'Title and content are required' });
        }
        const now = new Date().toISOString();
        const changes = await db('dc_remark_templates')
            .where('id', id)
            .update({ title, content, updated_at: now });
            
        if (changes > 0) {
            res.json({ success: true });
        } else {
            res.status(404).json({ success: false, error: 'Template not found' });
        }
    } catch (err) {
        console.error('Error updating remark template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/dc-remarks/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const changes = await db('dc_remark_templates').where('id', id).delete();
        if (changes > 0) {
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

    // 1. Try Cache First for "all" request
    if (all === 'true') {
        const port = process.env.PORT || 8080;
        const cacheKey = `employees:all:${port}`;
        const cached = await cache.get(cacheKey);
        if (cached) {
            console.log(`[CACHE] Serving all employees from cache for port ${port}`);
            return res.json(cached);
        }

        const employees = await db('employees')
            .select('id as ID', 'employeeid as EmployeeID', 'name as Name', 'department as Department', 'designation as Designation', 'email as Email', 'phone as Phone', 'status as Status', 'lastupdated as LastUpdated')
            .orderBy('name', 'asc');
            
        const normalized = normalizeResult(employees);
        await cache.set(cacheKey, normalized, 300); // Cache for 5 mins
        return res.json(normalized);
    }

    // Pagination logic
    const pageNum = parseInt(page) || 1;
    const sizeNum = parseInt(size) || 20; // Default to 20 for cards view
    const offset = (pageNum - 1) * sizeNum;
    
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
        data: normalizeResult(employees),
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
app.get('/api/quotas', async (req, res) => {
    try {
        const quotas = await db('department_quotas').select('*');
        res.json(normalizeResult(quotas));
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/api/quotas', async (req, res) => {
    const { department, category, quota } = req.body;
    try {
        await db('department_quotas')
            .insert(normalizeDBData({ department, category, quota }))
            .onConflict(['department', 'category'])
            .merge();
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.delete('/api/quotas/:dept/:cat', async (req, res) => {
    try {
        await db('department_quotas')
            .where({ department: req.params.dept, category: req.params.cat })
            .delete();
        res.json({ success: true });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Get employee asset history
app.get('/api/employees/:name/history', async (req, res) => {
    const name = req.params.name;
    console.log(`[DEBUG] Fetching history for employee: [${name}]`);
    try {
        const history = await db('audit_log as a')
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
        
        console.log(`[DEBUG] Found ${history.length} history records for employee: ${name}`);
        res.json(normalizeResult(history));
    } catch (err) {
        console.error('[ERROR] Error fetching employee history:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/employees', async (req, res) => {
  try {
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;
    if (!Name || !EmployeeID) return res.status(400).send('Name and EmployeeID are required');

    // UPSERT LOGIC: Check if EmployeeID already exists
    const existing = await db('employees').where('employeeid', EmployeeID).first();
    
    const data = normalizeDBData({
        EmployeeID,
        Name,
        Department: Department || '',
        Designation: Designation || '',
        Email: Email || '',
        Phone: Phone || '',
        Status: Status || 'ACTIVE',
        LastUpdated: new Date().toISOString()
    });

    if (existing) {
        // Update existing
        await db('employees').where('employeeid', EmployeeID).update(data);
        await invalidateEmployeesCache();
        return res.json({ success: true, id: existing.id, updated: true });
    } else {
        // Create new
        const id = `EMP${Date.now()}`;
        await db('employees').insert({ ...data, ID: id });
        await invalidateEmployeesCache();
        return res.json({ success: true, id, created: true });
    }
  } catch (err) {
    console.error('Failed to save employee:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/api/employees/bulk', async (req, res) => {
  try {
    const employees = req.body;
    if (!Array.isArray(employees)) {
      return res.status(400).send('Expected an array of employees');
    }

    console.log(`[BULK EMPLOYEES] Processing ${employees.length} records...`);
    const timestamp = new Date().toISOString();
    let createdCount = 0;
    let updatedCount = 0;

    for (const emp of employees) {
        if (!emp.EmployeeID) continue; // Skip records without an ID anchor

        const data = normalizeDBData({
            EmployeeID: emp.EmployeeID,
            Name: emp.Name || '',
            Department: emp.Department || '',
            Designation: emp.Designation || '',
            Email: emp.Email || '',
            Phone: emp.Phone || '',
            Status: emp.Status || 'ACTIVE',
            LastUpdated: timestamp
        });

        // Check if exists
        const existing = await db('employees').where('employeeid', emp.EmployeeID).first();
        if (existing) {
            await db('employees').where('employeeid', emp.EmployeeID).update(data);
            updatedCount++;
        } else {
            const id = `EMP${Date.now()}${createdCount}`;
            await db('employees').insert({ ...data, ID: id });
            createdCount++;
        }
    }

    await invalidateEmployeesCache();
    res.json({ success: true, created: createdCount, updated: updatedCount, total: employees.length });
  } catch (err) {
    console.error('Bulk employee upload error:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.put('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { EmployeeID, Name, Department, Designation, Email, Phone, Status } = req.body;

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
    await invalidateEmployeesCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to update employee:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/employees/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const changes = await db('employees').where('id', id).del();
    if (changes === 0) return res.status(404).send('Employee not found');
    await invalidateEmployeesCache();
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to delete employee:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/asset_kinds', async (req, res) => {
  try {
    const port = process.env.PORT || 8080;
    const cacheKey = `asset:kinds:${port}`;
    const cached = await cache.get(cacheKey);
    if (cached) {
        console.log('[CACHE] Serving asset kinds from cache');
        return res.json(cached);
    }

    const kinds = await db('asset_kinds')
        .where(function() {
            this.where('is_deleted', 0).orWhereNull('is_deleted');
        })
        .orderBy('name', 'asc');
    
    const normalized = normalizeResult(kinds);
    await cache.set(cacheKey, normalized, 86400); // Cache for 24 hours
    res.json(normalized);
  } catch (err) {
    console.error('Failed to fetch asset kinds:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/asset_kinds/:name', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
  try {
    const { name } = req.params;
    const now = new Date().toISOString();
    
    const changes = await db('asset_kinds').where('name', name).update({ is_deleted: 1, deleted_at: now });

    if (changes > 0) {
      await invalidateAssetKindsCache();
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
    const folders = await db('folders').orderBy('id', 'asc');
    res.json(normalizeResult(folders));
  } catch (err) {
    console.error('Failed to fetch folders:', err);
    res.status(500).send('Database error');
  }
});

app.post('/api/folders', async (req, res) => {
  try {
    const { ID, Name, ParentID, Icon, Module, Order } = req.body;
    if (!Name) return res.status(400).send('Name is required');
    
    const id = ID || `F${Date.now()}`;
    const dataToInsert = {
        id: id,
        name: Name,
        parentid: ParentID || null,
        icon: Icon || '📂',
        module: Module || 'IT',
        createdby: req.user ? req.user.username : 'system',
        timestamp: new Date().toISOString()
    };

    console.log('[FOLDERS] Saving folder:', dataToInsert);

    await db('folders')
        .insert(dataToInsert)
        .onConflict('id')
        .merge();
    
    res.json({ ok: true, id });
  } catch (err) {
    console.error('Failed to save folder:', err);
    res.status(500).send('Database error: ' + err.message);
  }
});

app.post('/api/asset_kinds', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager'), async (req, res) => {
  try {
    const { Name, Module, Icon, ParentName, ParentID, DisplayImage, Identifier } = req.body;
    
    if (!Name) return res.status(400).send('Name is required');

    // Accept both ParentName or ParentID for hierarchy flexibility
    const actualParent = ParentID || ParentName || null;

    await db('asset_kinds')
        .insert(normalizeDBData({
            Name,
            Module: Module || '',
            Icon: Icon || '📦',
            ParentName: actualParent,
            LastUpdated: new Date().toISOString(),
            DisplayImage: DisplayImage || null,
            Identifier: Identifier || null
        }))
        .onConflict('name')
        .merge();
    
    await invalidateAssetKindsCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save asset kind:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/folders/:id', authenticateJWT, async (req, res) => {
  try {
    // Check for specific hierarchy permission
    const permissions = await getPermissionsForUser(req.user.id);
    if (req.user.role !== 'superuser' && !permissions.includes('manage.hierarchy')) {
        return res.status(403).send('Unauthorized: You do not have permission to delete folders.');
    }

    const { id } = req.params;
    
    // Check if there are any child kinds (categories) linked to this folder
    const folder = await db('folders').where('id', id).first();
    if (!folder) return res.status(404).send('Folder not found');

    const children = await db('asset_kinds').where('parentname', folder.name).count('name as count').first();
    if (parseInt(children.count) > 0) {
        return res.status(400).send(`Cannot delete folder. It still contains ${children.count} categories. Move or delete them first.`);
    }

    await db('folders').where('id', id).del();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete folder:', err);
    res.status(500).send('Database error');
  }
});

app.delete('/api/asset_kinds/:name', authenticateJWT, async (req, res) => {
  try {
    // Check for specific hierarchy permission
    const permissions = await getPermissionsForUser(req.user.id);
    if (req.user.role !== 'superuser' && !permissions.includes('manage.hierarchy')) {
        return res.status(403).send('Unauthorized: You do not have permission to delete categories.');
    }

    const { name } = req.params;

    // Check if any assets are using this category
    const assetsCount = await db('assets').where('type', name).count('id as count').first();
    if (parseInt(assetsCount.count) > 0) {
        return res.status(400).send(`Cannot delete category. It is currently assigned to ${assetsCount.count} assets.`);
    }

    // Check for sub-categories (Brands)
    const subCategories = await db('asset_kinds').where('parentname', name).count('name as count').first();
    if (parseInt(subCategories.count) > 0) {
        return res.status(400).send(`Cannot delete category. It has ${subCategories.count} sub-categories (Brands).`);
    }

    await db('asset_kinds').where('name', name).del();
    await invalidateAssetKindsCache();
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to delete asset kind:', err);
    res.status(500).send('Database error');
  }
});

// Projects API
app.get('/api/projects', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager', 'user', 'it_user', 'it_manager'), async (req, res) => {
    try {
        const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
        const userDept = req.user.department;
        const userProjectId = req.user.projectId; 
        
        let query = db('projects').where(function() {
            this.where('is_deleted', 0).orWhereNull('is_deleted');
        });

        // Apply Department/Project Segregation for non-admins
        if (!isAdmin) {
            if (userProjectId) {
                query.where('id', userProjectId);
            } else if (userDept) {
                query.where(function() {
                    this.where('location', userDept).orWhereNull('location').orWhere('location', '');
                });
            }
        }

        const projects = await query.orderBy('timestamp', 'desc');
        res.json(normalizeResult(projects));
    } catch (err) {
        console.error('Failed to fetch projects:', err);
        res.status(500).json({ error: 'Failed to fetch projects' });
    }
});

app.delete('/api/projects/:id', authenticateJWT, authorizeRoles('superuser', 'admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const now = new Date().toISOString();
        
        await db.transaction(async (trx) => {
            // 1. Mark Project as Deleted
            await trx('projects')
                .where('id', id)
                .update({ is_deleted: 1, deleted_at: now });

            // 2. Identify linked Regular Assets
            const linkedAssets = await trx('project_assets')
                .whereRaw('LOWER(projectid) = LOWER(?)', [id])
                .select('assetid');
            
            const assetIds = linkedAssets.map(a => a.assetid);

            if (assetIds.length > 0) {
                // 3. Reset Asset Status to "In-Stock" and remove project link
                // We only reset if they are currently "In-Use" or "Project Assigned"
                await trx('assets')
                    .whereIn('id', assetIds)
                    .whereIn('status', ['In-Use', 'Project Assigned', 'Shipped'])
                    .update({ 
                        status: 'In-Stock', 
                        lastupdated: now 
                    });

                // 4. Remove project_assets entries
                await trx('project_assets')
                    .whereRaw('LOWER(projectid) = LOWER(?)', [id])
                    .delete();
            }

            // 5. Handle Temporary Assets linked to this project
            await trx('temporary_assets')
                .whereRaw('LOWER(projectid) = LOWER(?)', [id])
                .update({ 
                    is_deleted: 1, 
                    deleted_at: now 
                });

            // 6. Log the action
            await appendAudit({
                Action: 'PROJECT_DELETED',
                User: req.user ? req.user.fullname || req.user.username : 'Admin',
                AssetId: id,
                Severity: 'WARNING',
                Details: `Project ${id} deleted. ${assetIds.length} regular assets unassigned and returned to stock. Linked temporary assets marked as deleted.`
            });
        });

        res.json({ success: true, message: 'Project deleted and assets unassigned successfully' });
    } catch (err) {
        console.error('Failed to delete project and cleanup assets:', err);
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

        await db('projects').insert(normalizeDBData(projectRecord));

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
    let query = db('users').select('username', 'fullname', 'role');
    
    // Superusers can see all users, others only their company
    if (req.user.role !== 'superuser') {
        query = query.where('company_id', companyId);
    }
    
    const users = await query;

    // Also fetch available roles for the dropdown
    const availableRoles = await db('roles').select('name', 'description');
    
    return res.json({ 
        ok: true, 
        users: normalizeResult(users),
        roles: normalizeResult(availableRoles)
    });
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
    const existing = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();

    if (existing) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    
    await db('users').insert(normalizeDBData({
        username,
        password: passwordHash,
        fullname: fullname || username,
        role: requestedRole,
        employee_id: employeeId || null,
        company_id: companyId,
        client_id: companyId
    }));
    
    await logAudit(req.user.user_id, 'USER_CREATE', `Created user ${username} with role ${requestedRole}`, username);

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

    if (role === 'superuser' && req.user.role !== 'superuser' && String(targetUsername) !== String(req.user.user_id)) {
      const existingSuper = await db('users').where({ company_id: companyId, role: 'superuser' }).first();

      if (existingSuper) {
        return res.status(403).json({ ok: false, message: 'Only an existing superuser can assign superuser role' });
      }
    }

    const changes = await db('users').whereRaw('LOWER(username) = LOWER(?)', [targetUsername]).update({ role });

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'User not found' });
    }

    await logAudit(req.user.user_id, 'USER_ROLE_UPDATE', `Updated role for ${targetUsername} to ${role}`, targetUsername);

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

    const changes = await db('users').whereRaw('LOWER(username) = LOWER(?)', [targetUsername]).andWhere('company_id', companyId).del();
    
    if (!changes) {
      return res.status(404).json({ ok: false, message: 'User not found for this company' });
    }

    await logAudit(req.user.user_id, 'USER_DELETE', `Deleted user ${targetUsername}`, targetUsername);

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
    const row = await db('companies').where('id', companyId).first();
    const normalized = normalizeResult(row);
    
    if (!normalized) {
      return res.json({
        ok: true,
        company: { name: DEFAULT_COMPANY_NAME }
      });
    }
    return res.json({
      ok: true,
      company: {
        name: normalized.name,
        createdAt: normalized.created_at
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
    const existingUser = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();

    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const fullname = email || username;
    const role = 'user';
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    
    await db('users').insert({
        username,
        password: passwordHash,
        fullname,
        role,
        employee_id: employeeId || null,
        company_id: companyId,
        client_id: companyId
    });
    
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
    const creds = await db('network_credentials').orderBy('device_name', 'asc');
    res.json({ ok: true, credentials: normalizeResult(creds) });
  } catch (err) {
    console.error('Error fetching credentials:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/network/credentials', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const { device_name, ip_address, type, username, password, notes } = req.body;
    if (!device_name) {
      return res.status(400).json({ ok: false, message: 'Device name is required' });
    }
    const id = 'NC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    
    await db('network_credentials').insert({
        id, device_name, ip_address, type, username, password, notes, created_by: req.user.user_id, created_at: now, updated_at: now
    });

    await logAudit(req.user.user_id, 'NETWORK_CRED_CREATE', `Created network credential for ${device_name}`, id);

    res.json({ ok: true, message: 'Credential created', id });
  } catch (err) {
    console.error('Error creating credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.put('/api/network/credentials/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { device_name, ip_address, type, username, password, notes } = req.body;
    const now = new Date().toISOString();

    const changes = await db('network_credentials')
        .where('id', id)
        .update({ device_name, ip_address, type, username, password, notes, updated_at: now });

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'Credential not found' });
    }

    await logAudit(req.user.user_id, 'NETWORK_CRED_UPDATE', `Updated network credential for ${device_name}`, id);

    res.json({ ok: true, message: 'Credential updated' });
  } catch (err) {
    console.error('Error updating credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.delete('/api/network/credentials/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const changes = await db('network_credentials').where('id', id).del();

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'Credential not found' });
    }

    await logAudit(req.user.user_id, 'NETWORK_CRED_DELETE', `Deleted network credential ${id}`, id);

    res.json({ ok: true, message: 'Credential deleted' });
  } catch (err) {
    console.error('Error deleting credential:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// Network Contacts API
app.get('/api/network/contacts', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const contacts = await db('network_contacts').orderBy('service', 'asc');
    res.json({ ok: true, contacts: normalizeResult(contacts) });
  } catch (err) {
    console.error('Error fetching contacts:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.post('/api/network/contacts', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const { service, provider, contact, email } = req.body;
    if (!service) {
      return res.status(400).json({ ok: false, message: 'Service name is required' });
    }
    const id = 'NC-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    const now = new Date().toISOString();
    
    await db('network_contacts').insert({
        id, service, provider, contact, email, created_by: req.user.user_id, created_at: now, updated_at: now
    });

    await logAudit(req.user.user_id, 'NETWORK_CONTACT_CREATE', `Created network contact for ${service}`, id);

    res.json({ ok: true, message: 'Contact created', id });
  } catch (err) {
    console.error('Error creating contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.put('/api/network/contacts/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_user', 'it_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const { service, provider, contact, email } = req.body;
    const now = new Date().toISOString();

    const changes = await db('network_contacts')
        .where('id', id)
        .update({ service, provider, contact, email, updated_at: now });

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'Contact not found' });
    }

    await logAudit(req.user.user_id, 'NETWORK_CONTACT_UPDATE', `Updated network contact for ${service}`, id);

    res.json({ ok: true, message: 'Contact updated' });
  } catch (err) {
    console.error('Error updating contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

app.delete('/api/network/contacts/:id', authenticateJWT, authorizeRoles('superuser', 'admin', 'it_manager'), async (req, res) => {
  try {
    const { id } = req.params;
    const changes = await db('network_contacts').where('id', id).del();

    if (!changes) {
      return res.status(404).json({ ok: false, message: 'Contact not found' });
    }

    await logAudit(req.user.user_id, 'NETWORK_CONTACT_DELETE', `Deleted network contact ${id}`, id);

    res.json({ ok: true, message: 'Contact deleted' });
  } catch (err) {
    console.error('Error deleting contact:', err);
    res.status(500).json({ ok: false, message: 'Internal server error' });
  }
});

// --- Project Search API for DC ---

app.get('/api/projects/search', authenticateJWT, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q) {
            return res.json({ success: true, projects: [] });
        }

        const searchTerm = `%${q}%`;
        const projects = await db('projects')
            .where('projectname', 'ilike', searchTerm)
            .orWhere('id', 'ilike', searchTerm)
            .select(
                'id', 'projectname', 
                'buyername', 'buyeraddress', 'buyergstin', 'buyerstate', 'buyerstatecode',
                'consigneename', 'consigneeaddress', 'consigneegstin', 'consigneestate', 'consigneestatecode'
            )
            .limit(10);

        res.json({ success: true, projects: normalizeResult(projects) });
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
    const existingUser = await db('users').whereRaw('LOWER(username) = LOWER(?)', [username]).first();
    if (existingUser) {
      return res.status(409).json({ ok: false, message: 'Username already exists' });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const companyId = req.user.company_id || DEFAULT_COMPANY_ID || DEFAULT_COMPANY_NAME;
    
    await db('users').insert(normalizeDBData({
        username,
        password: passwordHash,
        fullname: fullname || username,
        role: requestedRole,
        employee_id: employeeId || null,
        company_id: companyId,
        client_id: companyId
    }));
    
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
        asset.department = userDept;
    }

    // RBAC: Clear price if not allowed to set it
    if (!hasEditPrice) {
        asset.asset_value = 0;
        asset.unitprice = 0;
    }
    
    // Basic Validation
    if (!asset.ItemName && !asset.itemname) {
      return res.status(400).json({ success: false, error: 'Item Name is required' });
    }
    const itemName = asset.ItemName || asset.itemname || '';

    if (!asset.Category && !asset.category) {
      return res.status(400).json({ success: false, error: 'Category is required' });
    }
    const category = asset.Category || asset.category || '';

    if (!asset.Type && !asset.type) {
      return res.status(400).json({ success: false, error: 'Type (Kind) is required' });
    }
    const type = asset.Type || asset.type || '';

    console.log('Adding new asset:', itemName);
    
    // Generate unique ID if not present
    let newId = asset.id || asset.ID || asset.Id;
    if (!newId) {
      newId = generateModernAssetId(asset.CurrentLocation || asset.currentlocation || '', type);
      console.log('Generated Modern ID:', newId);
    } else {
      // --- CROSS-TABLE EXISTENCE GUARD ---
      const existingAsset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [newId.toLowerCase()]).first();
      if (existingAsset) {
        return res.status(400).json({ success: false, error: `Asset ID ${newId} already exists in full inventory.` });
      }
      const existingComp = await db('components').whereRaw('LOWER(id) = LOWER(?)', [newId.toLowerCase()]).first();
      if (existingComp) {
        return res.status(400).json({ success: false, error: `Asset ID ${newId} already exists as a No-QR component. Please promote it instead of creating a duplicate.` });
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
    let qrCode = asset.QRCode || asset.qrcode;
    const noQR = asset.NoQR || asset.noqr;
    if (!qrCode && !noQR) {
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
      ItemName: itemName,
      Status: asset.Status || asset.status || 'In Store',
      Make: asset.Make || asset.make || '',
      Model: asset.Model || asset.model || '',
      SrNo: encryptionService.encryptDeterministic(asset.SrNo || asset.srno || ''),
      Type: type,
      Category: category,
      parent_folder: asset.itemFolder || '',
      Icon: asset.Icon || asset.icon || '',
      isPlaceholder: 0,
      ParentId: asset.ParentId || asset.parentid || null,
      CurrentLocation: asset.CurrentLocation || asset.currentlocation || '',
      DispatchReceiveDt: asset.DispatchReceiveDt || asset.dispatchreceivedt || '',
      PurchaseDetails: asset.PurchaseDetails || asset.purchasedetails || '',
      Remarks: asset.Remarks || asset.remarks || '',
      LastUpdated: new Date().toISOString(),
      QRCode: qrCode || null,
      AssignedTo: asset.AssignedTo || asset.assignedto || '',
      client_label: initialClientLabel,
      NoQR: noQR ? 1 : 0,
      warranty_months: asset.warranty_months || 0,
      amc_months: asset.amc_months || 0,
      asset_value: asset.asset_value || 0,
      Currency: asset.Currency || asset.currency || 'USD',
      PurchaseDate: asset.PurchaseDate || asset.purchasedate || '',
      conversion_unit: asset.conversion_unit || null,
      conversion_factor: asset.conversion_factor || null,
      conversion_mode: asset.conversion_mode || 'multiply',
      is_quantity_tracked: asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0,
      is_batch: asset.is_batch || 0,
      is_set: asset.is_set || 0,
      set_price_mode: asset.set_price_mode || 'SUM_OF_CHILDREN'
    }));

    appendAudit({
      Action: 'CREATE',
      User: req.headers['x-user'] || 'web',
      AssetId: newId,
      Severity: 'INFO',
      Details: `Asset created: ${itemName} (${type})`
    });

    // Log to asset history
    await logAssetHistory(newId, 'CREATE', null, asset.Status || asset.status || 'In Store', req.headers['x-user'] || 'web', `Initial assignment to: ${asset.AssignedTo || asset.assignedto || 'None'}`);

    const qtyUnit = normalizeQtyUnit(asset.quantity_unit || asset.quantityUnit || asset.qty_unit || asset.qtyUnit)
    const qtyTotal = parseQtyNumber(asset.quantity_total ?? asset.quantityTotal ?? asset.qty_total ?? asset.qtyTotal)
    const qtyPrecision = parseQtyNumber(asset.quantity_precision ?? asset.quantityPrecision ?? asset.qty_precision ?? asset.qtyPrecision)
    const isQtyTracked = asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : 0;

    if (isQtyTracked && qtyUnit && qtyTotal !== null && qtyTotal > 0) {
      await db('assets')
        .where('id', newId)
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
    if (asset.MACAddress || asset.macaddress || asset.IPAddress || asset.ipaddress || asset.NetworkType || asset.networktype || asset.PhysicalPort || asset.physicalport || asset.VLAN || asset.vlan || asset.SocketID || asset.socketid || asset.UserID || asset.userid) {
      await db('asset_it_details').insert(normalizeDBData({
        AssetID: newId,
        MACAddress: encryptionService.encrypt(asset.MACAddress || asset.macaddress || ''),
        IPAddress: encryptionService.encryptDeterministic(asset.IPAddress || asset.ipaddress || ''),
        NetworkType: asset.NetworkType || asset.networktype || '',
        PhysicalPort: asset.PhysicalPort || asset.physicalport || '',
        VLAN: asset.VLAN || asset.vlan || '',
        SocketID: encryptionService.encrypt(asset.SocketID || asset.socketid || ''),
        UserID: asset.UserID || asset.userid || ''
      })).onConflict('assetid').merge();
    }

    // Handle nested components (new child assets)
    if (Array.isArray(asset.components) && asset.components.length > 0) {
      for (const comp of asset.components) {
        const compId = generateModernAssetId(asset.CurrentLocation || asset.currentlocation || '');
        await db('components').insert(normalizeDBData({
          ID: compId,
          ParentId: newId, 
          ItemName: comp.ItemName || comp.itemname || '',
          Make: comp.Make || comp.make || '',
          Model: comp.Model || comp.model || '',
          SrNo: comp.SrNo || comp.srno || '',
          Status: comp.Status || comp.status || asset.Status || asset.status || 'In Store',
          Type: comp.Type || comp.type || 'Component',
          Category: comp.Category || comp.category || category || '',
          LastUpdated: new Date().toISOString(),
          NoQR: 1 
        }));
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds) && asset.linkedIds.length > 0) {
      for (const linkId of asset.linkedIds) {
        const existingAsset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [linkId]).first();
        if (!existingAsset) continue;

        // Validation: Check if asset is already assigned to a parent
        const existingParentInAssets = existingAsset.parentid;
        const existingComp = await db('components').whereRaw('LOWER(id) = LOWER(?)', [linkId]).first();
        const existingParentInComps = existingComp ? existingComp.parentid : null;

        if ((existingParentInAssets && existingParentInAssets !== newId) || 
            (existingParentInComps && existingParentInComps !== newId)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        await db('components').insert(normalizeDBData({
          ID: linkId,
          ParentId: newId,
          ItemName: existingAsset.itemname,
          Make: existingAsset.make || '',
          Model: existingAsset.model || '',
          SrNo: existingAsset.srno || '',
          Status: existingAsset.status || 'In Store',
          Type: existingAsset.type || 'Component',
          Category: existingAsset.category || '',
          LastUpdated: new Date().toISOString(),
          NoQR: 0
        })).onConflict('id').merge();
        
        await db('assets').where('id', linkId).update({ parentid: newId });
      }
    }

    // 6. Link back to PO if applicable
    if (asset.linked_po_item_id) {
        try {
            await db('project_order_items')
              .where('id', asset.linked_po_item_id)
              .update({ assetid: newId, status: "Asset Created" });
            
            // Also update the asset record with PO linking info if not already set
            await db('assets')
              .where('id', newId)
              .update({
                linked_po_item_id: asset.linked_po_item_id,
                boughtagainstpo: asset.BoughtAgainstPO || null
              });
              
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
      Details: `Asset created: ${itemName}` 
    });

    await invalidateAssetsCache();
    res.json({ success: true, ID: newId });
  } catch (err) {
    console.error('Failed to create asset:', err);
    res.status(500).send('Error creating asset: ' + err.message);
  }
});

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
    const existing = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [newId]).first();
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    let qrCode = child.QRCode || null
    const noQr = child.NoQR ? 1 : 0
    if (!qrCode && !noQr) {
      const ip = getLocalIP()
      const port = process.env.PORT || 9090
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
      qrCode = await qrcode.toDataURL(urlText, { width: 512 })
    }

    const childId = await db.transaction(async (trx) => {
      const now = new Date().toISOString();
      
      const record = normalizeDBData({
        ID: newId,
        ItemName: child.ItemName || `${parent.ItemName || 'Item'} (Split)`,
        Status: child.Status || parent.Status || 'In Store',
        Make: child.Make || '',
        Model: child.Model || '',
        SrNo: child.SrNo || '',
        Type: child.Type || parent.Type || '',
        Category: child.Category || '',
        Icon: child.Icon || '',
        isPlaceholder: 0,
        ParentId: parentId,
        CurrentLocation: child.CurrentLocation || parent.CurrentLocation || '',
        DispatchReceiveDt: child.DispatchReceiveDt || '',
        PurchaseDetails: child.PurchaseDetails || '',
        Remarks: child.Remarks || '',
        LastUpdated: now,
        QRCode: qrCode,
        AssignedTo: assignedTo,
        NoQR: noQr ? 1 : 0,
        warranty_months: child.warranty_months || 0,
        amc_months: child.amc_months || 0,
        asset_value: child.asset_value || 0,
        Currency: child.Currency || 'INR',
        PurchaseDate: child.PurchaseDate || null,
        quantity_parent_id: parentId,
        quantity_root_id: rootId,
        quantity_unit: unit,
        quantity_total: 0,
        quantity_available: 0,
        quantity_precision: precision,
        quantity_updated_at: now
      });

      await trx('assets').insert(record);

      if (projectId) {
        await trx('project_assets').insert({
          projectid: projectId,
          assetid: newId,
          assigneddate: now,
          type: 'Permanent'
        });
      }

      await applyQuantityEvent({
        rootId,
        type: 'SPLIT',
        actor,
        note,
        metadata: { parentId, childId: newId },
        lines: [
          { assetId: parentId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: amount, deltaTotal: amount, precision }
        ]
      }, trx);

      appendAudit({
        Action: 'QTY_SPLIT',
        User: actor,
        AssetId: parentId,
        Severity: 'INFO',
        Details: `Split ${amount} ${unit} to ${newId}`
      });

      return newId;
    });
    res.json({ success: true, childId })
  } catch (err) {
    console.error('Quantity split failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

// --- SET LOGIC ENDPOINTS ---

/**
 * Combine multiple standalone assets into a Set.
 * Can either use an existing asset as parent or create a brand new container asset.
 */
app.post('/api/assets/make-set', authenticateJWT, async (req, res) => {
  let finalParentId = null; // Declare and initialize at the very top of the function
  try {
    let { parentAssetId, childAssetIds, setPriceMode, createNewParent, newParentName, headAssetId, parentQtyToSplit, childSplits } = req.body;
    const user = req.headers['x-user'] || 'web';

    finalParentId = parentAssetId; // Initial value

    console.log(`[LOGIC-ENGINE] Make Set. Parent: ${parentAssetId}, Children: ${childAssetIds?.length}`);

    await db.transaction(async (trx) => {
      // 1. DATA INHERITANCE
      const mainId = headAssetId || parentAssetId || (childAssetIds && childAssetIds[0]);
      if (!mainId) throw new Error('Could not determine head asset for inheritance.');

      let mainItemRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [mainId.toLowerCase()]).first();
      let mainItem = normalizeResult(mainItemRow);
      
      let category = mainItem?.Category || 'IT';
      let location = mainItem?.CurrentLocation || 'Mumbai';
      let status = mainItem?.Status || 'In Store';
      let projectId = null;

      const projLink = await trx('project_assets').whereRaw('LOWER(assetid) = LOWER(?)', [mainId.toLowerCase()]).first();
      if (projLink) projectId = projLink.projectid;

      // 2. PARENT LOGIC: Handle Batch Parent
      if (!createNewParent && parentAssetId) {
          const parentRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentAssetId.toLowerCase()]).first();
          const parent = normalizeResult(parentRow);
          
          if (parent && (parent.IsBatch || parent.IsQuantityTracked || (parent.QuantityTotal > 1))) {
              const qtyToSplit = parseFloat(parentQtyToSplit || 1);
              if (qtyToSplit > (parent.QuantityTotal || 0)) throw new Error(`Insufficient quantity in parent batch ${parent.ID}`);

              const segmentId = `${parent.ID}-${Date.now().toString().slice(-4)}`;
              await trx('assets').insert({
                  id: segmentId,
                  itemname: `${parent.ItemName} (Set Head)`,
                  category: parent.Category,
                  type: parent.Type,
                  status: projectId ? 'Project' : parent.Status,
                  currentlocation: parent.CurrentLocation,
                  quantity_total: qtyToSplit,
                  quantity_available: projectId ? 0 : qtyToSplit,
                  quantity_parent_id: parent.ID,
                  is_set: 1,
                  set_price_mode: 'SUM_OF_CHILDREN',
                  assignedto: projectId ? `Project: ${projectId}` : null,
                  lastupdated: new Date().toISOString()
              });

              // Update original
              const newTotal = (parent.QuantityTotal || 0) - qtyToSplit;
              await trx('assets').where('id', parent.ID).update({
                  quantity_total: newTotal,
                  quantity_available: Math.max(0, (parent.QuantityAvailable || parent.QuantityTotal || 0) - qtyToSplit),
                  status: newTotal <= 0 ? 'All Assigned' : parent.Status,
                  lastupdated: new Date().toISOString()
              });

              finalParentId = segmentId; // Update the scoped variable
              await logAssetHistory(parent.ID, 'BATCH_SEGMENTED', parent.QuantityTotal, newTotal, user, `Split ${qtyToSplit} to Set Head ${segmentId}`, trx);
          }
      }

      // 3. NEW CONTAINER LOGIC
      if (createNewParent) {
        const newId = generateModernAssetId(location, 'Set');
        finalParentId = newId; // Update the scoped variable

        await trx('assets').insert({
          id: newId,
          itemname: newParentName || 'New Set Bundle',
          status: projectId ? 'Project' : status,
          category: category,
          currentlocation: location,
          is_set: 1,
          noqr: 0, // Logic: Sets/Supersets are tracked assets
          set_price_mode: setPriceMode || 'SUM_OF_CHILDREN',
          assignedto: projectId ? `Project: ${projectId}` : null,
          lastupdated: new Date().toISOString()
        });
        
        await logAssetHistory(newId, 'MAKE_SET', null, 'CONTAINER_CREATED', user, `Created brand new set container.`, trx);
      } else if (finalParentId === parentAssetId) {
        // Standard promotion to SET if not a batch
        await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentAssetId.toLowerCase()]).update({
          is_set: 1,
          noqr: 0, // Logic: Promoted to set means it's a tracked asset
          status: projectId ? 'Project' : status,
          assignedto: projectId ? `Project: ${projectId}` : null,
          lastupdated: new Date().toISOString()
        });
        await logAssetHistory(parentAssetId, 'MAKE_SET', 'SINGLE', 'SET_PARENT', user, `Converted existing asset to a set parent.`, trx);
      }

      // --- LOGIC ENGINE: Ensure Parent is assigned to Project ---
      if (projectId && finalParentId) {
          await trx('project_assets').insert({
              projectid: projectId,
              assetid: finalParentId,
              assigneddate: new Date().toISOString(),
              type: 'Permanent'
          }).onConflict(['projectid', 'assetid']).merge();
      }

      // 4. CHILD LOGIC: Handle Child Splitting
      for (const childId of childAssetIds) {
        if (!finalParentId || childId.toLowerCase() === finalParentId.toLowerCase()) continue;

        let targetChildId = childId;
        const splitQty = childSplits ? parseFloat(childSplits[childId]) : null;

        if (splitQty) {
            const childItemRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [childId.toLowerCase()]).first();
            const childItem = normalizeResult(childItemRow);
            if (childItem && splitQty < (childItem.QuantityTotal || 0)) {
                const childSegmentId = `${childItem.ID}-S${Date.now().toString().slice(-3)}`;
                await trx('assets').insert({
                    id: childSegmentId,
                    itemname: childItem.ItemName,
                    category: childItem.Category,
                    type: childItem.Type,
                    status: projectId ? 'Project' : childItem.Status,
                    currentlocation: location,
                    quantity_total: splitQty,
                    quantity_available: projectId ? 0 : splitQty,
                    quantity_parent_id: childItem.ID,
                    parentid: finalParentId,
                    assignedto: projectId ? `Project: ${projectId}` : null,
                    lastupdated: new Date().toISOString()
                });
                const newChildTotal = (childItem.QuantityTotal || 0) - splitQty;
                await trx('assets').where('id', childItem.ID).update({
                    quantity_total: newChildTotal,
                    quantity_available: Math.max(0, (childItem.QuantityAvailable || childItem.QuantityTotal || 0) - splitQty),
                    status: newChildTotal <= 0 ? 'All Assigned' : childItem.Status,
                    lastupdated: new Date().toISOString()
                });
                targetChildId = childSegmentId;
            }
        }

        // --- PROMOTION LOGIC: Check both tables ---
        let assetRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [targetChildId.toLowerCase()]).first();
        let asset = normalizeResult(assetRow);

        if (!asset) {
            const compRow = await trx('components').whereRaw('LOWER(id) = LOWER(?)', [targetChildId.toLowerCase()]).first();
            if (compRow) {
                const comp = normalizeResult(compRow);
                const promoData = {
                    itemname: comp.ItemName || comp.itemname,
                    make: comp.Make || comp.make || '',
                    model: comp.Model || comp.model || '',
                    srno: comp.SrNo || comp.srno || '',
                    status: projectId ? 'Project' : status,
                    category: comp.Category || comp.category || category,
                    type: comp.Type || comp.type || 'Accessory',
                    is_set: 0,
                    parentid: finalParentId,
                    currentlocation: location,
                    assignedto: projectId ? `Project: ${projectId}` : null
                };
                await promoteToAsset(targetChildId, promoData, trx, user);
            }
        } else {
            // Standard asset update
            await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [targetChildId.toLowerCase()]).update({
                parentid: finalParentId,
                currentlocation: location,
                status: projectId ? 'Project' : status,
                assignedto: projectId ? `Project: ${projectId}` : null,
                lastupdated: new Date().toISOString()
            });
        }

        if (projectId) {
            await trx('project_assets').insert({ projectid: projectId, assetid: targetChildId, assigneddate: new Date().toISOString(), type: 'Permanent' }).onConflict(['projectid', 'assetid']).merge();
        }
        
        await logAssetHistory(targetChildId, 'JOIN_SET', null, finalParentId, user, `Linked to set ${finalParentId}. Project: ${projectId || 'None'}`, trx);
      }
    });

    await invalidateAssetsCache();
    res.json({ success: true, message: 'Logic Engine: Set balanced.', parentId: finalParentId });
  } catch (err) {
    console.error('[LOGIC-ENGINE] Make set error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});


/**
 * Break an item out of a Set.
 * If the item is a No-QR component, it is PROMOTED to a full Asset.
 */
app.post('/api/assets/break-set', authenticateJWT, async (req, res) => {
  try {
    const { childAssetId, newPrice, componentData } = req.body;
    const user = req.user?.username || req.headers['x-user'] || 'web';

    console.log(`[SET] Break set request. child: ${childAssetId}, newPrice: ${newPrice}`);

    let resultId = childAssetId;

    await db.transaction(async (trx) => {
      let category = 'IT'; 
      let parentData = null;

      // 1. CATEGORY & DATA INHERITANCE
      const parentId = (componentData && componentData.parentid) || null;
      if (parentId) {
        const parent = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId.toLowerCase()]).first();
        if (parent) {
          parentData = parent;
          if (parent.category) category = parent.category;
        }
      }

      // 2. PROMOTION LOGIC: If we are breaking out a "No-QR" component
      if (componentData && (!childAssetId || childAssetId.startsWith('COMP-') || (componentData.noqr === 1) || (componentData.NoQR === 1))) {
        const loc = componentData.currentlocation || (parentData ? parentData.currentlocation : 'Mumbai');
        const type = componentData.type || 'Accessory';
        
        let newId = childAssetId;
        if (!childAssetId || childAssetId.startsWith('COMP-')) {
            newId = generateModernAssetId(loc, type);
        }
        
        resultId = newId;

        const promoData = {
          itemname: componentData.itemname || componentData.ItemName,
          make: componentData.make || componentData.Make || '',
          model: componentData.model || componentData.Model || '',
          srno: componentData.srno || componentData.SrNo || '',
          status: 'Under Inspection', 
          category: category, 
          type: type,
          asset_value: newPrice || 0,
          is_set: 0,
          parentid: parentId, 
          currentlocation: loc
        };

        await promoteToAsset(newId, promoData, trx, user);
      } else {
        // 3. STANDARD DETACH
        console.log(`[SET] Detaching asset ${childAssetId} from parent`);
        const updateData = { 
          parentid: null,
          lastupdated: new Date().toISOString()
        };
        if (newPrice !== undefined && newPrice !== null) {
          updateData.asset_value = newPrice;
        }
        await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [childAssetId.toLowerCase()]).update(updateData);
        await logAssetHistory(childAssetId, 'BREAK_SET', 'SET_MEMBER', 'STANDALONE', user, `Broken out from set. New Price: ${newPrice || 'Original'}`, trx);
      }
    });

    console.log(`[SET] Break set successful. resultId: ${resultId}`);
    await invalidateAssetsCache();
    res.json({ 
      success: true, 
      message: 'Item broken out and promoted successfully.',
      newAssetId: resultId
    });
  } catch (err) {
    console.error('[SET] Break set error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});






app.post('/api/quantity/issue', async (req, res) => {
  try {
    const actor = getRequestActor(req)
    const assetId = String(req.body?.assetId || req.body?.AssetId || '').trim()
    const amount = parseQtyNumber(req.body?.amount ?? req.body?.Amount)
    const note = req.body?.note || null
    const target = req.body?.target || null

    if (!assetId) return res.status(400).json({ success: false, error: 'assetId is required' })
    if (amount === null || amount <= 0) return res.status(400).json({ success: false, error: 'amount must be > 0' })

    const parent = await getQuantityAsset(assetId)
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
    const existing = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [newId]).first();
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 9090
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const childId = await db.transaction(async (trx) => {
      const now = new Date().toISOString();
      
      const record = normalizeDBData({
        ID: newId,
        ItemName: `${parent.ItemName || 'Item'} (Issued)`,
        Status: 'Issued',
        Make: parent.Make || '',
        Model: parent.Model || '',
        SrNo: '', // SrNo
        Type: parent.Type || '',
        Category: parent.Category || '',
        Icon: parent.Icon || '',
        isPlaceholder: 0,
        ParentId: assetId,
        CurrentLocation: parent.CurrentLocation || '',
        DispatchReceiveDt: now, // DispatchReceiveDt
        PurchaseDetails: parent.PurchaseDetails || '',
        Remarks: note || '',
        LastUpdated: now,
        QRCode: qrCode,
        AssignedTo: assignedTo,
        NoQR: 0, // NoQR
        warranty_months: parent.warranty_months || 0,
        amc_months: parent.amc_months || 0,
        asset_value: 0, // asset_value
        Currency: parent.Currency || 'INR',
        PurchaseDate: parent.PurchaseDate || null,
        quantity_parent_id: assetId,
        quantity_root_id: rootId,
        quantity_unit: unit,
        quantity_total: amount, // child total
        quantity_available: amount, // child available
        quantity_precision: precision,
        quantity_updated_at: now
      });

      await trx('assets').insert(record);

      if (projectId) {
        await trx('project_assets').insert({
          projectid: projectId,
          assetid: newId,
          assigneddate: now,
          type: 'Permanent'
        });
      }

      await applyQuantityEvent({
        rootId,
        type: 'ISSUE',
        actor,
        note,
        metadata: { target: displayTarget, targetId, targetType, parentId: assetId, childId: newId },
        lines: [
          { assetId: assetId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: amount, deltaTotal: amount, precision }
        ]
      }, trx);

      appendAudit({
        Action: 'QTY_ISSUE',
        User: actor,
        AssetId: assetId,
        Severity: 'INFO',
        Details: `Issued ${amount} ${unit} to ${newId}${displayTarget ? ` (${displayTarget})` : ''}`
      });

      return newId;
    });

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

    const parent = await getQuantityAsset(assetId)
    if (!parent || !parent.quantity_root_id) return res.status(400).json({ success: false, error: 'Asset is not a quantity asset' })

    const rootId = parent.quantity_root_id
    const unit = normalizeQtyUnit(parent.quantity_unit)
    if (!unit) return res.status(400).json({ success: false, error: 'Asset is missing quantity unit' })
    const precision = parent.quantity_precision ?? null

    const newId = generateSplitAssetId(assetId)
    const existing = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [newId]).first();
    if (existing) return res.status(500).json({ success: false, error: 'Failed to generate unique child ID' })

    const ip = getLocalIP()
    const port = process.env.PORT || 9090
    const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`
    const qrCode = await qrcode.toDataURL(urlText, { width: 512 })

    const childId = await db.transaction(async (trx) => {
      const now = new Date().toISOString();
      
      const record = normalizeDBData({
        ID: newId,
        ItemName: `${parent.ItemName || 'Item'} (Consumed)`,
        Status: 'Consumed',
        Make: parent.Make || '',
        Model: parent.Model || '',
        SrNo: '', // SrNo
        Type: parent.Type || '',
        Category: parent.Category || '',
        Icon: parent.Icon || '',
        isPlaceholder: 0,
        ParentId: assetId,
        CurrentLocation: parent.CurrentLocation || '',
        DispatchReceiveDt: now, // DispatchReceiveDt
        PurchaseDetails: parent.PurchaseDetails || '',
        Remarks: note || '',
        LastUpdated: now,
        QRCode: qrCode,
        AssignedTo: null, // AssignedTo
        NoQR: 0, // NoQR
        warranty_months: parent.warranty_months || 0,
        amc_months: parent.amc_months || 0,
        asset_value: 0, // asset_value
        Currency: parent.Currency || 'INR',
        PurchaseDate: parent.PurchaseDate || null,
        quantity_parent_id: assetId,
        quantity_root_id: rootId,
        quantity_unit: unit,
        quantity_total: amount, // child total
        quantity_available: 0, // child available (consumed is gone)
        quantity_precision: precision,
        quantity_updated_at: now
      });

      await trx('assets').insert(record);

      if (parent.ProjectID) {
        await trx('project_assets').insert({
          projectid: parent.ProjectID,
          assetid: newId,
          assigneddate: now,
          type: 'Permanent'
        });
      }

      await applyQuantityEvent({
        rootId,
        type: 'CONSUME',
        actor,
        note,
        metadata: { parentId: assetId, childId: newId },
        lines: [
          { assetId: assetId, unit, deltaAvailable: -amount, deltaTotal: -amount, precision },
          { assetId: newId, unit, deltaAvailable: 0, deltaTotal: amount, precision } // Child gets the total, but 0 available
        ]
      }, trx);

      appendAudit({
        Action: 'QTY_CONSUME',
        User: actor,
        AssetId: assetId,
        Severity: 'INFO',
        Details: `Consumed ${amount} ${unit} to ${newId}`
      });

      return newId;
    });

    res.json({ success: true, childId })
  } catch (err) {
    console.error('Quantity consume failed:', err)
    res.status(500).json({ success: false, error: err.message })
  }
})

app.post('/api/quantity/adjust', async (req, res) => {
  try {
    const admin = await requireAdmin(req)
    if (!admin) return res.status(403).json({ success: false, error: 'Forbidden' })

    const actor = getRequestActor(req)
    const assetId = String(req.body?.assetId || req.body?.AssetId || '').trim()
    const deltaAvailable = parseQtyNumber(req.body?.deltaAvailable ?? req.body?.delta_available)
    const deltaTotal = parseQtyNumber(req.body?.deltaTotal ?? req.body?.delta_total) ?? 0
    const note = req.body?.note || null

    if (!assetId) return res.status(400).json({ success: false, error: 'assetId is required' })
    if (deltaAvailable === null || deltaAvailable === 0) return res.status(400).json({ success: false, error: 'deltaAvailable must be non-zero' })

    const asset = await getQuantityAsset(assetId)
    if (!asset || !asset.quantity_root_id) return res.status(400).json({ success: false, error: 'Asset is not a quantity asset' })

    const unit = normalizeQtyUnit(asset.quantity_unit)
    if (!unit) return res.status(400).json({ success: false, error: 'Asset is missing quantity unit' })

    await applyQuantityEvent({
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

    let events = await db('quantity_events')
      .whereRaw('LOWER(root_id) = LOWER(?)', [rootId])
      .orderBy('id', 'asc')
      .limit(2000);
      
    let lines = await db('quantity_event_lines')
      .whereIn('event_id', db('quantity_events').select('id').whereRaw('LOWER(root_id) = LOWER(?)', [rootId]))
      .orderBy('event_id', 'asc');
      
    events = normalizeResult(events);
    lines = normalizeResult(lines);

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

    const rows = await db('quantity_event_lines')
      .select('asset_id', 'unit')
      .sum('delta_available as delta_available_sum')
      .sum('delta_total as delta_total_sum')
      .whereIn('event_id', db('quantity_events').select('id').whereRaw('LOWER(root_id) = LOWER(?)', [rootId]))
      .groupBy('asset_id', 'unit');

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

    // Fetch current kinds and folders for dynamic mapping
    const [allKinds, allFolders] = await Promise.all([
        db('asset_kinds').select('name', 'module', 'icon', 'parentname'),
        db('folders').select('id', 'name', 'module', 'parentid')
    ]);

    const kindModuleMap = {};
    const kindIconMap = {};
    const folderModuleMap = {};

    allKinds.forEach(k => {
        kindModuleMap[k.name.toLowerCase()] = k.module;
        kindIconMap[k.name.toLowerCase()] = k.icon;
    });
    allFolders.forEach(f => {
        folderModuleMap[f.name.toLowerCase()] = f.module;
    });

    // Pre-generate IDs and QR codes to keep the transaction fast and handle async qrcode
    const processedAssets = await Promise.all(assets.map(async (asset) => {
      // --- Dynamic Translation Layer ---
      let finalType = asset.Type || asset.Category || ''; // Use Category as fallback for Type
      let providedCategory = asset.Category || asset.Module || ''; 

      // 1. Smart Type Guessing if missing or generic
      if (finalType.toUpperCase() === 'AST' || !finalType) {
          const name = (asset.ItemName || '').toLowerCase();
          if (name.includes('monitor') || name.includes('lcd') || name.includes('display')) finalType = 'Monitor';
          else if (name.includes('laptop')) finalType = 'Laptop';
          else if (name.includes('desktop') || name.includes('workstation')) finalType = 'Desktop';
          else if (name.includes('server')) finalType = 'Server';
          else if (name.includes('router')) finalType = 'Router';
          else if (name.includes('switch')) finalType = 'Switch';
          else if (name.includes('cable')) finalType = 'Video Cables';
          else if (name.includes('camera')) finalType = 'Camera';
          else if (name.includes('lens')) finalType = 'Cinema Lens';
          else if (name.includes('access point') || name.includes('wireless ap')) finalType = 'Access Points';
          else if (name.includes('firewall') || name.includes('sophos') || name.includes('fortinet')) finalType = 'Firewall';
          else if (name.includes('keyboard')) finalType = 'Keyboard';
          else if (name.includes('mouse')) finalType = 'Mouse';
          else finalType = 'General Asset';
      }

      // 2. Dynamic Category/Module Resolution
      // If the providedCategory is a known Module (IT, In-House, etc.), use it.
      // Otherwise, look up which module the finalType belongs to.
      let finalModule = 'IT'; // Default
      const normalizedProvided = providedCategory.toUpperCase();
      if (['IT', 'IN-HOUSE', 'LOGISTICS', 'OPERATIONS'].includes(normalizedProvided)) {
          finalModule = normalizedProvided;
      } else {
          finalModule = kindModuleMap[finalType.toLowerCase()] || folderModuleMap[finalType.toLowerCase()] || 'IT';
      }

      // 3. Automated Sub-category creation (Kind/Brand) - STRICT HIERARCHY
      let kindToCreate = null;
      let recordType = finalType;

      // Find if the parent category (finalType) exists in DB (case-insensitive)
      const existingParent = allKinds.find(k => k.name.toLowerCase() === finalType.toLowerCase()) ||
                             allFolders.find(f => f.name.toLowerCase() === finalType.toLowerCase());

      if (!existingParent) {
          // STRICT POLICY: No category, no upload. 
          throw new Error(`[BULK] Category "${finalType}" not found in system. Row skipped to protect data integrity.`);
      }

      // --- HIERARCHY SANCTITY CHECK (SYSTEM ALWAYS WINS) ---
      // We treat the Excel Folder as a "Suggestion" but the Database as the "Law".
      const providedFolder = (asset.itemFolder || asset.Folder || '').trim();
      const actualParentName = (existingParent.parentname || existingParent.ParentName || '').trim();

      let definitiveFolder = actualParentName || baseParent || '';
      
      if (providedFolder && actualParentName && providedFolder.toLowerCase() !== actualParentName.toLowerCase()) {
          // Mismatch detected! 
          // Instead of blocking, we auto-correct to the system's parent to ensure data integrity.
          console.log(`[BULK] Auto-Correcting hierarchy: Category "${finalType}" belongs to "${actualParentName}", ignoring Excel suggestion "${providedFolder}".`);
      }
      // -----------------------------------------------------

      if (asset.Make && existingParent) {
          // Rule: Only create sub-category (Brand) if the parent exists.
          const parentName = existingParent.name || existingParent.id;
          kindToCreate = {
              name: asset.Make,
              parentname: parentName,
              module: finalModule,
              icon: existingParent.icon || '📦'
          };
          recordType = asset.Make;
      }

      // 4. Ensure Parent Hierarchy is consistent
      // The definitiveFolder was already calculated during the Sanctity Check above.

      let baseKindToEnsure = null;
      if (baseParent) {
          baseKindToEnsure = {
              name: finalType,
              parentname: baseParent,
              module: finalModule,
              icon: kindIconMap[finalType.toLowerCase()] || '📦'
          };
      }
      // ---------------------------

      let newId = asset.ID || asset.Id;
      if (!newId) {
        // Use the base Kind (finalType) for ID prefix generation (e.g. MON, SRV)
        newId = generateModernAssetId(asset.CurrentLocation || asset.Location || '', finalType);
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

      return { 
          ...asset, 
          ID: newId, 
          QRCode: qrCode || null, 
          finalType: recordType, 
          finalModule, 
          kindToCreate, 
          baseKindToEnsure,
          resolvedFolder: definitiveFolder
      };
    }));

    // --- NEW: Group Name Resolution Logic ---
    // Create a map of GroupName -> Resolved Asset ID (from this batch)
    const groupResolutionMap = {};
    processedAssets.forEach(a => {
        // If this asset defines a Group Name, it is potentially the parent of that group
        if (a.ParentGroup && !a.ParentId) {
            const gName = a.ParentGroup.toLowerCase();
            // The first asset in the batch with this group name becomes the parent
            if (!groupResolutionMap[gName]) {
                groupResolutionMap[gName] = a.ID;
            }
        }
    });

    // Resolve Parent IDs for children
    for (const a of processedAssets) {
        // If this asset points to a Group Name, and we haven't already set a hard ParentId
        if (a.ParentGroup && !a.ParentId) {
            const gName = a.ParentGroup.toLowerCase();
            const resolvedId = groupResolutionMap[gName];
            
            if (resolvedId && resolvedId !== a.ID) {
                // Link to the parent found in the same Excel file
                a.ParentId = resolvedId;
            } else if (!resolvedId) {
                // If not found in batch, check if the Group Name is actually a real Asset ID already in DB
                const existingParent = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [gName]).first();
                if (existingParent) {
                    a.ParentId = existingParent.id || existingParent.ID;
                }
            }
        }
    }
    // ----------------------------------------

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
    const batchIds = processedAssets.map(a => a.ID);
    const existingIds = await db('assets').whereIn('id', batchIds).select('id');
    
    if (existingIds.length > 0) {
        const found = existingIds.map(e => e.id || e.ID);
        return res.status(400).json({ 
          success: false, 
          error: `Some Asset IDs already exist in database: ${found.slice(0, 5).join(', ')}${found.length > 5 ? '...' : ''}` 
        });
    }

    // DB Operations
    await db.transaction(async (trx) => {
        for (const asset of processedAssets) {
            // Ensure Parent Folder (Hardware/Networking/etc.) exists if it's one of our standard roots
            if (asset.baseKindToEnsure && asset.baseKindToEnsure.parentname) {
                const parentName = asset.baseKindToEnsure.parentname;
                // Only auto-create if it's one of our standard top-level IT categories
                if (['Hardware', 'Networking', 'Media & Others'].includes(parentName)) {
                    const folderExists = await trx('folders').where('id', parentName).first();
                    if (!folderExists) {
                        const itRoot = await trx('folders').where('name', 'IT Assets').first();
                        const parentId = itRoot ? itRoot.id : 'IT_ROOT';
                        const iconMap = { 'Hardware': '💻', 'Networking': '🌐', 'Media & Others': '📁' };
                        await trx('folders').insert({
                            id: parentName,
                            name: parentName,
                            parentid: parentId,
                            module: asset.baseKindToEnsure.module || 'IT',
                            icon: iconMap[parentName] || '📁',
                            timestamp: new Date().toISOString()
                        });
                    }
                }
            }

            // Ensure Base Kind exists and is correctly parented
            if (asset.baseKindToEnsure) {
                const exists = await trx('asset_kinds').where('name', asset.baseKindToEnsure.name).first();
                if (!exists) {
                    await trx('asset_kinds').insert({
                        name: asset.baseKindToEnsure.name,
                        module: asset.baseKindToEnsure.module,
                        parentname: asset.baseKindToEnsure.parentname,
                        icon: asset.baseKindToEnsure.icon,
                        lastupdated: new Date().toISOString()
                    });
                } else if (exists.parentname === 'IT Assets' || !exists.parentname) {
                    // Fix old generic parenting to follow the Hardware/Networking/Media structure
                    await trx('asset_kinds').where('name', asset.baseKindToEnsure.name).update({
                        parentname: asset.baseKindToEnsure.parentname,
                        lastupdated: new Date().toISOString()
                    });
                }
            }

            // Ensure Dynamic Kind (Brand) exists
            if (asset.kindToCreate) {
                console.log(`[BULK] Ensuring Dynamic Kind: ${asset.kindToCreate.name} under parent ${asset.kindToCreate.parentname}`);
                // Fix: Check for existence by BOTH name AND parentname to avoid cross-category bundling
                const exists = await trx('asset_kinds')
                    .where('name', asset.kindToCreate.name)
                    .andWhere('parentname', asset.kindToCreate.parentname)
                    .first();
                    
                if (!exists) {
                    console.log(`[BULK] Creating NEW category: ${asset.kindToCreate.name} under ${asset.kindToCreate.parentname}`);
                    await trx('asset_kinds').insert({
                        name: asset.kindToCreate.name,
                        module: asset.kindToCreate.module,
                        parentname: asset.kindToCreate.parentname,
                        icon: asset.kindToCreate.icon,
                        lastupdated: new Date().toISOString()
                    });
                } else {
                    console.log(`[BULK] Category ${asset.kindToCreate.name} already exists under ${asset.kindToCreate.parentname}.`);
                    await trx('asset_kinds')
                        .where('name', asset.kindToCreate.name)
                        .andWhere('parentname', asset.kindToCreate.parentname)
                        .update({
                            lastupdated: new Date().toISOString(),
                            is_deleted: 0 
                        });
                }
            }

            // Invalidate Cache after changes
            await invalidateAssetKindsCache();

            // 2. Resolve Category (Brand or Base Kind)
            // If brandCategory is provided and not empty, it becomes the asset's "Type"
            const finalAssetType = asset.itemBrandCategory || asset.itemKind;

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
                type: finalAssetType,
                category: asset.finalModule,
                icon: asset.Icon || '📦',
                isplaceholder: parseBool(asset.IsPlaceholder),
                parentid: asset.ParentId || null,
                currentlocation: asset.CurrentLocation || asset.Location || '',
                previouslocation: asset.PreviousLocation || '',
                purchasedetails: asset.PurchaseDetails || '',
                remarks: asset.Remarks || '',
                purpose: asset.Purpose || '',
                purchasedate: normalizeDate(asset.PurchaseDate),
                lastupdated: timestamp,
                qrcode: asset.QRCode,
                assignedto: asset.AssignedTo || '',
                currency: asset.Currency || 'INR',
                asset_value: parseFloat(asset.asset_value) || 0,
                weight: asset.Weight || '',
                hsn_code: asset.itemHsnCode || '',
                warranty_months: parseMonths(asset.warranty_months),
                amc_months: parseMonths(asset.amc_months),
                department: asset.Department || '',
                parent_folder: asset.resolvedFolder || ''
            };

            // Insert Main
            await trx('assets').insert(record);

            // Insert IT Details if applicable
            if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
                await trx('asset_it_details').insert({
                    assetid: asset.ID,
                    macaddress: encryptionService.encrypt(asset.MACAddress || ''),
                    ipaddress: encryptionService.encryptDeterministic(asset.IPAddress || ''),
                    networktype: asset.NetworkType || '',
                    physicalport: asset.PhysicalPort || '',
                    vlan: asset.VLAN || '',
                    socketid: encryptionService.encrypt(asset.SocketID || ''),
                    userid: asset.UserID || ''
                }).onConflict('assetid').merge();
            }
            results.push(asset.ID);
        }
    });

    appendAudit({ 
      Action: 'BULK_CREATE', 
      User: username, 
      AssetId: 'MULTIPLE', 
      Severity: 'INFO', 
      Details: `Bulk created ${assets.length} assets` 
    });

    await invalidateAssetsCache();
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
app.get('/api/external/projects', checkApiKey, async (req, res) => {
    try {
        const projects = await db('projects')
            .select('id as ID', 'projectname as Name', 'clientname as ClientName', 'location as Location', 'currency as Currency', 'description as Description', 'status as Status', 'startdate as StartDate', 'enddate as EndDate', 'owneremail as OwnerEmail', 'coordinatoremail as CoordinatorEmail', 'timestamp as Timestamp')
            .where(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            })
            .orderBy('timestamp', 'desc');
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
            URL: projectUrl
        }, ip, port);
        
        const qrCode = await qrcode.toDataURL(JSON.stringify(qrPayload), { width: 512 });

        await db('projects').insert(normalizeDBData({
            ID: id, 
            ProjectName: name, 
            ClientName: client, 
            Location: location || 'MUMBAI', 
            Currency: currency || 'INR', 
            Description: description || '', 
            Status: status || 'Planning', 
            StartDate: startDate || '', 
            EndDate: endDate || '', 
            CreatedBy: 'External API', 
            OwnerEmail: ownerEmail || '',
            CoordinatorEmail: coordinatorEmail || '',
            Timestamp: new Date().toISOString(),
            QRCode: qrCode
        }));

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
app.get('/api/external/assets', checkApiKey, async (req, res) => {
    try {
        const assets = await db('assets')
            .select('id as ID', 'itemname as ItemName', 'status as Status', 'make as Make', 'model as Model', 'type as Type', 'category as Category', 'currentlocation as CurrentLocation', 'assignedto as AssignedTo', 'lastupdated as LastUpdated')
            .where(function() {
                this.where('is_deleted', 0).orWhereNull('is_deleted');
            })
            .orderBy('lastupdated', 'desc');
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
            activeProjects: (await db('projects').whereRaw('LOWER(status) = LOWER(?)', ['active']).andWhere(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count,
            assetsInUse: (await db('assets').whereRaw('LOWER(status) = LOWER(?)', ['in use']).andWhere(function() { this.where('is_deleted', 0).orWhereNull('is_deleted'); }).count('* as count'))[0].count
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
            query.where('id', projectId);
        }
        
        query.where(function() {
            this.where('is_deleted', 0).orWhereNull('is_deleted');
        });

        const projects = await query.orderBy('timestamp', 'desc');
        res.json(projects);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        
        const project = await db('projects')
            .select('id as ID', 'projectname as Name', 'clientname as ClientName', 'location as Location', 'currency as Currency', 'description as Description', 'status as Status', 'startdate as StartDate', 'endDate as EndDate', 
                   'owneremail as OwnerEmail', 'coordinatoremail as CoordinatorEmail', 'timestamp as Timestamp', 'qrcode as QRCode',
                   'consigneename as ConsigneeName', 'consigneeaddress as ConsigneeAddress', 'consigneegstin as ConsigneeGSTIN', 'consigneestate as ConsigneeState', 'consigneestatecode as ConsigneeStateCode',
                   'buyername as BuyerName', 'buyeraddress as BuyerAddress', 'buyergstin as BuyerGSTIN', 'buyerstate as BuyerState', 'buyerstatecode as BuyerStateCode')
            .where('id', id)
            .first();
            
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
        const rows = await db('project_history').where('projectid', id).orderBy('timestamp', 'asc');
        res.json(normalizeResult(rows));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/orders', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[PO] Fetching orders for project: ${id}`);
        
        const rows = await db('project_orders').where('projectid', id).orderBy('timestamp', 'desc');
        const normalizedOrders = normalizeResult(rows);
        
        // Fetch items for each order and calculate fulfillment
        const ordersWithItems = await Promise.all(normalizedOrders.map(async (order) => {
            const orderId = order.ID || order.id;
            
            const items = await db('project_order_items').where('orderid', orderId).orderBy('srno', 'asc');
            const normalizedItems = normalizeResult(items);
            
            // For each item, find how many assets are linked to it (Permanent + Temporary)
            const itemsWithFulfillment = await Promise.all(normalizedItems.map(async (item) => {
                const itemId = item.ID || item.id;
                
                const permResult = await db('assets').where('linked_po_item_id', itemId).count('* as count').first();
                const permanentFulfilled = permResult ? permResult.count : 0;
                
                const tempResult = await db('temporary_assets').where('linked_po_item_id', itemId).count('* as count').first();
                const temporaryFulfilled = tempResult ? tempResult.count : 0;
                
                const total = (Number(permanentFulfilled) + Number(temporaryFulfilled));
                console.log(`[PO FULFILLMENT] Item ${itemId} (${item.ItemDescription}): Perm=${permanentFulfilled}, Temp=${temporaryFulfilled}, Total=${total}`);
                
                return { 
                    ...item, 
                    fulfilledQty: total
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

    console.log(`[PO SEARCH] Query: "${search}"`);
    
    let query = db('project_orders as po')
      .leftJoin('projects as p', 'po.projectid', 'p.id')
      .where(function() {
        this.where('po.is_deleted', 0).orWhereNull('po.is_deleted');
      });
    
    // 1. Apply RBAC Segregation
    if (!isAdmin) {
        if (userProjectId) {
            query.where('po.projectid', userProjectId);
        } else if (userDept) {
            query.where(function() {
                this.where('p.location', userDept).orWhereNull('p.location').orWhere('p.location', '');
            });
        }
    }

    // 2. Apply Search
    if (search && search.trim().length > 0) {
      const term = `%${search.trim()}%`;
      query.where(function() {
          this.where('po.ponumber', 'ilike', term)
            .orWhere('po.vendorname', 'ilike', term)
            .orWhere('po.id', 'ilike', term)
            .orWhere('po.orderno', 'ilike', term)
            .orWhere('po.consigneename', 'ilike', term)
            .orWhere('po.buyername', 'ilike', term);
      });
    }
    
    const rows = await query.select('po.*').orderBy('po.timestamp', 'desc').limit(100);
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

// --- NEW: Dynamic CSV Template Generation ---
app.get('/api/templates/set-import', authenticateJWT, async (req, res) => {
    try {
        const type = req.query.type || 'general';
        let headers = [];
        let filename = '';

        if (type === 'employee') {
            headers = ['EmployeeID', 'Name', 'Department', 'Designation', 'Email', 'Phone', 'Status'];
            filename = 'Employee_Import_Template.csv';
        } else {
            headers = [
                'ItemName', 'ItemDescription', 'Make', 'Model', 'SrNo', 
                'Status', 'Category', 'Parent Folder', 'asset_value', 'Currency', 
                'CurrentLocation', 'Weight', 'HSN Code', 'PurchaseDate', 'PurchaseDetails', 'Remarks',
                'ParentId', 'Temporary Group Name'
            ];

            if (type === 'it') {
                // Append IT-specific fields
                headers = headers.concat(['MACAddress', 'IPAddress', 'Type', 'PhysicalPort', 'VLAN', 'SocketID', 'UserID']);
            }
            filename = `Asset_Import_Template_${type.toUpperCase()}.csv`;
        }

        // Generate CSV content
        const csvContent = headers.map(h => `"${h}"`).join(',') + '\n';
        
        console.log(`[TEMPLATE] Generated ${type} template with headers: ${headers.join(', ')}`);
        
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
        res.status(200).send(csvContent);
    } catch (err) {
        console.error('[TEMPLATE] Generation Error:', err);
        res.status(500).send('Error generating template');
    }
});

app.get('/api/orders/:orderId', authenticateJWT, async (req, res) => {
    try {
        const { orderId } = req.params;
        const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
        const userDept = req.user.department;
        const userProjectId = req.user.projectId;
        const hasViewPrice = hasPermission(req.user.role, 'asset.view_price');

        console.log(`[PO GET] Fetching order: ${orderId}`);
        
        const orderQuery = db('project_orders as po')
          .leftJoin('projects as p', 'po.projectid', 'p.id')
          .select('po.*', 'p.location as projectlocation')
          .where(function() {
            this.where('po.id', orderId).orWhere('po.ponumber', orderId);
          });

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

        const items = await db('project_order_items').where('orderid', order.ID).orderBy('srno', 'asc');
        const normalizedItems = normalizeResult(items);

        // Calculate fulfillment and Apply Price Redaction
        const processedItems = await Promise.all(normalizedItems.map(async (item) => {
            const itemId = item.ID || item.id;
            
            const permResult = await db('assets').where('linked_po_item_id', itemId).count('* as count').first();
            const permanentFulfilledCount = permResult ? permResult.count : 0;
            
            const tempResult = await db('temporary_assets').where('linked_po_item_id', itemId).count('* as count').first();
            const temporaryFulfilledCount = tempResult ? tempResult.count : 0;
            
            const processed = { ...item, fulfilledQty: (Number(permanentFulfilledCount) + Number(temporaryFulfilledCount)) };
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

        await db.transaction(async (trx) => {
            console.log(`[PO] Inserting header: ${orderId}`);
            const header = normalizeDBData({
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
            });

            await trx('project_orders').insert(header);

            if (items && Array.isArray(items)) {
                console.log(`[PO] Inserting ${items.length} items`);
                for (const [index, item] of items.entries()) {
                    const line = {
                        orderid: orderId, 
                        srno: item.SrNo || (index + 1), 
                        itemdescription: item.ItemDescription || '', 
                        duedate: item.DueDate || null, 
                        qtyordered: parseFloat(item.QtyOrdered || item.qtyordered) || 0, 
                        uom: item.UOM || item.uom || 'Nos', 
                        unitprice: parseFloat(item.UnitPrice || item.unitprice) || 0, 
                        total: parseFloat(item.Total || item.total) || 0, 
                        assetid: item.AssetID || item.assetid || null, 
                        status: item.Status || item.status || 'Pending',
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

        const runTransaction = async (trx) => {
            // 1. Update Header
            const orderUpdate = normalizeDBData({
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
                Buyergstin: BuyerGSTIN || null, 
                BuyerState: BuyerState || null, 
                BuyerStateCode: BuyerStateCode || null
            });

            await trx('project_orders')
                .where('id', orderId)
                .update(orderUpdate);

            if (items && Array.isArray(items)) {
                // 2. Fetch existing item IDs
                const existingItems = await trx('project_order_items')
                    .where('orderid', orderId)
                    .select('id');
                const existingIds = existingItems.map(i => i.id || i.ID);
                const incomingIds = items.map(i => i.id || i.ID).filter(id => id);

                // 3. Delete items that are no longer in the list
                const toDelete = existingIds.filter(id => !incomingIds.includes(id));
                if (toDelete.length > 0) {
                    await trx('project_order_items').whereIn('id', toDelete).delete();
                    await trx('assets').whereIn('linked_po_item_id', toDelete).update({ linked_po_item_id: null });
                    await trx('temporary_assets').whereIn('linked_po_item_id', toDelete).update({ linked_po_item_id: null });
                }

                // 4. Update or Insert items
                for (const [index, item] of items.entries()) {
                    let receivedStatus = item.Status || item.status || 'Pending';
                    if (receivedStatus.toLowerCase().includes('ship')) receivedStatus = 'Shipped';
                    else receivedStatus = 'Pending';

                    const itemId = item.ID || item.id;
                    const itemData = {
                        srno: item.SrNo || (index + 1), 
                        itemdescription: item.ItemDescription || '', 
                        duedate: item.DueDate || null, 
                        qtyordered: parseFloat(item.QtyOrdered || item.qtyordered) || 0, 
                        uom: item.UOM || item.uom || 'Nos', 
                        unitprice: parseFloat(item.UnitPrice || item.unitprice) || 0, 
                        total: parseFloat(item.Total || item.total) || 0, 
                        assetid: item.AssetID || item.assetid || null, 
                        status: receivedStatus
                    };

                    if (itemId && existingIds.includes(itemId)) {
                        // Update existing
                        await trx('project_order_items')
                            .where('id', itemId)
                            .update(itemData);
                    } else {
                        // Insert new
                        const insertData = {
                            orderid: orderId,
                            ...itemData,
                            timestamp: ts
                        };
                        await trx('project_order_items').insert(insertData);
                    }
                }
            }
        };

        await db.transaction(runTransaction);
        res.json({ success: true });
    } catch (err) {
        console.error(`[DEBUG PO] Update failed:`, err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:projectId/orders/:orderId', authenticateJWT, async (req, res) => {
    try {
        const { projectId, orderId } = req.params;
        
        await db.transaction(async (trx) => {
            await trx('project_order_items').where('orderid', orderId).delete();
            await trx('project_orders').where('id', orderId).andWhere('projectid', projectId).delete();
        });

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
        
        const updateObj = normalizeDBData(updates);
        // Filter out non-allowed fields
        Object.keys(updateObj).forEach(key => {
            if (!allowedFields.map(f => f.toLowerCase()).includes(key)) {
                delete updateObj[key];
            }
        });
        
        if (Object.keys(updateObj).length === 0) {
            return res.status(400).json({ error: 'No valid fields to update' });
        }

        const existing = await db('projects').where('id', id).select('status').first();
        if (!existing) {
            return res.status(404).json({ error: 'Project not found' });
        }

        await db('projects').where('id', id).update(updateObj);

        // Record status change in history if applicable
        const currentStatus = updateObj.status;
        const oldStatus = existing.status;

        if (currentStatus && currentStatus !== oldStatus) {
            const hasHistoryTable = await db.schema.hasTable('project_history');
            if (hasHistoryTable) {
                await db('project_history').insert({
                    projectid: id, 
                    status: currentStatus, 
                    note: `Status changed from ${oldStatus || 'Unknown'} to ${currentStatus}`, 
                    timestamp: new Date().toISOString()
                });
            }
        }

        // Regenerate QR code if name, client, location, status, or contact info changed
        const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
        if (Object.keys(updates).some(f => relevantFields.includes(f))) {
            try {
                const project = await db('projects').where('id', id).first();
                if (project) {
                    const ip = getLocalIP();
                    const port = process.env.PORT || 9090;
                    const qrPayload = generateProjectQRPayload(normalizeResult(project), ip, port);
                    const qrCode = await qrcode.toDataURL(JSON.stringify(qrPayload), { width: 512 });
                    await db('projects').where('id', id).update({ qrcode: qrCode });
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
        const tableExists = await db.schema.hasTable('company_templates');
        if (!tableExists) return res.json([]);
        
        const companies = await db('company_templates')
            .select('company_name as name', 'address', 'gst as gstin', 'state_name as state', 'state_code as stateCode')
            .orderBy('company_name', 'asc');
            
        res.json(companies);
    } catch (err) {
        console.error('Error fetching companies:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/assets', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`Fetching assets for project: ${id}`);
        
        const permanent = await db('assets as a')
            .join('project_assets as pa', 'a.id', 'pa.assetid')
            .where('pa.projectid', id)
            .select(
              'a.id', 'a.itemname', 'a.status', 'a.make', 'a.model', 'a.type', 'a.category', 'a.icon', 'a.currency', 'a.is_set', 'a.parentid',
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

        let assets = [...permanent, ...temporary];
        assets = normalizeResult(assets);
        
        // --- HIERARCHY LOGIC: Hide nested children from main list ---
        const assetMap = {};
        assets.forEach(a => {
            const id = a.id || a.ID;
            assetMap[id.toLowerCase()] = { ...a, children: [] };
        });

        const roots = [];
        assets.forEach(a => {
            const id = (a.id || a.ID).toLowerCase();
            const parentId = (a.parentid || a.ParentId || '').toLowerCase();
            
            if (parentId && assetMap[parentId]) {
                assetMap[parentId].children.push(assetMap[id]);
            } else {
                roots.push(assetMap[id]);
            }
        });

        console.log(`Found ${assets.length} assets for project ${id}. Returning ${roots.length} top-level items.`);
        res.json(roots);
    } catch (err) {
        console.error('Error fetching project assets:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/assign-asset', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { AssetID, Type } = req.body;

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

        await db.transaction(async (trx) => {
            const project = await trx('projects').where('id', id).select('projectname', 'initials').first();
            const projectName = project ? (project.projectname || project.ProjectName) : id;
            const projectInitials = project ? (project.initials || project.Initials || 'NA') : 'NA';

            const processAssignment = async (assetId, isChild = false) => {
                const assetParts = assetId.split('-');
                const assetKind = assetParts[0] || 'AST';
                const sixDigitCode = assetParts[3] || '000000';
                const clientLabel = `${assetKind}-${projectInitials}-${sixDigitCode}`;

                // --- PROMOTION LOGIC: Check both tables ---
                let assetRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
                let asset = normalizeResult(assetRow);

                if (!asset) {
                    const compRow = await trx('components').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
                    if (compRow) {
                        const comp = normalizeResult(compRow);
                        const loc = 'On Site';
                        const type = comp.Type || comp.type || 'Accessory';
                        
                        let newId = assetId;
                        if (!assetId || assetId.startsWith('COMP-')) {
                            newId = generateModernAssetId(loc, type);
                        }

                        const promoData = {
                            itemname: comp.ItemName || comp.itemname,
                            make: comp.Make || comp.make || '',
                            model: comp.Model || comp.model || '',
                            srno: comp.SrNo || comp.srno || '',
                            status: 'Project',
                            category: comp.Category || comp.category || 'IT',
                            type: type,
                            is_set: 0,
                            parentid: comp.ParentId || comp.parentid,
                            currentlocation: loc,
                            assignedto: `Project: ${projectName}`
                        };
                        
                        await promoteToAsset(newId, promoData, trx, req.user?.username || 'web');
                        
                        // Continue with the newly created asset
                        asset = { id: newId, ID: newId, status: 'Project', is_set: 0 };
                        assetId = newId;
                    }
                }

                if (!asset) {
                    console.warn(`[ASSIGN] Asset ${assetId} not found for assignment.`);
                    return;
                }

                // --- FIXED: Double-Assignment Prevention ---
                if (asset.status === 'Project' || asset.Status === 'Project') {
                    console.warn(`[ASSIGN] Asset ${assetId} is already assigned to a project. Skipping.`);
                    // Still recurse into children though, just in case some weren't locked
                } else {
                    // Lock the asset
                    const currentQty = parseFloat(asset.quantity_available || asset.QuantityAvailable || 0);
                    const isBatch = !!(asset.IsBatch || asset.is_batch || (asset.quantity_total > 1 && asset.is_quantity_tracked));
                    
                    let newQty = 0;
                    if (isBatch && currentQty > 1) {
                        newQty = currentQty - 1;
                    }

                    console.log(`[ASSIGN] Locking asset ${assetId}. Qty: ${currentQty} -> ${newQty}. Status -> Project`);

                    // Use the Reliable Status Helper (now with recursive project linking)
                    await updateAssetStatus(
                        assetId, 
                        'Project', 
                        { 
                            assignedto: `Project: ${projectName}`, 
                            currentlocation: 'On Site',
                            client_label: clientLabel,
                            quantity_available: newQty
                        }, 
                        trx, 
                        req.user?.username || 'web', 
                        isChild ? `Assigned to project as part of set` : `Assigned to project manually`,
                        true, // Recursive for sets
                        id    // Pass projectId for linking
                    );
                }
            };

            await processAssignment(AssetID);
        });

        await invalidateAssetsCache();
        res.json({ success: true });
    } catch (err) {
        console.error('Assign asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/projects/:id/unassign-asset/:assetId', authenticateJWT, async (req, res) => {
    try {
        const { id, assetId } = req.params;

        let isSplitChild = false;
        await db.transaction(async (trx) => {
            // 1. Check if it's a permanent asset
            const projectAsset = await trx('project_assets')
                .where('projectid', id)
                .andWhere('assetid', assetId)
                .first();
            
            if (projectAsset) {
                // Remove from project_assets
                await trx('project_assets')
                    .where('projectid', id)
                    .andWhere('assetid', assetId)
                    .delete();
                
                const assetRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
                const asset = normalizeResult(assetRow);

                if (asset && (asset.ParentId || asset.parentid)) {
                    const pId = asset.ParentId || asset.parentid;
                    // 1.1 Check if it's a split child (Batch/Quantity) vs a Set Component
                    const parentRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [pId.toLowerCase()]).first();
                    const parent = normalizeResult(parentRow);

                    // ONLY delete and merge back if the parent is a BATCH or QUANTITY asset
                    // If the parent is a SET, the child is a standalone asset and must be preserved!
                    if (parent && (parent.IsBatch || parent.IsQuantityTracked || (parent.is_batch || parent.is_quantity_tracked))) {
                        console.log(`[UNASSIGN] Merging split child ${assetId} back into parent batch ${pId}`);
                        isSplitChild = true;
                        
                        const qtyToRestore = parseFloat(asset.QuantityTotal || asset.quantity_total) || 1;
                        await trx('assets')
                            .whereRaw('LOWER(id) = LOWER(?)', [pId.toLowerCase()])
                            .update({
                                quantity_available: (parent.QuantityAvailable || parent.quantity_available || 0) + qtyToRestore,
                                quantity_total: (parent.QuantityTotal || parent.quantity_total || 0) + qtyToRestore,
                                lastupdated: new Date().toISOString()
                            });
                        
                        await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).delete();
                        await logAssetHistory(pId, 'SPLIT_CHILD_RESTORED', null, null, 'System', `Merged ${qtyToRestore} units back from unassigned child ${assetId}`, trx);
                        return;
                    } else {
                        console.log(`[UNASSIGN] Asset ${assetId} is a component of SET ${pId}. Preserving identity.`);
                    }
                }

                const assetParts = assetId.split('-');
                const assetKind = assetParts[0] || 'AST';
                const locCode = assetParts[1] || 'LOC';
                const sixDigitCode = assetParts[3] || '000000';
                const revertedLabel = `${assetKind}-${locCode}-${sixDigitCode}`;

                const aRow = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [assetId.toLowerCase()]).first();
                const aObj = normalizeResult(aRow);

                if (aObj) {
                    // Use the Reliable Status Helper (now with recursive project unlinking)
                    await updateAssetStatus(
                        assetId,
                        'Under Inspection',
                        {
                            assignedto: null,
                            currentlocation: 'Warehouse',
                            purpose: 'Owned',
                            linked_po_item_id: null,
                            client_label: revertedLabel,
                            // Restore quantity_available for single assets
                            quantity_available: (aObj.IsBatch || aObj.is_batch || aObj.quantity_total > 1) ? aObj.quantity_available : (aObj.quantity_total || 1),
                            is_deleted: 0,
                            deleted_at: null
                        },
                        trx,
                        req.user?.username || 'web',
                        `Unassigned from project manually`,
                        true, // Recursive for sets
                        id    // Pass projectId for unlinking
                    );
                }

                // --- NEW LOGIC: Trigger Inward Inspection Modal ---
                // We'll pass a flag to the frontend to trigger the modal automatically
                trx.isInspectionTriggered = true;
            } else {
                // 2. Check if it's a temporary asset
                const tempAsset = await trx('temporary_assets')
                    .where('id', assetId)
                    .andWhere('projectid', id)
                    .first();
                
                if (tempAsset) {
                    // Check if it's converted to permanent
                    if (tempAsset.ispermanent || tempAsset.is_permanent) {
                        // Return to general inventory as 'Under Inspection'
                        await trx('assets')
                            .where('id', assetId)
                            .update({
                                assignedto: null,
                                status: 'Under Inspection',
                                currentlocation: 'Warehouse',
                                purpose: 'Owned',
                                linked_po_item_id: null,
                                is_deleted: 0,
                                deleted_at: null
                            });
                        
                        await logAssetHistory(assetId, 'UNASSIGNED', 'In Use', 'Under Inspection', req.user.user_id, `Converted permanent asset unassigned from project ${id}. Awaiting inward inspection.`, trx);
                    }
                    
                    // Soft-delete temporary asset record for this project
                    await trx('temporary_assets')
                        .where('id', assetId)
                        .andWhere('projectid', id)
                        .update({
                            is_deleted: 1,
                            deleted_at: new Date().toISOString()
                        });
                }
            }
        });
        await invalidateAssetsCache();
        res.json({ success: true, isSplitChild });
    } catch (err) {
        console.error('Unassign asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/projects/:id/create-user', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { username, password, fullname } = req.body;
        
        const project = await db('projects').where('id', id).first();
        if (!project) return res.status(404).send('Project not found');

        const companyId = project.company_id || project.CompanyID || DEFAULT_COMPANY_ID;
        
        await db('users').insert(normalizeDBData({
            username, 
            password, 
            fullname: fullname || project.clientname || project.ClientName, 
            role: 'client', 
            project_id: id, 
            client_id: project.id || project.ID,
            company_id: companyId
        }));

        res.json({ success: true });
    } catch (err) {
        console.error('Create project user error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const assets = await db('temporary_assets').where('projectid', id).andWhere('ispermanent', 0);
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
        
        // Fetch project location for ID generation
        const project = await db('projects').where('id', id).select('location').first();
        const location = project ? (project.location || project.Location) : 'MUMBAI';
        
        const assetId = generateTempAssetId(location);
        const record = normalizeDBData({
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
        });

        await db('temporary_assets').insert(record);
        res.json({ success: true, id: assetId });
    } catch (err) {
        console.error('Create temporary asset error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const assets = await db('temporary_assets').where('ispermanent', 0).orderBy('timestamp', 'desc');
        res.json(normalizeResult(assets));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets', authenticateJWT, async (req, res) => {
    try {
        const { ItemName, Type, Category, Make, Model, EstimatedPrice, Quantity, ProjectId, Currency } = req.body;
        
        let location = 'MUMBAI';
        if (ProjectId) {
            const project = await db('projects').where('id', ProjectId).select('location').first();
            location = project ? (project.location || project.Location) : 'MUMBAI';
        }
        
        const id = generateTempAssetId(location);
        const timestamp = new Date().toISOString();
        
        const record = normalizeDBData({
            id,
            itemname: ItemName,
            type: Type || '',
            category: Category || '',
            make: Make || '',
            model: Model || '',
            estimatedprice: EstimatedPrice || 0,
            quantity: Quantity || 1,
            projectid: ProjectId || null,
            timestamp: timestamp,
            currency: Currency || 'INR'
        });

        await db('temporary_assets').insert(record);
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/temporary-assets/:id/make-permanent', async (req, res) => {
    try {
        const { id } = req.params;
        
        let tempAsset = await db('temporary_assets').where('id', id).first();
        tempAsset = normalizeResult(tempAsset);

        if (!tempAsset) return res.status(404).send('Temporary asset not found');

        // Get project location for ID generation
        const project = await db('projects').where('id', tempAsset.ProjectID).select('location').first();
        const location = project ? (project.location || project.Location) : 'MUMBAI';

        // Create permanent asset using modern ID generation
        const newAssetId = generateModernAssetId(location);
        
        const ip = getLocalIP();
        const port = process.env.PORT || 9090;
        const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newAssetId)}`;
        const qrCode = await qrcode.toDataURL(urlText, { width: 512 });

        await db.transaction(async (trx) => {
            // 1. Insert into assets
            await trx('assets').insert({
                id: newAssetId, 
                no: newAssetId, 
                itemname: tempAsset.ItemName || 'Unnamed Asset', 
                status: 'In Store', 
                purpose: 'Owned',
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
            if (tempAsset.ProjectID) {
                await trx('project_assets').insert({
                    projectid: tempAsset.ProjectID, 
                    assetid: newAssetId, 
                    assigneddate: new Date().toISOString(), 
                    type: 'Permanent'
                });
            }

            // 3. Mark temporary as permanent
            await trx('temporary_assets')
                .where('id', id)
                .update({ ispermanent: 1 });

            // 4. Audit Log
            await appendAudit({ 
                Action: 'CONVERT_TEMP', 
                User: req.headers['x-user'] || 'web', 
                AssetId: newAssetId, 
                Severity: 'INFO', 
                Details: `Converted temporary asset "${tempAsset.ItemName}" to permanent asset. Linked to Project ID: ${tempAsset.ProjectID}` 
            }, trx);

            // 5. Asset History
            await logAssetHistory(newAssetId, 'CREATE', 'Temporary', 'Permanent', req.headers['x-user'] || 'web', `Created from temporary asset. Assigned to project ${tempAsset.ProjectID}`, trx);
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
        
        await db('temporary_assets').where('id', id).update({ is_deleted: 1, deleted_at: now });
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
    
    // Check if asset exists in assets table
    let existing = await db('assets as a')
      .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
      .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
      .leftJoin('projects as p', 'pa.projectid', 'p.id')
      .select('a.*', 
             'it.macaddress as MACAddress', 'it.ipaddress as IPAddress', 'it.networktype as NetworkType', 
             'it.physicalport as PhysicalPort', 'it.vlan as VLAN', 'it.socketid as SocketID', 'it.userid as UserID',
             'p.projectname as AssignedProjectName', 'p.id as AssignedProjectID')
      .whereRaw('LOWER(a.id) = LOWER(?)', [id])
      .first();

    // CRITICAL: Normalize existing.ID if it exists to match the requested id
    if (existing) {
        existing.ID = String(existing.id).trim();
    }

    let isComp = false;
    if (!existing) {
      // Check components table
      existing = await db('components').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
      if (existing) {
        isComp = true;
        existing.ID = String(existing.id).trim();
      }
    }

    if (!existing) {
      return res.status(404).send('Asset not found');
    }

    // RBAC: Department check for non-admins
    if (!isAdmin && userDept && existing.department && existing.department !== userDept) {
        return res.status(403).send('Forbidden: You can only edit assets in your department.');
    }

    // RBAC: Price check
    if (!hasEditPrice) {
        // Force fields back to existing values if they are present in body
        if (asset.asset_value !== undefined) asset.asset_value = existing.asset_value;
        if (asset.UnitPrice !== undefined) asset.UnitPrice = existing.UnitPrice;
        if (asset.Currency !== undefined) asset.Currency = existing.Currency;
    }

    // Mandatory Field Validation: Category and Type (Kind)
    if (asset.Category !== undefined && (!asset.Category || String(asset.Category).trim() === '')) {
        return res.status(400).send('Category is mandatory for all assets.');
    }
    if (asset.Type !== undefined && (!asset.Type || String(asset.Type).trim() === '')) {
        return res.status(400).send('Type (Kind) is mandatory for all assets.');
    }

    if (isComp) {
      // Update component in components table
      await db('components')
        .where('id', id)
        .update(normalizeDBData({
          ItemName: asset.ItemName || existing.itemname || '',
          Make: asset.Make || existing.make || '',
          Model: asset.Model || existing.model || '',
          SrNo: asset.SrNo || existing.srno || '',
          Status: asset.Status || existing.status || 'In Store',
          Type: asset.Type || existing.type || 'Component',
          Category: asset.Category || existing.category || '',
          LastUpdated: new Date().toISOString()
        }));

      appendAudit({ 
        Action: 'UPDATE_COMPONENT', 
        User: req.headers['x-user'] || 'web', 
        AssetId: id, 
        Severity: 'INFO', 
        Details: `Component updated: ${asset.ItemName || existing.itemname}` 
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
        ItemName: asset.ItemName || existing.itemname || '',
        Status: asset.Status || existing.status || 'In Store',
        Make: asset.Make || existing.make || '',
        Model: asset.Model || existing.model || '',
        SrNo: encryptionService.encryptDeterministic(asset.SrNo !== undefined ? asset.SrNo : (existing.srno || '')),
        Type: asset.Type || existing.type || '',
        Category: asset.Category || existing.category || '',
        parent_folder: asset.itemFolder || existing.parent_folder || '',
        Icon: asset.Icon || existing.icon || '',
        ParentId: asset.ParentId !== undefined ? asset.ParentId : (existing.parentid || null),
        CurrentLocation: asset.CurrentLocation || existing.currentlocation || '',
        DispatchReceiveDt: asset.DispatchReceiveDt || existing.dispatchreceivedt || '',
        PurchaseDetails: asset.PurchaseDetails || existing.purchasedetails || '',
        Remarks: asset.Remarks || existing.remarks || '',
        LastUpdated: new Date().toISOString(),
        AssignedTo: asset.AssignedTo !== undefined ? asset.AssignedTo : (existing.assignedto || ''),
        NoQR: asset.NoQR !== undefined ? (asset.NoQR ? 1 : 0) : (existing.noqr || 0),
        warranty_months: asset.warranty_months !== undefined ? asset.warranty_months : (existing.warranty_months || 0),
        amc_months: asset.amc_months !== undefined ? asset.amc_months : (existing.amc_months || 0),
        asset_value: asset.asset_value !== undefined ? asset.asset_value : (existing.asset_value || 0),
        Currency: asset.Currency !== undefined ? asset.Currency : (existing.currency || 'INR'),
        PurchaseDate: asset.PurchaseDate !== undefined ? normalizeDate(asset.PurchaseDate) : (existing.purchasedate || null),
        conversion_unit: asset.conversion_unit !== undefined ? asset.conversion_unit : (existing.conversion_unit || null),
        conversion_factor: asset.conversion_factor !== undefined ? asset.conversion_factor : (existing.conversion_factor || null),
        conversion_mode: asset.conversion_mode !== undefined ? asset.conversion_mode : (existing.conversion_mode || 'multiply'),
        quantity_unit: asset.quantity_unit !== undefined ? asset.quantity_unit : (existing.quantity_unit || null),
        quantity_total: asset.quantity_total !== undefined ? asset.quantity_total : (existing.quantity_total || 0),
        quantity_precision: asset.quantity_precision !== undefined ? asset.quantity_precision : (existing.quantity_precision || 0),
        is_quantity_tracked: asset.is_quantity_tracked !== undefined ? (asset.is_quantity_tracked ? 1 : 0) : (existing.is_quantity_tracked || 0),
        is_batch: asset.is_batch !== undefined ? (asset.is_batch ? 1 : 0) : (existing.is_batch || 0),
        is_set: asset.is_set !== undefined ? (asset.is_set ? 1 : 0) : (existing.is_set || 0),
        set_price_mode: asset.set_price_mode !== undefined ? asset.set_price_mode : (existing.set_price_mode || 'SUM_OF_CHILDREN'),
        weight: asset.Weight !== undefined ? asset.Weight : (existing.weight || ''),
        hsn_code: asset.itemHsnCode !== undefined ? asset.itemHsnCode : (existing.hsn_code || ''),
        is_retired: (asset.Status === 'Sold' || asset.Status === 'Scraped') ? 1 : (asset.is_retired !== undefined ? asset.is_retired : (existing.is_retired || 0))
    };

    // Only update quantity_available if it's a quantity tracked asset OR if there was an actual total change
    if ((asset.is_quantity_tracked || existing.is_quantity_tracked) || qtyAvailableDelta !== 0) {
        updateObj.quantity_available = db.raw('COALESCE(quantity_available, 0) + ?', [qtyAvailableDelta]);
    }

    // Sync is_retired based on Status
    const newStatus = (asset.Status || existing.status || '').toLowerCase();
    if (newStatus === 'sold' || newStatus === 'scraped' || newStatus === 'retired') {
        updateObj.is_retired = 1;
    } else if (newStatus === 'in store' || newStatus === 'project' || newStatus === 'under inspection') {
        updateObj.is_retired = 0;
    }

    await db('assets')
        .whereRaw('LOWER(id) = LOWER(?)', [id])
        .update(normalizeDBData(updateObj));

    appendAudit({
      Action: 'UPDATE',
      User: req.headers['x-user'] || 'web',
      AssetId: id,
      Severity: 'INFO',
      Details: `Asset updated: ${asset.ItemName || existing.itemname}`
    });

    // --- TRACK ALL CHANGES FOR HISTORY ---
    const currentUser = req.headers['x-user'] || 'web';
    const trackedFields = [
        { field: 'AssignedTo', dbField: 'assignedto', action: 'ASSIGNMENT_CHANGE', label: 'Personnel' },
        { field: 'Status', dbField: 'status', action: 'STATUS_CHANGE', label: 'Status' },
        { field: 'CurrentLocation', dbField: 'currentlocation', action: 'LOCATION_CHANGE', label: 'Location' },
        { field: 'AssignedProjectID', dbField: 'AssignedProjectID', action: 'PROJECT_CHANGE', label: 'Project' }
    ];

    trackedFields.forEach(({ field, dbField, action, label }) => {
        let newVal;
        if (field === 'AssignedProjectID') {
            newVal = asset.ProjectId || asset.ProjectID || asset.AssignedProjectID;
        } else {
            newVal = asset[field];
        }

        const oldVal = existing[dbField];
        
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
          .where('id', id)
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
          assetid: id,
          macaddress: encryptionService.encrypt(asset.MACAddress !== undefined ? asset.MACAddress : (existing.MACAddress || '')),
          ipaddress: encryptionService.encryptDeterministic(asset.IPAddress !== undefined ? asset.IPAddress : (existing.IPAddress || '')),
          networktype: asset.NetworkType !== undefined ? asset.NetworkType : (existing.NetworkType || ''),
          physicalport: asset.PhysicalPort !== undefined ? asset.PhysicalPort : (existing.PhysicalPort || ''),
          vlan: asset.VLAN !== undefined ? asset.VLAN : (existing.VLAN || ''),
          socketid: encryptionService.encrypt(asset.SocketID !== undefined ? asset.SocketID : (existing.SocketID || '')),
          userid: asset.UserID !== undefined ? asset.UserID : (existing.UserID || '')
      };

      await db('asset_it_details')
        .insert(itRecord)
        .onConflict('assetid')
        .merge();
    }

    // Handle nested components (child assets)
    if (Array.isArray(asset.components)) {
      // Get current NoQR components in components table
      const rows = await db('components').where('parentid', id).andWhere('noqr', 1).select('id');
      const currentComponents = rows.map(c => c.id);
      const updatedCompIds = [];

      for (const comp of asset.components) {
        const compId = comp.id || comp.ID;
        if (compId && currentComponents.includes(compId)) {
          // Update existing component
          await db('components')
            .where('id', compId)
            .andWhere('parentid', id)
            .update({
              itemname: comp.ItemName || '',
              make: comp.Make || '',
              model: comp.Model || '',
              srno: comp.SrNo || '',
              status: comp.Status || asset.Status || existing.status || 'In Store',
              type: comp.Type || 'Component',
              category: comp.Category || asset.Category || existing.category || '',
              lastupdated: new Date().toISOString(),
              noqr: 1
            });
          updatedCompIds.push(compId);
        } else {
          // Insert new component
          const newCompId = generateModernAssetId(asset.CurrentLocation || existing.currentlocation || '');
          await db('components').insert({
              id: newCompId,
              parentid: id,
              itemname: comp.ItemName || '',
              make: comp.Make || '',
              model: comp.Model || '',
              srno: comp.SrNo || '',
              status: comp.Status || asset.Status || existing.status || 'In Store',
              type: comp.Type || 'Component',
              category: comp.Category || asset.Category || existing.category || '',
              lastupdated: new Date().toISOString(),
              noqr: 1
          });
          updatedCompIds.push(newCompId);
        }
      }

      // Delete orphaned NoQR components
      const orphanedIds = currentComponents.filter(childId => !updatedCompIds.includes(childId));
      if (orphanedIds.length > 0) {
        await db('components').whereIn('id', orphanedIds).andWhere('parentid', id).delete();
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds)) {
      // 1. Identify currently linked assets (NoQR = 0)
      const rows = await db('components').where('parentid', id).andWhere('noqr', 0).select('id');
      const currentLinked = rows.map(c => c.id);
      
      // 2. Unlink those that are no longer in linkedIds
      const toUnlink = currentLinked.filter(linkId => !asset.linkedIds.includes(linkId));
      for (const unlinkId of toUnlink) {
        await db('components').where('id', unlinkId).andWhere('parentid', id).delete();
        await db('assets').where('id', unlinkId).update({ parentid: null });
        
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
        const existingAsset = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [linkId]).first();
        if (!existingAsset) continue;

        const existingParentInAssets = existingAsset.parentid;
        
        const existingComp = await db('components').whereRaw('LOWER(id) = LOWER(?)', [linkId]).first();
        const existingParentInComps = existingComp ? existingComp.parentid : null;

        // Only block if it's assigned to a DIFFERENT parent
        if ((existingParentInAssets && existingParentInAssets !== id) || 
            (existingParentInComps && existingParentInComps !== id)) {
          const actualParent = existingParentInAssets || existingParentInComps;
          return res.status(400).send(`Asset ${linkId} is already assigned to parent ${actualParent}. Remove it from its current parent first.`);
        }

        await db('components').insert({
          id: linkId,
          parentid: id,
          itemname: existingAsset.itemname,
          make: existingAsset.make || '',
          model: existingAsset.model || '',
          srno: existingAsset.srno || '',
          status: existingAsset.status || 'In Store',
          type: existingAsset.type || 'Component',
          category: existingAsset.category || '',
          lastupdated: new Date().toISOString(),
          noqr: 0
        }).onConflict('id').merge();
        
        await db('assets').where('id', linkId).update({ parentid: id });
      }
    }

    await invalidateAssetsCache();
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
    await db('project_orders')
      .where('id', orderId)
      .update({ status: Status });
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

    // 1. Fetch asset details for assignment and mandatory field checks
    const asset = await db('assets').where('id', id).first();
    if (!asset) return res.status(404).send('Asset not found');

    // 2. Assignment Guard: Check if assigned to project or employee
    // Check project assignment
    const projectLink = await db('project_assets').whereRaw('LOWER(assetid) = LOWER(?)', [id]).first();
    if (projectLink) {
        return res.status(400).send(`Cannot delete asset: It is currently assigned to project ${projectLink.projectid}. Unassign it first.`);
    }

    // Check employee assignment
    const isAssignedToEmployee = asset.assignedto && !asset.assignedto.startsWith('Project:') && asset.assignedto !== 'General Stock';
    if (isAssignedToEmployee) {
        return res.status(400).send(`Cannot delete asset: It is currently assigned to ${asset.assignedto}. Unassign it first.`);
    }

    // 3. Quantity Tracked Asset Logic
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
    // 3. Component Hierarchy Check (Non-quantity assets)
    const activeChildren = await db('assets')
      .whereRaw('LOWER(parentid) = LOWER(?)', [id.toLowerCase()])
      .andWhere(function() {
        this.where('is_deleted', 0).orWhereNull('is_deleted');
      })
      .first();
    
    if (activeChildren) {
        return res.status(400).send(`Cannot delete asset: It is a Parent Set with active members (e.g. ${activeChildren.id}). Unsplit or delete children first.`);
    }

    const qtyChildren = await db('assets').where('quantity_parent_id', id).first();
      if (qtyChildren) {
        return res.status(400).send('Cannot delete asset with quantity children');
      }
    }

    const isAdmin = req.user.role === 'admin' || req.user.role === 'superuser';
    if (!isAdmin) {
      await appendAudit({ Action: 'DELETE_DENIED', User: username, AssetId: id, Severity: 'WARN', Details: 'Unauthorized delete attempt' });
      return res.status(403).send('Forbidden');
    }

    // Delete from components table as well
    // For linked assets (NoQR = 0), we should also clear their ParentId in the assets table
    const linkedRows = await db('components').where('parentid', id).select('id');
    for (const comp of linkedRows) {
      await db('assets').where('id', comp.id).update({ parentid: null });
    }

    await db('components').where('id', id).delete();
    await db('components').where('parentid', id).delete();

    // Soft Delete: Mark as deleted instead of removing immediately
    const now = new Date().toISOString();
    const result = await db('assets')
      .where('id', id)
      .update({ is_deleted: 1, deleted_at: now });

    if (result > 0) {
      await appendAudit({ Action: 'DELETE', User: username, AssetId: id, Severity: 'INFO', Details: 'Asset marked for deletion (30-day grace period)' });
      await invalidateAssetsCache();
      res.json({ success: true, message: 'Asset marked for deletion (30-day grace period)' });
    } else {
      res.status(404).send('Asset not found');
    }
  } catch (err) {
    console.error('Failed to delete asset:', err);
    res.status(500).send('Error deleting asset: ' + err.message);
  }
});

app.post('/api/assets/:id/link-po-item', authenticateJWT, async (req, res) => {
  try {
    const { id } = req.params;
    const { poItemId } = req.body;
    
    // Check if it's a permanent or temporary asset
    const isTemp = id.startsWith('MUMT-');
    
    await db.transaction(async (trx) => {
        if (isTemp) {
            await trx('temporary_assets').where('id', id).update({ linked_po_item_id: poItemId || null });
        } else {
            await trx('assets').where('id', id).update({ linked_po_item_id: poItemId || null });
        }
        
        if (poItemId) {
            const item = await trx('project_order_items').where('id', poItemId).first();
            if (item) {
                const permanentResult = await trx('assets').where('linked_po_item_id', poItemId).count('id as count').first();
                const temporaryResult = await trx('temporary_assets').where('linked_po_item_id', poItemId).count('id as count').first();
                
                const fulfilledCount = parseInt(permanentResult.count || 0) + parseInt(temporaryResult.count || 0);
                const qtyOrdered = parseFloat(item.qtyordered || item.QtyOrdered || 0);
                const newStatus = fulfilledCount >= qtyOrdered ? 'Shipped' : 'Partially Fulfilled';
                await trx('project_order_items').where('id', poItemId).update({ status: newStatus });
            }
        }
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Link PO item error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/audit', authenticateJWT, async (req, res) => {
  try {
    const log = await db('audit_log').orderBy('timestamp', 'desc').limit(1000);
    res.json(normalizeResult(log));
  } catch (err) {
    console.error('Failed to fetch audit log:', err);
    res.status(500).send('Database error');
  }
});

app.get('/api/reports/asset-history', async (req, res) => {
  console.log(`[Report] Generating history report. Query:`, req.query);
  try {
    const { section, assetId, startDate, endDate } = req.query;
    
    let query = db('assets as a')
      .leftJoin('project_assets as pa', 'a.id', 'pa.assetid')
      .leftJoin('audit_log as al', 'a.id', 'al.assetid')
      .select(
        'a.*',
        'pa.projectid as ProjectID',
        'al.action as Action',
        'al.user as User',
        'al.timestamp as HistoryTimestamp',
        'al.details as Details',
        'al.severity as Severity'
      );

    if (assetId) {
      query = query.where('a.id', assetId);
    } else if (section) {
      query = query.where(function() {
        this.where('a.category', section)
          .orWhere('a.type', section)
          .orWhere('a.currentlocation', section);
      });
    }

    if (startDate) {
      query = query.where('al.timestamp', '>=', startDate);
    }
    if (endDate) {
      query = query.where('al.timestamp', '<=', endDate);
    }

    query = query.orderBy('a.id').orderBy('al.timestamp', 'desc');
    const rows = await query;

    // Group by asset for a cleaner report structure
    const report = [];
    let currentAsset = null;

    rows.forEach(row => {
      if (!currentAsset || currentAsset.ID !== row.id) {
        currentAsset = {
          ID: row.id,
          ItemName: row.itemname,
          Status: row.status,
          Type: row.type,
          Category: row.category,
          CurrentLocation: row.currentlocation,
          AssignedTo: row.assignedto,
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

    const project = await db('projects').where('id', id).first();
    if (project) {
      const urlText = `http://${ip}:${port}/project/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      await db('projects').where('id', id).update({ qrcode: qrCode });
      res.setHeader('Content-Type', 'image/png');
      return res.send(png);
    }

    const asset = await db('assets').where('id', id).select('qrcode').first();
    if (asset && asset.qrcode && asset.qrcode.startsWith('data:image/')) {
      const base64Data = asset.qrcode.split(',')[1];
      const img = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(img);
    }

    const assetExists = await db('assets').where('id', id).first();
    if (assetExists) {
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(id)}`;
      const [png, qrCode] = await Promise.all([
        qrcode.toBuffer(urlText, { width: 512 }),
        qrcode.toDataURL(urlText, { width: 512 })
      ]);
      await db('assets').where('id', id).update({ qrcode: qrCode });
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

app.delete('/api/dynamic/:code', authenticateJWT, authorizeRoles('admin', 'superuser'), async (req, res) => {
  try {
    const c = req.params.code;
    const dyn = readDynamic();
    if (!dyn[c]) return res.status(404).send('Not found');
    
    delete dyn[c];
    writeDynamic(dyn);
    
    appendAudit({ 
        Action: 'DYNAMIC_DELETE', 
        User: req.user.username || 'web', 
        AssetId: c, 
        Severity: 'INFO', 
        Details: 'Dynamic deleted' 
    });
    
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

app.get('/api/assets/search', authenticateJWT, async (req, res) => {
  const queryText = req.query.q;
  const page = parseInt(req.query.page) || 1;
  const size = parseInt(req.query.size) || 20;

  if (!queryText) return res.json({ last_page: 1, data: [] });
  
  try {
    const tokens = queryText.split(/\s+/).filter(t => t.length > 0);
    if (tokens.length === 0) return res.json({ last_page: 1, data: [] });

    let query = db('assets as a')
        .leftJoin('asset_it_details as it', 'a.id', 'it.assetid')
        .where(function() {
            this.where('a.is_deleted', 0).orWhereNull('a.is_deleted');
        });

    tokens.forEach(token => {
        const term = `%${token}%`;
        query.andWhere(function() {
            this.where('a.itemname', 'ilike', term)
                .orWhere('a.id', 'ilike', term)
                .orWhere('a.model', 'ilike', term)
                .orWhere('a.srno', 'ilike', term)
                .orWhere('a.currentlocation', 'ilike', term)
                .orWhere('a.type', 'ilike', term)
                .orWhere('a.category', 'ilike', term)
                .orWhere('a.status', 'ilike', term)
                .orWhere('a.assignedto', 'ilike', term)
                .orWhere('a.remarks', 'ilike', term)
                .orWhere('it.macaddress', 'ilike', term)
                .orWhere('it.ipaddress', 'ilike', term)
                .orWhere('it.userid', 'ilike', term)
                .orWhere('it.networktype', 'ilike', term)
                .orWhere('it.vlan', 'ilike', term)
                .orWhere('it.socketid', 'ilike', term);
        });
    });

    const totalCount = await query.clone().count('* as count').first();
    const results = await query
        .select('a.*', 'it.macaddress', 'it.ipaddress', 'it.userid', 'it.networktype', 'it.vlan', 'it.socketid')
        .orderBy('a.lastupdated', 'desc')
        .offset((page - 1) * size)
        .limit(size);

    res.json({
        last_page: Math.ceil(Number(totalCount.count) / size),
        data: normalizeResult(results)
    });
  } catch (err) {
    console.error('Asset search error:', err);
    res.status(500).json({ error: err.message });
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
      const existing = await db('asset_it_details')
        .whereRaw('LOWER(macaddress) = ?', [mac])
        .select('assetid', 'ipaddress', 'macaddress')
        .first();

      if (existing) {
        // If the IP has changed, update it
        if (existing.ipaddress !== device.ip) {
          console.log(`[NetworkMonitor] Detected IP change for Asset ${existing.assetid}: ${existing.ipaddress} -> ${device.ip} (MAC: ${mac}, Host: ${hostname}, Mfg: ${manufacturer})`);
          
          await db('asset_it_details')
            .where('assetid', existing.assetid)
            .update({ ipaddress: encryptionService.encryptDeterministic(device.ip) });
          
          await db('assets')
            .where('id', existing.assetid)
            .update({ lastupdated: now });

          appendAudit({
            Action: 'IP_AUTO_SYNC',
            User: 'SYSTEM',
            AssetId: existing.assetid,
            Severity: 'INFO',
            Details: `Automatically updated IP from ${existing.ipaddress} to ${device.ip} (Hostname: ${hostname}, Manufacturer: ${manufacturer}) based on background network scan.`
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
        const allowedFields = ['ProjectName', 'ClientName', 'Status', 'Description', 'StartDate', 'EndDate', 'Location', 'Currency', 'OwnerEmail', 'CoordinatorEmail'];
        const fields = Object.keys(updates).filter(key => allowedFields.includes(key));
        
        if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        const updateData = {};
        fields.forEach(f => updateData[f.toLowerCase()] = updates[f]);
        updateData.updated_at = new Date().toISOString();

        const result = await db('projects').where('id', id).update(updateData);

        if (result > 0) {
            // Regenerate QR code if relevant fields changed
            const relevantFields = ['ProjectName', 'ClientName', 'Location', 'Status', 'Description', 'StartDate', 'EndDate', 'OwnerEmail', 'CoordinatorEmail'];
            if (fields.some(f => relevantFields.includes(f))) {
                try {
                    const project = await db('projects').where('id', id).first();
                    if (project) {
                        const ip = getLocalIP();
                        const port = process.env.PORT || 9090;
                        
                        // Use the new standardized Project QR payload generator
                        const qrPayload = generateProjectQRPayload(normalizeResult(project), ip, port);
                        
                        const qrCode = await qrcode.toDataURL(JSON.stringify(qrPayload), { width: 512 });
                        await db('projects').where('id', id).update({ qrcode: qrCode });
                    }
                } catch (qrErr) {
                    console.error('Failed to regenerate project QR code (external):', qrErr);
                }
            }

            // Log the change
            appendAudit({ 
                Action: 'EXTERNAL_UPDATE_PROJECT', 
                User: 'External API', 
                AssetId: id, 
                Severity: 'INFO', 
                Details: `Updated ${fields.join(', ')} for project ${id}` 
            });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Project not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 6. Get Single Project Details
app.get('/api/external/projects/:id', checkApiKey, async (req, res) => {
    try {
        const { id } = req.params;
        const project = await db('projects').whereRaw('LOWER(id) = LOWER(?)', [id]).first();
        
        if (project) {
            const assets = await db('assets as a')
                .join('project_assets as pa', 'a.id', 'pa.assetid')
                .whereRaw('LOWER(pa.projectid) = LOWER(?)', [id])
                .select('a.*');
            
            res.json({ ...normalizeResult(project), assets: normalizeResult(assets) });
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

app.get('/api/company-templates', authenticateJWT, async (req, res) => {
    try {
        const templates = await db('company_templates').orderBy('name');
        res.json({ success: true, templates: normalizeResult(templates) });
    } catch (err) {
        console.error('Error fetching company templates:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/company-templates', authenticateJWT, async (req, res) => {
    try {
        const { name, company_name, address, gst, cin, state_name, state_code, is_default } = req.body;
        
        if (!name || !company_name) {
            return res.status(400).json({ success: false, error: 'Template name and Company Name are required' });
        }

        await db.transaction(async (trx) => {
            if (is_default) {
                await trx('company_templates').update({ is_default: 0 });
            }

            const [id] = await trx('company_templates').insert(normalizeDBData({
                name, 
                company_name, 
                address, 
                gst, 
                cin, 
                state_name, 
                state_code, 
                is_default: is_default ? 1 : 0
            })).returning('id');
            
            res.json({ success: true, id: id.id || id });
        });
    } catch (err) {
        console.error('Error creating company template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/company-templates/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, company_name, address, gst, cin, state_name, state_code, is_default } = req.body;

        await db.transaction(async (trx) => {
            if (is_default) {
                await trx('company_templates').update({ is_default: 0 });
            }

            await trx('company_templates')
                .where('id', id)
                .update(normalizeDBData({
                    name, 
                    company_name, 
                    address, 
                    gst, 
                    cin, 
                    state_name, 
                    state_code, 
                    is_default: is_default ? 1 : 0, 
                    updated_at: new Date().toISOString()
                }));
            
            res.json({ success: true });
        });
    } catch (err) {
        console.error('Error updating company template:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/company-templates/:id', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        await db('company_templates').where('id', id).delete();
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
    const { parentId, serials, quantity, autoAssign, projectId } = req.body;
    console.log(`[SPLIT] Request for Parent: ${parentId}, Serials: ${serials ? serials.join(', ') : 'None'}, Qty: ${quantity || 'None'}`);
    
    if (!parentId || (!serials && !quantity)) {
      return res.status(400).json({ error: 'Parent ID and either serial numbers or quantity required' });
    }

    let parent = await db('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId]).first();
    parent = normalizeResult(parent);
    
    if (!parent) return res.status(404).json({ error: 'Parent asset not found' });

    const ts = new Date().toISOString();
    const actor = getRequestActor(req);

    let projectName = projectId || 'N/A';
    let projectInitials = 'NA';
    try {
        const project = await db('projects').where('id', projectId).select('projectname', 'initials').first();
        if (project) {
            projectName = project.projectname;
            projectInitials = project.initials || 'NA';
        }
    } catch (err) {
        console.warn(`[SPLIT] Could not fetch project name for ${projectId}:`, err.message);
    }

    await db.transaction(async (trx) => {
        const createdChildren = [];
        let splitCount = 0;
        
        if (quantity && (!serials || serials.length === 0)) {
            // --- QUANTITY-BASED SPLIT (Global Standard for Bulk Items) ---
            const qtyToSplit = parseFloat(quantity);
            const currentQty = parseFloat(parent.quantity_available || 0);
            
            if (qtyToSplit <= 0 || qtyToSplit > currentQty) {
                throw new Error(`Invalid quantity. Available: ${currentQty}, Requested: ${qtyToSplit}`);
            }
            splitCount = qtyToSplit;

            // 1. Update Parent Quantity (Use PascalCase since normalized)
            await trx('assets')
                .whereRaw('LOWER(id) = LOWER(?)', [parentId])
                .update({
                    quantity_total: (parent.QuantityTotal || 0) - qtyToSplit,
                    quantity_available: (parent.QuantityAvailable || 0) - qtyToSplit,
                    lastupdated: ts
                });

            // 2. Determine if we should MERGE into an existing split child in the same project/user
            let targetChildId = null;
            if (projectId) {
                const existingChildRow = await trx('assets')
                    .join('project_assets', 'assets.id', 'project_assets.assetid')
                    .where('assets.parentid', parentId)
                    .where('project_assets.projectid', projectId)
                    .select('assets.*')
                    .first();
                const existingChild = normalizeResult(existingChildRow);

                if (existingChild) {
                    targetChildId = existingChild.ID;
                    console.log(`[SPLIT] Found existing child ${targetChildId} in project ${projectId}. Merging qty ${qtyToSplit}`);
                    
                    const newTotal = (existingChild.QuantityTotal || 0) + qtyToSplit;
                    const newAvailable = (existingChild.QuantityAvailable || 0) + qtyToSplit;
                    const additionalValue = (parent.AssetValue || 0) * (qtyToSplit / (parent.QuantityTotal || 1));

                    await trx('assets')
                        .where('id', targetChildId)
                        .update({
                            quantity_total: newTotal,
                            quantity_available: newAvailable,
                            asset_value: (existingChild.AssetValue || 0) + additionalValue,
                            lastupdated: ts
                        });
                    
                    await logAssetHistory(targetChildId, 'QUANTITY_INCREASED', existingChild.QuantityTotal, newTotal, actor, `Merged ${qtyToSplit} ${parent.QuantityUnit} from parent ${parentId} via re-split`, trx);
                }
            } else if (autoAssign) {
                const existingChildRow = await trx('assets')
                    .where('parentid', parentId)
                    .where('assignedto', autoAssign)
                    .where('status', 'Assigned')
                    .select('*')
                    .first();
                const existingChild = normalizeResult(existingChildRow);

                if (existingChild) {
                    targetChildId = existingChild.ID;
                    console.log(`[SPLIT] Found existing child ${targetChildId} assigned to ${autoAssign}. Merging qty ${qtyToSplit}`);

                    const newTotal = (existingChild.QuantityTotal || 0) + qtyToSplit;
                    const newAvailable = (existingChild.QuantityAvailable || 0) + qtyToSplit;
                    const additionalValue = (parent.AssetValue || 0) * (qtyToSplit / (parent.QuantityTotal || 1));

                    await trx('assets')
                        .where('id', targetChildId)
                        .update({
                            quantity_total: newTotal,
                            quantity_available: newAvailable,
                            asset_value: (existingChild.AssetValue || 0) + additionalValue,
                            lastupdated: ts
                        });
                    
                    await logAssetHistory(targetChildId, 'QUANTITY_INCREASED', existingChild.QuantityTotal, newTotal, actor, `Merged ${qtyToSplit} ${parent.QuantityUnit} from parent ${parentId} via re-split`, trx);
                }
            }

            if (!targetChildId) {
                // 3. Create One Child Asset with the split quantity (Standard logic)
                const childId = generateModernAssetId(parent.CurrentLocation, parent.Type);
                targetChildId = childId;
                
                let status = parent.Status;
                let assignedTo = parent.AssignedTo;
                let clientLabel = null;
                
                if (autoAssign) {
                    status = 'Assigned';
                    assignedTo = autoAssign;
                } else if (projectId) {
                    status = 'Project';
                    assignedTo = `Project: ${projectName}`;
                    const assetParts = childId.split('-');
                    const assetKind = assetParts[0] || 'AST';
                    const sixDigitCode = assetParts[3] || '000000';
                    clientLabel = `${assetKind}-${projectInitials}-${sixDigitCode}`;
                }

                const childRecord = normalizeDBData({
                    id: childId,
                    itemname: parent.ItemName,
                    itemdescription: parent.ItemDescription,
                    status: status,
                    make: parent.Make,
                    model: parent.Model,
                    srno: parent.SrNo, 
                    type: parent.Type,
                    category: parent.Category,
                    icon: parent.Icon,
                    isplaceholder: 0,
                    parentid: parentId,
                    currentlocation: parent.CurrentLocation,
                    dispatchreceivedt: parent.DispatchReceiveDt,
                    purchasedetails: parent.PurchaseDetails,
                    remarks: parent.Remarks,
                    purpose: parent.Purpose,
                    lastupdated: ts,
                    qrcode: null,
                    assignedto: assignedTo,
                    client_label: clientLabel,
                    noqr: parent.NoQR,
                    warranty_months: parent.WarrantyMonths || 0,
                    amc_months: parent.AMCMonths || 0,
                    asset_value: (parent.AssetValue || 0) * (qtyToSplit / (parent.QuantityTotal || 1)),
                    currency: parent.Currency || 'INR',
                    purchasedate: parent.PurchaseDate,
                    is_quantity_tracked: 1,
                    quantity_total: qtyToSplit,
                    quantity_available: qtyToSplit,
                    quantity_unit: parent.QuantityUnit || 'pcs',
                    is_batch: 0
                });

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

                await logAssetHistory(childId, 'SPLIT_CHILD_CREATED', null, null, actor, `Split ${qtyToSplit} ${parent.QuantityUnit} from parent ${parentId}`, trx);
            }

            await logAssetHistory(parentId, 'QUANTITY_REDUCED', parent.QuantityAvailable, parent.QuantityAvailable - qtyToSplit, actor, `Split ${qtyToSplit} ${parent.QuantityUnit} to ${targetChildId}`, trx);

        } else {
            // --- SERIAL-BASED SPLIT (Existing Logic for Serialized Items) ---
            let parentSrNo = parent.SrNo || parent.srno;
            if (parentSrNo) {
                parentSrNo = encryptionService.universalDecrypt(parentSrNo);
            }

            const currentSerials = (parentSrNo || '').split(/[\n,]+/).map(s => s.trim()).filter(s => s.length > 0);
            const newSerials = currentSerials.filter(sn => !serials.includes(sn));
            splitCount = currentSerials.length - newSerials.length;

            if (splitCount === 0) {
                throw new Error('None of the selected serial numbers were found in this batch');
            }

            // 1. Force Sync Parent Quantity
            await trx('assets')
                .whereRaw('LOWER(id) = LOWER(?)', [parentId])
                .update({
                    quantity_total: newSerials.length,
                    quantity_available: newSerials.length,
                    srno: encryptionService.encryptDeterministic(newSerials.join(', ')),
                    lastupdated: ts
                });

            // 2. Create Children
            for (const sn of serials) {
                const childId = generateModernAssetId(parent.CurrentLocation, parent.Type);
                
                let status = parent.Status;
                let assignedTo = parent.AssignedTo;
                let clientLabel = null;
                
                if (autoAssign) {
                    status = 'Assigned';
                    assignedTo = autoAssign;
                } else if (projectId) {
                    status = 'Project';
                    assignedTo = `Project: ${projectName}`;
                    const assetParts = childId.split('-');
                    const assetKind = assetParts[0] || 'AST';
                    const sixDigitCode = assetParts[3] || '000000';
                    clientLabel = `${assetKind}-${projectInitials}-${sixDigitCode}`;
                }

                const childRecord = normalizeDBData({
                    id: childId,
                    itemname: parent.ItemName,
                    itemdescription: parent.ItemDescription,
                    status: status,
                    make: parent.Make,
                    model: parent.Model,
                    srno: encryptionService.encryptDeterministic(sn),
                    type: parent.Type,
                    category: parent.Category,
                    icon: parent.Icon,
                    isplaceholder: 0,
                    parentid: parentId,
                    currentlocation: parent.CurrentLocation,
                    dispatchreceivedt: parent.DispatchReceiveDt,
                    purchasedetails: parent.PurchaseDetails,
                    remarks: parent.Remarks,
                    purpose: parent.Purpose,
                    lastupdated: ts,
                    qrcode: null,
                    assignedto: assignedTo,
                    client_label: clientLabel,
                    noqr: parent.NoQR,
                    warranty_months: parent.WarrantyMonths || 0,
                    amc_months: parent.AMCMonths || 0,
                    asset_value: (parent.AssetValue || 0) / (currentSerials.length || 1),
                    currency: parent.Currency || 'INR',
                    purchasedate: parent.PurchaseDate,
                    is_quantity_tracked: 0,
                    is_batch: 0
                });

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
            await logAssetHistory(parentId, 'SPLIT_PARENT_UPDATED', currentSerials.join(', '), newSerials.join(', '), actor, `Split ${splitCount} units`, trx);
        }

        res.locals.createdAssets = createdChildren.map(c => normalizeResult(c));
        res.locals.splitCount = splitCount;
    });

    res.json({ success: true, count: res.locals.splitCount, assets: res.locals.createdAssets });
  } catch (err) {
    console.error('[SPLIT] Fatal Error:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Unsplit/Move back a child asset to its parent batch or set.
 */
app.post('/api/assets/unsplit', authenticateJWT, async (req, res) => {
  try {
    const { childIds, assetId, parentId: providedParentId } = req.body;
    const actor = getRequestActor(req);
    const ts = new Date().toISOString();

    const idsToProcess = childIds || (assetId ? [assetId] : []);

    if (!idsToProcess || !Array.isArray(idsToProcess) || idsToProcess.length === 0) {
      return res.status(400).json({ error: 'List of Asset IDs required' });
    }

    console.log(`[UNSPLIT] Request to unsplit assets: ${idsToProcess.join(', ')}`);

    await db.transaction(async (trx) => {
        for (const id of idsToProcess) {
            console.log(`[UNSPLIT] Processing asset: ${id}`);
            // 1. Check BOTH tables for the child
            let child = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).first();
            let isFullAsset = !!child;
            
            if (!child) {
                child = await trx('components').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).first();
            }

            if (!child) {
                console.warn(`[UNSPLIT] Child ${id} not found in either assets or components table.`);
                continue;
            }

            const parentId = providedParentId || child.parentid || child.ParentId;
            console.log(`[UNSPLIT] Found child ${id}, parentId in DB: ${child.parentid || child.ParentId}, providedParentId: ${providedParentId}`);
            
            if (!parentId) {
                console.warn(`[UNSPLIT] No parentId found for child ${id}.`);
                continue;
            }

            // 2. Get the parent
            let parent = await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [parentId.toLowerCase()]).first();
            parent = normalizeResult(parent);
            
            if (!parent) {
                console.warn(`[UNSPLIT] Parent ${parentId} not found in database.`);
                continue;
            }

            console.log(`[UNSPLIT] Found parent ${parent.ID}. IsBatch: ${parent.IsBatch}, IsQuantityTracked: ${parent.IsQuantityTracked}`);

            // CASE 1: Parent is a Batch or Quantity asset (Merge and Delete behavior)
            if (parent.IsBatch || parent.IsQuantityTracked || parent.is_batch || parent.is_quantity_tracked) {
                console.log(`[UNSPLIT] Merging split child ${id} back into parent batch ${parentId}`);
                
                const qtyToRestore = parseFloat(child.quantity_total || child.QuantityTotal || child.quantity_available || 1);
                await trx('assets')
                  .whereRaw('LOWER(id) = LOWER(?)', [parentId.toLowerCase()])
                  .update({
                    quantity_available: (parent.QuantityAvailable || parent.quantity_available || 0) + qtyToRestore,
                    quantity_total: (parent.QuantityTotal || parent.quantity_total || 0) + qtyToRestore,
                    lastupdated: ts
                  });
                
                // Remove from project assignments too
                await trx('project_assets').whereRaw('LOWER(assetid) = LOWER(?)', [id.toLowerCase()]).delete();
                
                await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).delete();
                await trx('components').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).delete();
                
                await logAssetHistory(parentId, 'SPLIT_CHILD_RESTORED', null, null, actor, `Merged ${qtyToRestore} units back from child ${id}`, trx);
            } 
            // CASE 2: Parent is a SET (Break from set, return to store)
            else {
                console.log(`[UNSPLIT] Breaking item ${id} out of SET ${parentId}`);
                
                // 1. Remove from project assignments
                await trx('project_assets').whereRaw('LOWER(assetid) = LOWER(?)', [id.toLowerCase()]).delete();

                // 2. Clear parent link and return to general store
                if (isFullAsset) {
                    await trx('assets').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).update({
                        parentid: null,
                        status: 'In Store',
                        currentlocation: 'Mumbai',
                        assignedto: null,
                        lastupdated: ts
                    });
                } else {
                    await trx('components').whereRaw('LOWER(id) = LOWER(?)', [id.toLowerCase()]).update({
                        parentid: null,
                        lastupdated: ts
                    });
                }
                await logAssetHistory(id, 'BREAK_SET', parentId, 'STANDALONE', actor, `Broken out from set via unsplit. Returned to general store.`, trx);
            }
        }
    });

    await invalidateAssetsCache();
    res.json({ success: true, message: `Successfully processed assets` });
  } catch (err) {
    console.error('[UNSPLIT] Error:', err);
    res.status(500).json({ error: err.message });
  }
});





// --- Google Sheets Sync Endpoint ---
app.post('/api/external/sheets-sync', authenticateJWT, authorizeRoles('superuser', 'admin', 'manager'), async (req, res) => {
    const { 
        ItemDescription, 
        Make, 
        Model, 
        SrNo, 
        CurrentLocation, 
        Category, // The mandatory Category column we discussed
        DispatchReceiveDt,
        PurchaseDetails,
        QuantityTotal
    } = req.body;

    console.log(`[SHEETS-SYNC] Received sync request for: ${Make} ${Model} (${SrNo})`);

    if (!Make || !SrNo || !Category) {
        return res.status(400).json({ error: 'Make, SrNo, and Category are mandatory for sync.' });
    }

    try {
        await db.transaction(async (trx) => {
            // 1. Ensure the Parent Category exists (e.g., 'Monitor')
            let parentKind = await trx('asset_kinds')
                .whereRaw('LOWER(name) = LOWER(?)', [Category])
                .first();
            
            if (!parentKind) {
                console.log(`[SHEETS-SYNC] Creating missing base category: ${Category}`);
                await trx('asset_kinds').insert({
                    name: Category,
                    module: 'IT',
                    icon: '📦',
                    lastupdated: new Date().toISOString()
                });
            }

            // 2. Ensure the Brand Sub-Category exists (e.g., 'Konvision' inside 'Monitor')
            const brandSubCatName = Make;
            let brandSubCat = await trx('asset_kinds')
                .whereRaw('LOWER(name) = LOWER(?) AND LOWER(parentname) = LOWER(?)', [brandSubCatName, Category])
                .first();

            if (!brandSubCat) {
                console.log(`[SHEETS-SYNC] Creating brand sub-category: ${brandSubCatName} under ${Category}`);
                await trx('asset_kinds').insert({
                    name: brandSubCatName,
                    parentname: Category,
                    module: 'IT',
                    icon: '🏷️',
                    lastupdated: new Date().toISOString()
                });
            }

            // 3. Create or Update the Asset
            const itemName = ItemDescription || `${Make} ${Model}`;
            const assetId = generateModernAssetId(CurrentLocation || 'In Store', brandSubCatName);
            
            // Check for existing Serial Number to prevent duplicates
            const encryptedSrNo = encryptionService.encryptDeterministic(SrNo);
            const existingAsset = await trx('assets').where('srno', encryptedSrNo).first();

            if (existingAsset) {
                console.log(`[SHEETS-SYNC] Asset with S/N ${SrNo} already exists. Updating existing record.`);
                await trx('assets').where('id', existingAsset.id).update({
                    itemname: itemName,
                    model: Model,
                    currentlocation: CurrentLocation || 'In Store',
                    purchasedetails: PurchaseDetails || '',
                    dispatchreceivedt: DispatchReceiveDt || '',
                    lastupdated: new Date().toISOString()
                });
            } else {
                await trx('assets').insert(normalizeDBData({
                    ID: assetId,
                    ItemName: itemName,
                    Status: 'In Store',
                    Make: Make,
                    Model: Model,
                    SrNo: encryptedSrNo,
                    Type: brandSubCatName, // The Kind is the Brand Sub-Category
                    Category: 'IT', 
                    CurrentLocation: CurrentLocation || 'In Store',
                    DispatchReceiveDt: DispatchReceiveDt || '',
                    PurchaseDetails: PurchaseDetails || '',
                    LastUpdated: new Date().toISOString(),
                    quantity_total: QuantityTotal || 1,
                    quantity_available: QuantityTotal || 1
                }));
                console.log(`[SHEETS-SYNC] Created new asset: ${assetId}`);
            }
        });

        await invalidateAssetsCache();
        await invalidateAssetKindsCache();
        res.json({ success: true, message: 'Data synced successfully' });

    } catch (err) {
        console.error('[SHEETS-SYNC] Failed:', err);
        res.status(500).json({ error: 'Sync failed: ' + err.message });
    }
});

app.get('/api/projects/:id/available-inventory', authenticateJWT, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`[INVENTORY] Fetching available inventory for project: ${id}`);
        
        const assets = await db('assets as a')
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
        
        res.json({ success: true, assets: normalizeResult(assets) });
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
