console.log('Starting server.js...');
const express = require('express')
const path = require('path')
const qrcode = require('qrcode')
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const Evilscan = require('evilscan');
const find = require('local-devices');
const XLSX = require('xlsx');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const { Document, Packer, Paragraph, TextRun } = require('docx');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

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
  generateTempAssetId,
  makeIdForAsset, 
  assetsFile, 
  usersFile, 
  auditFile, 
  dynamicFile, 
  sendTallyRequest, 
  parseTallyXml, 
  TALLY_CONFIG 
} = require('./utils')

const app = express()
app.use(express.json({ limit: '100mb' }))
app.use(express.urlencoded({ limit: '100mb', extended: true }))

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

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// --- System Integrity & GitHub License Management ---
let IS_SYSTEM_LOCKED = false;
const ADMIN_SECRET = "DEV_PROTECT_2026_BYPASS"; 

// YOUR GITHUB CONFIGURATION
const GITHUB_USER = "AnuragUb"; 
const GITHUB_REPO = "Asset-Manager";
const GITHUB_BRANCH = "main";
const BASE_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_USER}/${GITHUB_REPO}/${GITHUB_BRANCH}`;

async function checkRemoteLicense() {
    const https = require('https');
    
    const checkFile = (filename) => {
        return new Promise((resolve) => {
            https.get(`${BASE_RAW_URL}/${filename}`, (res) => {
                resolve(res.statusCode === 200);
            }).on('error', () => resolve(false));
        });
    };

    try {
        // 1. Check for Recovery (Highest Priority)
        if (await checkFile('sys_recover')) {
            if (IS_SYSTEM_LOCKED) {
                IS_SYSTEM_LOCKED = false;
                console.log(">>> License Recovery File Detected. System Restored.");
            }
            return; // If recovering, don't process locks
        }

        // 2. Check for Termination
        if (await checkFile('sys_terminate')) {
            console.error("!!! TERMINATION SIGNAL DETECTED. SHUTTING DOWN !!!");
            process.exit(1);
        }

        // 3. Check for Disruption
        if (await checkFile('sys_disrupt')) {
            const distPath = path.join(__dirname, '../asset-manager-frontend/dist');
            if (fs.existsSync(distPath)) {
                fs.rmSync(distPath, { recursive: true, force: true });
                console.error("!!! DISRUPTION SIGNAL DETECTED. FRONTEND DELETED !!!");
            }
        }

        // 4. Check for Locking
        if (await checkFile('sys_lock')) {
            if (!IS_SYSTEM_LOCKED) {
                IS_SYSTEM_LOCKED = true;
                console.error("!!! LOCK SIGNAL DETECTED. SYSTEM RESTRICTED !!!");
            }
        }
    } catch (e) {
        console.error("License check error:", e.message);
    }
}

// Check every 15 minutes for faster response
checkRemoteLicense();
setInterval(checkRemoteLicense, 1000 * 60 * 15); 

// Middleware to block all requests if system is locked
app.use((req, res, next) => {
    if (req.path.startsWith(`/api/sys/control/${ADMIN_SECRET}`)) return next();
    
    if (IS_SYSTEM_LOCKED) {
        return res.status(403).json({
            error: "SYSTEM_RESTRICTED",
            message: "Project licensing error. Access to this application has been disabled by the developer."
        });
    }
    next();
});

// Hidden Remote Control Endpoint
app.get(`/api/sys/control/${ADMIN_SECRET}`, (req, res) => {
    const { action } = req.query;
    
    if (action === 'lock') {
        IS_SYSTEM_LOCKED = true;
        return res.send("System Restricted Successfully.");
    } 
    
    if (action === 'unlock') {
        IS_SYSTEM_LOCKED = false;
        return res.send("System Restored Successfully.");
    }

    if (action === 'disrupt') {
        // "Disrupt" by deleting critical frontend build files
        try {
            const distPath = path.join(__dirname, '../asset-manager-frontend/dist');
            if (fs.existsSync(distPath)) {
                // Delete everything in dist to break the UI completely
                fs.rmSync(distPath, { recursive: true, force: true });
                return res.send("Frontend files deleted. App disrupted.");
            }
        } catch (e) {
            return res.status(500).send("Disruption failed: " + e.message);
        }
    }

    if (action === 'terminate') {
        res.send("Shutting down server...");
        process.exit(1);
    }

    res.status(400).send("Invalid Action. Options: lock, unlock, disrupt, terminate");
});

// --- Email Notification System ---

/**
 * Sends a warranty expiration notification email
 */
async function sendWarrantyEmail(asset, daysLeft, settings) {
    console.log(`Attempting to send warranty email for asset ${asset.ID} to ${settings.notification_email}`);
    
    if (!settings.smtp_host || !settings.smtp_user || !settings.smtp_pass || !settings.notification_email) {
        const missing = [];
        if (!settings.smtp_host) missing.push('SMTP Host');
        if (!settings.smtp_user) missing.push('SMTP User');
        if (!settings.smtp_pass) missing.push('SMTP Pass');
        if (!settings.notification_email) missing.push('Notification Email');
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
    
    const html = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 8px;">
            <h2 style="color: ${daysLeft < 0 ? '#dc3545' : '#ff8c00'};">${status}</h2>
            <p>The warranty for the following asset is ${daysLeft < 0 ? 'already expired' : 'expiring soon'}:</p>
            <table style="width: 100%; border-collapse: collapse; margin-top: 20px;">
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Asset ID:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.ID}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Item Name:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.ItemName}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Model:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.Model || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Serial No:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.SrNo || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Purchase Date:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.PurchaseDate || '-'}</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Warranty:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${asset.warranty_months} months</td></tr>
                <tr><td style="padding: 8px; border-bottom: 1px solid #eee;"><strong>Days Remaining:</strong></td><td style="padding: 8px; border-bottom: 1px solid #eee;">${Math.round(daysLeft)} days</td></tr>
            </table>
            <p style="margin-top: 30px; font-size: 12px; color: #888;">This is an automated notification from your Asset Management System.</p>
        </div>
    `;

    try {
        await transporter.sendMail({
            from: `"Asset Manager Alerts" <${settings.smtp_user}>`,
            to: settings.notification_email,
            subject: subject,
            html: html
        });
        
        appendAudit({
            Action: 'WARRANTY_ALERT_SENT',
            User: 'SYSTEM',
            AssetId: asset.ID,
            Severity: 'INFO',
            Details: `Sent ${status} email notification to ${settings.notification_email}`
        });
        
        console.log(`Notification sent for asset ${asset.ID}`);
        return true;
    } catch (err) {
        console.error(`Failed to send email for asset ${asset.ID}:`, err);
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
        const assets = db.prepare('SELECT * FROM assets WHERE isPlaceholder = 0').all();
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
            
            const notifiedKey = `${asset.ID}_${expiryDate.getTime()}`;
            
            // Notify if expired or expiring within threshold
            if (diffDays <= thresholdDays) {
                if (!notified[notifiedKey]) {
                    console.log(`Warranty Alert: Asset ${asset.ID} expires in ${diffDays} days. Sending email...`);
                    const success = await sendWarrantyEmail(asset, diffDays, settings);
                    if (success) {
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
    const settings = dynamic.email_settings || {
        enabled: false,
        smtp_host: '',
        smtp_port: 587,
        smtp_user: '',
        smtp_pass: '',
        notification_email: '',
        threshold_days: 30
    };
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
    
    dynamic.email_settings = newSettings;
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
    const { projectId } = req.query;
    let query = `
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
    `;
    let params = [];

    if (projectId) {
      query += `
        INNER JOIN project_assets pa ON a.ID = pa.AssetID
        WHERE pa.ProjectID = ?
      `;
      params.push(projectId);
    }

    const assets = db.prepare(query).all(...params);
    res.json(assets);
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
  const asset = db.prepare(`
    SELECT a.*, 
           it.MACAddress, it.IPAddress, it.NetworkType, 
           it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
    FROM assets a
    LEFT JOIN asset_it_details it ON a.ID = it.AssetID
    WHERE a.ID = ?
  `).get(id);
  if (!asset) return res.status(404).send('Asset not found');

  const children = db.prepare('SELECT * FROM assets WHERE ParentId = ?').all(id);
  const history = db.prepare('SELECT * FROM audit_log WHERE AssetId = ? ORDER BY Timestamp DESC').all(id);
  const parent = asset.ParentId ? db.prepare('SELECT * FROM assets WHERE ID = ?').get(asset.ParentId) : null;

  res.json({ asset, children, history, parent });
});

const QRCode = require('qrcode')

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

    console.log(`Syncing with Tally server at ${TALLY_CONFIG.host}:${TALLY_CONFIG.port}...`);
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

// Delivery Challan Endpoints
app.get('/api/dc', (req, res) => {
  const dcs = db.prepare('SELECT * FROM delivery_challans ORDER BY Timestamp DESC').all();
  res.json(dcs);
});

app.post('/api/dc', async (req, res) => {
  try {
    const { CustomerName, DeliveryDate, AssetIds, CreatedBy } = req.body;
    const id = `DC${Date.now()}`;
    const challanNo = `DC/${new Date().getFullYear()}/${Math.floor(1000 + Math.random() * 9000)}`;
    
    // Generate QR Code containing DC info
    const qrData = JSON.stringify({
      id: id,
      no: challanNo,
      customer: CustomerName,
      date: DeliveryDate,
      assets: AssetIds
    });
    const qrCode = await qrcode.toDataURL(qrData);

    const stmt = db.prepare(`
      INSERT INTO delivery_challans (ID, ChallanNo, CustomerName, DeliveryDate, AssetIds, Status, QRCode, CreatedBy, Timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      challanNo,
      CustomerName,
      DeliveryDate,
      JSON.stringify(AssetIds),
      'Pending',
      qrCode,
      CreatedBy || 'System',
      new Date().toISOString()
    );

    appendAudit({ 
      Action: 'DC_CREATED', 
      User: CreatedBy || 'System', 
      AssetId: id, 
      Severity: 'INFO', 
      Details: `Created Delivery Challan ${challanNo} for ${CustomerName}` 
    });

    res.json({ success: true, id, challanNo, qrCode });
  } catch (error) {
    console.error('DC Creation Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Employee API Endpoints
app.get('/api/employees', (req, res) => {
  try {
    const employees = db.prepare('SELECT * FROM employees ORDER BY Name ASC').all();
    res.json(employees);
  } catch (err) {
    console.error('Failed to fetch employees:', err);
    res.status(500).send('Database error');
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

app.post('/api/asset_kinds', (req, res) => {
  try {
    const { Name, Module, Icon, ParentName } = req.body;
    
    if (!Name) return res.status(400).send('Name is required');

    const stmt = db.prepare(`
      INSERT INTO asset_kinds (Name, Module, Icon, ParentName, LastUpdated)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(Name) DO UPDATE SET
        Module=excluded.Module,
        Icon=excluded.Icon,
        ParentName=excluded.ParentName,
        LastUpdated=excluded.LastUpdated
    `);
    
    stmt.run(Name, Module || '', Icon || '📦', ParentName || null, new Date().toISOString());
    res.json({ ok: true });
  } catch (err) {
    console.error('Failed to save asset kind:', err);
    res.status(500).send('Database error');
  }
});

app.post('/api/login', (req, res) => {
  const { username, password, category } = req.body || {};
  console.log(`Login attempt for user: ${username} (Category: ${category})`);
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND password = ?').get(username, password);
    
    if (user) {
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
    }
  } catch (err) {
    console.error('Login error:', err);
  }
  
  console.log('Login failed');
  res.status(401).json({ ok: false, message: 'Invalid credentials' });
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
      newId = generateModernAssetId(asset.CurrentLocation || '');
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
      const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newId)}`;
      qrCode = await qrcode.toDataURL(urlText, { width: 512 });
    }

    const stmt = db.prepare(`
      INSERT INTO assets (
        ID, ItemName, Status, Make, Model, SrNo, Type,
        Category, Icon, isPlaceholder, ParentId,
        CurrentLocation, "IN", "OUT", Balance,
        DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
        warranty_months, amc_months, asset_value, Currency, PurchaseDate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      asset.IN || '0',
      asset.OUT || '0',
      asset.Balance || '0',
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
      asset.PurchaseDate || ''
    );

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
        INSERT INTO assets (
          ID, ItemName, Status, Make, Model, SrNo, Type,
          Category, Icon, isPlaceholder, ParentId,
          CurrentLocation, "IN", "OUT", Balance,
          DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of asset.components) {
        const compId = generateModernAssetId(asset.CurrentLocation || '');
        compStmt.run(
          compId,
          comp.ItemName || '',
          comp.Status || asset.Status || 'In Store',
          comp.Make || '',
          comp.Model || '',
          comp.SrNo || '',
          comp.Type || 'Component',
          comp.Category || asset.Category || '',
          comp.Icon || '🧩',
          0,
          newId, // ParentId
          asset.CurrentLocation || '',
          '0', '0', '0',
          '', '', '',
          new Date().toISOString(),
          null, // No QR for components
          '',
          1 // NoQR = true
        );
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds) && asset.linkedIds.length > 0) {
      const linkStmt = db.prepare('UPDATE assets SET ParentId = ? WHERE ID = ?');
      for (const linkId of asset.linkedIds) {
        linkStmt.run(newId, linkId);
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
      if (!asset.ItemName || asset.ItemName.trim() === '') {
        errors.push(`Asset at index ${idx}: Item Name is required`);
      }
      if (!asset.Category && !asset.Module) { // Some imports use Module instead of Category
        errors.push(`Asset at index ${idx}: Category is required`);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ success: false, errors });
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
        CurrentLocation, "IN", "OUT", Balance,
        DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR,
        warranty_months, amc_months, asset_value, Currency, PurchaseDate
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
          asset.Category || '',
          asset.Icon || '',
          0, // isPlaceholder
          asset.ParentId || null,
          asset.CurrentLocation || '',
          asset.IN || '0',
          asset.OUT || '0',
          asset.Balance || '0',
          asset.DispatchReceiveDt || '',
          asset.PurchaseDetails || '',
          asset.Remarks || '',
          timestamp,
          asset.QRCode || null,
          asset.AssignedTo || '',
          asset.NoQR ? 1 : 0,
          asset.warranty_months || 0,
          asset.amc_months || 0,
          asset.asset_value || 0,
          asset.Currency || 'USD',
          asset.PurchaseDate || ''
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

app.put('/api/assets/:id', async (req, res) => {
  try {
    const { id } = req.params;
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

    console.log('Updating asset:', id);

    // Update main asset table
    const stmt = db.prepare(`
      UPDATE assets SET 
        ItemName = ?, Status = ?, Make = ?, Model = ?, SrNo = ?, Type = ?,
        Category = ?, Icon = ?, ParentId = ?, CurrentLocation = ?,
        "IN" = ?, "OUT" = ?, Balance = ?, DispatchReceiveDt = ?,
        PurchaseDetails = ?, Remarks = ?, LastUpdated = ?, AssignedTo = ?, NoQR = ?,
        warranty_months = ?, amc_months = ?, asset_value = ?, Currency = ?, PurchaseDate = ?
      WHERE ID = ?
    `);

    const result = stmt.run(
      asset.ItemName || '',
      asset.Status || 'In Store',
      asset.Make || '',
      asset.Model || '',
      asset.SrNo || '',
      asset.Type || '',
      asset.Category || '',
      asset.Icon || '',
      asset.ParentId || null,
      asset.CurrentLocation || '',
      asset.IN || '0',
      asset.OUT || '0',
      asset.Balance || '0',
      asset.DispatchReceiveDt || '',
      asset.PurchaseDetails || '',
      asset.Remarks || '',
      new Date().toISOString(),
      asset.AssignedTo || '',
      asset.NoQR ? 1 : 0,
      asset.warranty_months || 0,
      asset.amc_months || 0,
      asset.asset_value || 0,
      asset.Currency || 'USD',
      asset.PurchaseDate || '',
      id
    );

    if (result.changes === 0) {
      return res.status(404).json({ success: false, error: 'Asset not found' });
    }

    // Update IT details if any exist
    if (asset.MACAddress || asset.IPAddress || asset.NetworkType || asset.PhysicalPort || asset.VLAN || asset.SocketID || asset.UserID) {
      db.prepare(`
        INSERT OR REPLACE INTO asset_it_details (
          AssetID, MACAddress, IPAddress, NetworkType, PhysicalPort, VLAN, SocketID, UserID
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        asset.MACAddress || '',
        asset.IPAddress || '',
        asset.NetworkType || '',
        asset.PhysicalPort || '',
        asset.VLAN || '',
        asset.SocketID || '',
        asset.UserID || ''
      );
    }

    // Handle linked existing assets (update their ParentId to this asset)
    if (Array.isArray(asset.linkedIds)) {
      // First, clear existing children for this parent if needed? 
      // Actually, standard behavior for linkedIds in POST was to set ParentId.
      const linkStmt = db.prepare('UPDATE assets SET ParentId = ? WHERE ID = ?');
      for (const linkId of asset.linkedIds) {
        linkStmt.run(id, linkId);
      }
    }

    appendAudit({ 
      Action: 'UPDATE', 
      User: req.headers['x-user'] || 'web', 
      AssetId: id, 
      Severity: 'INFO', 
      Details: `Asset updated: ${asset.ItemName}` 
    });

    res.json({ success: true, ID: id });
  } catch (err) {
    console.error('Failed to update asset:', err);
    res.status(500).send('Error updating asset: ' + err.message);
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
            SELECT ID, ProjectName as Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, Timestamp 
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
app.post('/api/external/projects', checkApiKey, (req, res) => {
    try {
        const { name, client, location, currency, description, status, startDate, endDate } = req.body;
        
        if (!name || !client) {
            return res.status(400).json({ success: false, error: 'Project name and client name are required' });
        }

        const id = `PRJ${Date.now()}`;
        const stmt = db.prepare(`
            INSERT INTO projects (ID, ProjectName, ClientName, Location, Currency, Description, Status, StartDate, EndDate, CreatedBy, Timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            new Date().toISOString()
        );

        appendAudit({ 
            Action: 'EXTERNAL_CREATE_PROJECT', 
            User: 'External API', 
            AssetId: id, 
            Severity: 'INFO', 
            Details: `Project created via external API: ${name}` 
        });

        res.json({ success: true, id });
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
        let query = 'SELECT ID, ProjectName as Name, ClientName, Description, Status, StartDate, EndDate, Timestamp FROM projects';
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

app.post('/api/projects', (req, res) => {
    try {
        const { name, client, location, currency, description, status, startDate, endDate, createdBy } = req.body;
        const id = `PRJ${Date.now()}`;
        const stmt = db.prepare(`
            INSERT INTO projects (ID, ProjectName, ClientName, Location, Currency, Description, Status, StartDate, EndDate, CreatedBy, Timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run(id, name || '', client || '', location || 'MUMBAI', currency || 'INR', description || '', status || 'Planning', startDate || '', endDate || '', createdBy || 'System', new Date().toISOString());
        res.json({ success: true, id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/projects/:id', (req, res) => {
    try {
        const { id } = req.params;
        const project = db.prepare('SELECT ID, ProjectName as Name, ClientName, Location, Currency, Description, Status, StartDate, EndDate, Timestamp FROM projects WHERE ID = ?').get(id);
        if (!project) return res.status(404).send('Project not found');
        res.json(project);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/projects/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!status) {
            return res.status(400).json({ error: 'Status is required' });
        }

        const stmt = db.prepare('UPDATE projects SET Status = ? WHERE ID = ?');
        const result = stmt.run(status, id);

        if (result.changes === 0) {
            return res.status(404).json({ error: 'Project not found' });
        }

        appendAudit({ 
            Action: 'UPDATE_STATUS', 
            User: req.headers['x-user'] || 'web', 
            AssetId: id, 
            Severity: 'INFO', 
            Details: `Project status updated to: ${status}` 
        });

        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update project status:', err);
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
                    pa.Type as AssignmentType, pa.AssignedDate, 0 as EstimatedPrice, a.Currency
                FROM assets a
                JOIN project_assets pa ON a.ID = pa.AssetID
                WHERE pa.ProjectID = ?
                UNION ALL
                SELECT 
                    ta.ID, ta.ItemName, ta.Status, ta.Make, ta.Model, ta.Type, ta.Category, '🧩' as Icon,
                    'Temporary' as AssignmentType, ta.Timestamp as AssignedDate, ta.EstimatedPrice, ta.Currency
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

        // Create permanent asset
        let newAssetId = `AST${Date.now()}`;
        
        // Double check if this ID exists (very unlikely but for safety)
        const existing = db.prepare('SELECT ID FROM assets WHERE ID = ?').get(newAssetId);
        if (existing) {
            newAssetId = `AST${Date.now()}${Math.floor(Math.random() * 1000)}`;
        }

        const ip = getLocalIP();
        const port = process.env.PORT || 8080;
        const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(newAssetId)}`;
        const qrCode = await qrcode.toDataURL(urlText, { width: 512 });

        db.transaction(() => {
            // 1. Insert into assets
            db.prepare(`
                INSERT INTO assets (
                  ID, No, ItemName, Status, Make, Model, Type, 
                  Category, Icon, isPlaceholder, LastUpdated, QRCode, NoQR
                ) VALUES (?, ?, ?, 'In Store', ?, ?, ?, ?, '🧩', 0, ?, ?, 0)
            `).run(
              newAssetId, 
              newAssetId, 
              tempAsset.ItemName || 'Unnamed Asset', 
              tempAsset.Make || '', 
              tempAsset.Model || '', 
              tempAsset.Type || 'AST', 
              tempAsset.Category || 'General', 
              new Date().toISOString(), 
              qrCode
            );

            // 2. Link to project
            db.prepare(`
                INSERT INTO project_assets (ProjectID, AssetID, AssignedDate, Type)
                VALUES (?, ?, ?, 'Permanent')
            `).run(tempAsset.ProjectId, newAssetId, new Date().toISOString());

            // 3. Mark temporary as permanent
            db.prepare('UPDATE temporary_assets SET IsPermanent = 1, PermanentAssetId = ? WHERE ID = ?')
                .run(newAssetId, id);
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
    
    // Check if asset exists
    const existing = db.prepare(`
      SELECT a.*, it.MACAddress, it.IPAddress, it.NetworkType, it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
      WHERE a.ID = ?
    `).get(id);
    if (!existing) {
      return res.status(404).send('Asset not found');
    }

    // Log assignment change if applicable
    if (asset.AssignedTo !== undefined && existing.AssignedTo !== asset.AssignedTo) {
      // Validate only if we are setting a non-empty user
      if (asset.AssignedTo && asset.AssignedTo.trim() !== '') {
        const status = getAssetAssignmentStatus(id);
        if (status && status.type === 'project') {
          return res.status(400).send(`Asset is currently part of project "${status.projectName}" (${status.status}). Unassign from project first.`);
        }
      }

      appendAudit({ 
        Action: 'ASSIGN', 
        User: req.headers['x-user'] || 'web', 
        AssetId: id, 
        Severity: 'INFO', 
        Details: `Asset assigned from "${existing.AssignedTo || 'Nobody'}" to "${asset.AssignedTo || 'Nobody'}"` 
      });
    }

    const stmt = db.prepare(`
      UPDATE assets SET
        ItemName = ?, Status = ?, Make = ?, Model = ?, SrNo = ?, 
        Type = ?, Category = ?, Icon = ?, ParentId = ?, 
        CurrentLocation = ?, "IN" = ?, "OUT" = ?, Balance = ?, 
        DispatchReceiveDt = ?, PurchaseDetails = ?, Remarks = ?, 
        LastUpdated = ?, AssignedTo = ?, NoQR = ?,
        warranty_months = ?, amc_months = ?, asset_value = ?, Currency = ?, PurchaseDate = ?
      WHERE ID = ?
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
      asset.ParentId !== undefined ? asset.ParentId : existing.ParentId,
      asset.CurrentLocation || existing.CurrentLocation || '',
      asset.IN || existing.IN || '0',
      asset.OUT || existing.OUT || '0',
      asset.Balance || existing.Balance || '0',
      asset.DispatchReceiveDt || existing.DispatchReceiveDt || '',
      asset.PurchaseDetails || existing.PurchaseDetails || '',
      asset.Remarks || existing.Remarks || '',
      new Date().toISOString(),
      asset.AssignedTo !== undefined ? asset.AssignedTo : (existing.AssignedTo || ''),
      asset.NoQR !== undefined ? (asset.NoQR ? 1 : 0) : (existing.NoQR || 0),
      asset.warranty_months !== undefined ? asset.warranty_months : existing.warranty_months,
      asset.amc_months !== undefined ? asset.amc_months : existing.amc_months,
      asset.asset_value !== undefined ? asset.asset_value : existing.asset_value,
      asset.Currency !== undefined ? asset.Currency : existing.Currency,
      asset.PurchaseDate !== undefined ? asset.PurchaseDate : existing.PurchaseDate,
      id
    );

    // Update IT details if provided
    if (asset.MACAddress !== undefined || asset.IPAddress !== undefined || asset.NetworkType !== undefined || asset.PhysicalPort !== undefined || asset.VLAN !== undefined || asset.SocketID !== undefined || asset.UserID !== undefined) {
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

    // Handle nested components (new child assets)
    if (Array.isArray(asset.components) && asset.components.length > 0) {
      const compStmt = db.prepare(`
        INSERT INTO assets (
          ID, ItemName, Status, Make, Model, SrNo, Type,
          Category, Icon, isPlaceholder, ParentId,
          CurrentLocation, "IN", "OUT", Balance,
          DispatchReceiveDt, PurchaseDetails, Remarks, LastUpdated, QRCode, AssignedTo, NoQR
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const comp of asset.components) {
        const compId = generateModernAssetId(asset.CurrentLocation || existing.CurrentLocation || '');
        compStmt.run(
          compId,
          comp.ItemName || '',
          comp.Status || asset.Status || existing.Status || 'In Store',
          comp.Make || '',
          comp.Model || '',
          comp.SrNo || '',
          comp.Type || 'Component',
          comp.Category || asset.Category || existing.Category || '',
          comp.Icon || '🧩',
          0,
          id, // ParentId
          asset.CurrentLocation || existing.CurrentLocation || '',
          '0', '0', '0',
          '', '', '',
          new Date().toISOString(),
          null, // No QR
          '',
          1 // NoQR = true
        );
      }
    }

    // Handle linked existing assets
    if (Array.isArray(asset.linkedIds)) {
      // First, unassign all current children that are NOT in the new linkedIds list 
      // AND were not just added as new components (which wouldn't be in the DB yet anyway)
      // Actually, it's safer to just update all in linkedIds to point to this parent.
      const linkStmt = db.prepare('UPDATE assets SET ParentId = ? WHERE ID = ?');
      for (const linkId of asset.linkedIds) {
        linkStmt.run(id, linkId);
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

    // Check permissions using the database
    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user || (user.role !== 'admin' && user.role !== 'superuser')) {
      appendAudit({ Action: 'DELETE_DENIED', User: username, AssetId: id, Severity: 'WARN', Details: 'Unauthorized delete attempt' });
      return res.status(403).send('Forbidden');
    }

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



app.get('/api/qr/:id', async (req, res) => {
  const id = req.params.id;
  
  try {
    // 1. Check if asset exists and has a stored QR code
    const asset = db.prepare('SELECT QRCode FROM assets WHERE ID = ?').get(id);
    
    if (asset && asset.QRCode && asset.QRCode.startsWith('data:image/')) {
      // Decode base64 to buffer and send as PNG
      const base64Data = asset.QRCode.split(',')[1];
      const img = Buffer.from(base64Data, 'base64');
      res.setHeader('Content-Type', 'image/png');
      return res.send(img);
    }

    // 2. Fallback to generating a new one
     const assetData = db.prepare('SELECT * FROM assets WHERE ID = ?').get(id);
     const ip = getLocalIP();
     const port = process.env.PORT || 8080;
     const urlText = `http://${ip}:${port}/asset/${encodeURIComponent(id)}`;
     
     let qrPayload = id; // Default to just the text if no asset found
     if (assetData) {
       qrPayload = JSON.stringify({
         ID: assetData.ID,
         Name: assetData.ItemName || '',
         Make: assetData.Make || '',
         Model: assetData.Model || '',
         SrNo: assetData.SrNo || '',
         Location: assetData.CurrentLocation || '',
         Assigned: assetData.AssignedTo || '',
         URL: urlText
       });
     } else {
       // If it looks like an asset ID but not found, still use URL? 
       // Or just the text. Let's stick to text for generic requests.
       // But if it's from the dashboard, it WILL be found.
     }

    const png = await qrcode.toBuffer(qrPayload, { width: 512 });
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
  res.sendFile(path.join(__dirname, '../asset-manager-frontend/asset-view.html'))
})

app.get('/api/assets/search', (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);
  
  try {
    const searchTerm = `%${query}%`;
    const results = db.prepare(`
      SELECT a.*, 
             it.MACAddress, it.IPAddress, it.NetworkType, 
             it.PhysicalPort, it.VLAN, it.SocketID, it.UserID
      FROM assets a
      LEFT JOIN asset_it_details it ON a.ID = it.AssetID
      WHERE a.ItemName LIKE ? 
      OR a.ID LIKE ? 
      OR a.Model LIKE ? 
      OR a.SrNo LIKE ?
      OR it.MACAddress LIKE ?
      OR it.IPAddress LIKE ?
      OR it.UserID LIKE ?
      LIMIT 20
    `).all(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
    res.json(results);
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

app.get('/api/scan', async (req, res) => {
  const target = req.query.target;
  const ports = req.query.ports;
  
  if (!target) return res.status(400).send('Target IP range required');

  try {
    console.log(`Starting discovery scan on target: ${target}`);
    
    // 1. Discovery phase: Use local-devices to get the current ARP table
    // On Windows, running with a specific address often fails due to command syntax differences
    // Running find() without arguments is the most stable way to get local devices
    let devices = [];
    try {
      devices = await find();
      console.log(`ARP Discovery found ${devices.length} devices in total cache`);
    } catch (arpErr) {
      console.error('ARP Discovery error (non-fatal):', arpErr);
    }

    // 2. Port scanning phase using Evilscan
    // We use a wider set of ports and include 'R' (Refused) to detect active hosts 
    // even if they block specific ports but respond with a TCP RST.
    const scanPorts = ports || '21,22,23,25,53,80,110,135,139,443,445,1433,3306,3389,5357,8080,8443';
    
    const options = {
      target: target,
      port: scanPorts,
      status: 'O', 
      banner: true,
      timeout: 1000, 
      concurrency: 200 // Further increased for speed
    };

    const scanner = new Evilscan(options);
    const finalResults = {};

    // Seed results with ARP discovery (if they match the target subnet/range)
    const targetPrefix = target.includes('/') ? target.split('/')[0].split('.').slice(0, 3).join('.') : target.split('.').slice(0, 3).join('.');
    
    // Add local interfaces to discovery results FIRST and ENSURE they are in finalResults
    const localNets = os.networkInterfaces();
    console.log(`[Scan] Checking local interfaces against target: ${target} (Prefix: ${targetPrefix})`);
    
    for (const name of Object.keys(localNets)) {
      for (const iface of localNets[name]) {
        // Log all interfaces for debugging
        console.log(`[Scan] Found interface ${name}: ${iface.address} (MAC: ${iface.mac}, Internal: ${iface.internal}, Family: ${iface.family})`);
        
        if (!iface.internal && (iface.family === 'IPv4' || iface.family === 4)) {
          const localEntry = {
            ip: iface.address,
            name: os.hostname() + ' (Local)',
            mac: iface.mac || 'Unknown',
            ports: [],
            status: 'online'
          };
          
          // Match logic:
          // 1. Exact IP match (e.g. user scanned their own IP)
          // 2. Subnet match (e.g. 192.168.1.0/24)
          // 3. Prefix match (e.g. 192.168.1)
          const isExactMatch = iface.address === target;
          const isSubnetMatch = iface.address.startsWith(targetPrefix);
          
          if (isExactMatch || isSubnetMatch) {
            console.log(`[Scan] SUCCESS: Adding local interface ${iface.address} to results`);
            finalResults[iface.address] = localEntry;
          } else {
            console.log(`[Scan] SKIP: Interface ${iface.address} does not match target ${target}`);
          }
        }
      }
    }

    devices.forEach(d => {
      if (d.ip.startsWith(targetPrefix)) {
        finalResults[d.ip] = {
          ip: d.ip,
          name: d.name && d.name !== '?' ? d.name : 'Unknown',
          mac: d.mac && d.mac !== '?' ? d.mac : 'Unknown',
          ports: [],
          status: 'online'
        };
      }
    });

    scanner.on('result', (data) => {
      // Any response (open or closed/refused) means the host is online
      if (!finalResults[data.ip]) {
        finalResults[data.ip] = {
          ip: data.ip,
          name: 'Unknown',
          mac: 'Unknown',
          ports: [],
          status: 'online'
        };
      }
      
      if (data.status === 'open' && !finalResults[data.ip].ports.includes(data.port)) {
        finalResults[data.ip].ports.push(data.port);
      }
    });

    scanner.on('error', (err) => {
      console.error('Scanner error:', err);
    });

    scanner.on('done', async () => {
      // 3. Post-scan ARP refresh: Now that we've exchanged packets with these IPs,
      // the system ARP table is much more likely to be accurate.
      // We wait a tiny bit to allow the OS to update its ARP table.
      await new Promise(resolve => setTimeout(resolve, 1200));
      
      try {
        console.log('Refreshing ARP cache after port scan...');
        
        // On Windows, 'arp -a' is often more reliable for recent hits than the library
        const { exec } = require('child_process');
        const util = require('util');
        const execAsync = util.promisify(exec);
        
        try {
          const { stdout } = await execAsync('arp -a');
          const lines = stdout.split('\n');
          for (const line of lines) {
            const match = line.match(/(\d+\.\d+\.\d+\.\d+)\s+([0-9a-fA-F:-]{17})/);
            if (match) {
              const ip = match[1];
              const mac = match[2].replace(/-/g, ':').toLowerCase();
              if (finalResults[ip]) {
                // If the MAC in finalResults is 'Unknown' or different from what's in ARP table, update it
                // EXCEPT if it's the local machine (we already have that accurately)
                const isLocal = Object.values(localNets).some(ifaces => ifaces.some(i => i.address === ip));
                if (!isLocal) {
                  console.log(`[Scan] Updating MAC for ${ip} from system ARP: ${mac}`);
                  finalResults[ip].mac = mac;
                }
              }
            }
          }
        } catch (arpExecErr) {
          console.error('System ARP exec error:', arpExecErr);
        }

        // Also run the library as a fallback
        const freshDevices = await find();
        freshDevices.forEach(d => {
          if (finalResults[d.ip]) {
            const isLocal = Object.values(localNets).some(ifaces => ifaces.some(i => i.address === d.ip));
            if (!isLocal && d.mac && d.mac !== '?' && d.mac !== 'Unknown') {
              finalResults[d.ip].mac = d.mac;
            }
          }
        });
      } catch (arpErr) {
        console.error('Post-scan ARP refresh error:', arpErr);
      }
      
      res.json(Object.values(finalResults));
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

      // Check if this MAC address is linked to any asset in our database
      const existing = db.prepare(`
        SELECT AssetID, IPAddress, MACAddress 
        FROM asset_it_details 
        WHERE LOWER(MACAddress) = ?
      `).get(mac);

      if (existing) {
        // If the IP has changed, update it
        if (existing.IPAddress !== device.ip) {
          console.log(`[NetworkMonitor] Detected IP change for Asset ${existing.AssetID}: ${existing.IPAddress} -> ${device.ip} (MAC: ${mac})`);
          
          db.prepare('UPDATE asset_it_details SET IPAddress = ? WHERE AssetID = ?')
            .run(device.ip, existing.AssetID);
          
          db.prepare('UPDATE assets SET LastUpdated = ? WHERE ID = ?')
            .run(now, existing.AssetID);

          appendAudit({
            Action: 'IP_AUTO_SYNC',
            User: 'SYSTEM',
            AssetId: existing.AssetID,
            Severity: 'INFO',
            Details: `Automatically updated IP from ${existing.IPAddress} to ${device.ip} based on network scan.`
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
app.patch('/api/external/projects/:id', checkApiKey, (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body;
        
        // Build dynamic update query
        const fields = Object.keys(updates).filter(key => 
            ['ProjectName', 'ClientName', 'Status', 'Description', 'StartDate', 'EndDate', 'Location', 'Currency'].includes(key)
        );
        
        if (fields.length === 0) return res.status(400).json({ error: 'No valid fields to update' });

        const setClause = fields.map(field => `${field} = ?`).join(', ');
        const params = fields.map(field => updates[field]);
        params.push(id);

        const stmt = db.prepare(`UPDATE projects SET ${setClause} WHERE ID = ?`);
        const result = stmt.run(...params);

        if (result.changes > 0) {
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
            const assets = db.prepare('SELECT * FROM assets WHERE ProjectID = ?').all(id);
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
// --- Pro OCR Configuration (OCRmyPDF) ---
const OCR_CONFIG = {
    tesseract: 'C:\\Program Files\\Tesseract-OCR',
    ghostscript: 'C:\\Program Files\\gs\\gs10.06.0\\bin',
    ocrmypdf: 'C:\\Users\\Admin\\AppData\\Roaming\\Python\\Python314\\Scripts\\ocrmypdf.exe'
};

// Update PATH for OCR dependencies
const originalPath = process.env.PATH;
process.env.PATH = `${OCR_CONFIG.tesseract};${OCR_CONFIG.ghostscript};${process.env.PATH}`;

async function processFileWithProMode(inputBuffer, originalName) {
    const tempDir = os.tmpdir();
    const ext = path.extname(originalName).toLowerCase() || '.pdf';
    const inputPath = path.join(tempDir, `ocr_in_${Date.now()}${ext}`);
    const outputFilename = `ocr_pro_${Date.now()}.pdf`;
    const outputPath = path.join(uploadsDir, outputFilename);
    const sidecarPath = path.join(tempDir, `ocr_sidecar_${Date.now()}.txt`);

    try {
        fs.writeFileSync(inputPath, inputBuffer);
        
        // OCRmyPDF command for both PDF and Images
        // Note: Removed --clean and --deskew as they require 'unpaper' which might not be installed.
        const cmd = `"${OCR_CONFIG.ocrmypdf}" --force-ocr --sidecar "${sidecarPath}" "${inputPath}" "${outputPath}"`;
        
        console.log(`PRO OCR: Executing ${cmd}`);
        
        return new Promise((resolve, reject) => {
            exec(cmd, async (error, stdout, stderr) => {
                if (error) {
                    console.error('PRO OCR Error:', stderr || error.message);
                    reject(new Error(stderr || error.message));
                    return;
                }

                console.log('PRO OCR Success:', stdout);

                let text = '';
                if (fs.existsSync(sidecarPath)) {
                    text = fs.readFileSync(sidecarPath, 'utf8');
                }

                try {
                    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                    if (fs.existsSync(sidecarPath)) fs.unlinkSync(sidecarPath);
                } catch (e) {
                    console.warn('Cleanup warning:', e.message);
                }

                const blocks = text.split(/\n\s*\n/).filter(b => b.trim()).map(b => ({
                    text: b.trim(),
                    type: detectTable(b) ? 'table' : 'block',
                    selected: true
                }));

                resolve({ 
                    text, 
                    blocks, 
                    isPro: true, 
                    downloadUrl: `/uploads/${outputFilename}` 
                });
            });
        });
    } catch (err) {
        console.error('PRO OCR Setup Error:', err);
        throw err;
    }
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
        let text = '';
        let blocks = [];

        if (mimetype === 'application/pdf' || mimetype.startsWith('image/')) {
            // Enforce Pro Mode (OCRmyPDF) for both PDF and Images
            console.log(`OCR: Processing ${mimetype} using Pro Mode (OCRmyPDF)...`);
            const proResult = await processFileWithProMode(buffer, originalName);
            
            // Save initial blocks to JSON for persistence
            if (proResult.downloadUrl) {
                const outputFilename = proResult.downloadUrl.split('/').pop();
                const jsonPath = path.join(uploadsDir, outputFilename.replace('.pdf', '.json'));
                fs.writeFileSync(jsonPath, JSON.stringify(proResult.blocks, null, 2));
            }

            res.json({ 
                text: proResult.text, 
                blocks: proResult.blocks, 
                isPro: true, 
                downloadUrl: proResult.downloadUrl 
            });
            
            console.log(`OCR: Pro Mode completed for ${originalName}.`);
            return;
        } else if (mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mimetype === 'application/vnd.ms-excel') {
            // Handle Excel files directly
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            blocks = [];
            
            workbook.SheetNames.forEach(sheetName => {
                const sheet = workbook.Sheets[sheetName];
                // Use Tab as separator for Excel to ensure perfect column preservation
                const csv = XLSX.utils.sheet_to_csv(sheet, { FS: '\t' }); 
                if (csv.trim()) {
                    blocks.push({
                        text: `SHEET: ${sheetName}\n${csv}`,
                        type: 'table'
                    });
                }
            });
            text = blocks.map(b => b.text).join('\n\n');
        } else {
            return res.status(400).json({ error: 'Unsupported file type' });
        }

        res.json({ text, blocks });
    } catch (err) {
        console.error('OCR Processing error:', err);
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

const server = app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Server started successfully.');
});

// Set timeout to 10 minutes for long OCR jobs
server.timeout = 600000;
