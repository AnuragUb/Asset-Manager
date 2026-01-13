const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Database connection
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

// File paths (for legacy support or specific data)
const assetsFile = path.join(__dirname, '../../assets.json');
const usersFile = path.join(__dirname, '../../users.json');
const auditFile = path.join(__dirname, '../../audit_log.json');
const dynamicFile = path.join(__dirname, 'dynamic.json');

// Ensure dynamicFile exists
if (!fs.existsSync(dynamicFile)) {
    fs.writeFileSync(dynamicFile, JSON.stringify({}));
}

// JSON Helpers
function readJson(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        console.error(`Error reading ${file}:`, err);
        return [];
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(`Error writing ${file}:`, err);
    }
}

// Network Helpers
function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// Audit Logging
function appendAudit({ Action, User, AssetId, Severity, Details }) {
    try {
        const stmt = db.prepare(`
            INSERT INTO audit_log (Action, User, AssetId, Severity, Details, Timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run(Action, User, AssetId, Severity, Details, new Date().toISOString());
        
        // Also append to file for redundancy if needed
        const log = readJson(auditFile);
        log.push({ Action, User, AssetId, Severity, Details, Timestamp: new Date().toISOString() });
        writeJson(auditFile, log.slice(-1000)); // Keep last 1000
    } catch (err) {
        console.error('Audit log error:', err);
    }
}

// Dynamic QR Helpers
function readDynamic() {
    return readJson(dynamicFile);
}

function writeDynamic(data) {
    writeJson(dynamicFile, data);
}

// Asset ID Generation Helpers
function genCode(length = 6) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
}

function typeCode(type) {
    const s = (type || '').toUpperCase().trim();
    return s.length > 0 ? s.substring(0, 1) : 'X';
}

function locCode(location) {
    const m = { 
        "MUMBAI": "MUM", "DELHI": "DEL", "BANGALORE": "BLR", 
        "HYDERABAD": "HYD", "CHENNAI": "CHN", "KOLKATA": "CCU", 
        "PUNE": "PUN", "JAIPUR": "JAI" 
    };
    const s = (location || '').toUpperCase().replace(/[^A-Z]/g, "").trim();
    if (m[s]) return m[s];
    return s.length >= 3 ? s.substring(0, 3) : "LOC";
}

function purposeCode(purpose) {
    const m = { 
        "OFFICE": "OF", "RENTAL": "RE", "STUDIO": "ST", 
        "FIELD": "FD", "MAINTENANCE": "MT", "PRODUCTION": "PR" 
    };
    const s = (purpose || '').toUpperCase().trim();
    if (m[s]) return m[s];
    return s.length >= 2 ? s.substring(0, 2) : "PU";
}

function dateCode(date) {
    const d = date ? new Date(date) : new Date();
    const yy = d.getFullYear().toString().slice(-2);
    const mm = (d.getMonth() + 1).toString().padStart(2, '0');
    const dd = d.getDate().toString().padStart(2, '0');
    return `${yy}${mm}${dd}`;
}

/**
 * Generates a modern Asset ID in the format: (City) - (MMYY) - (Unique Base 32) - (Checksum)
 * Example: MUM-0126-9K7XQ2-Z
 * @param {string} location - The location name to derive city code from
 * @returns {string} The generated Asset ID
 */
function generateModernAssetId(location) {
    const city = locCode(location); // MUM, DEL, etc.
    const now = new Date();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const yy = now.getFullYear().toString().slice(-2);
    const mmyy = `${mm}${yy}`;
    
    // Unique 6-char Base32 (excluding confusing chars: I, O, 0, 1)
    const b32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let unique = '';
    for (let i = 0; i < 6; i++) {
        unique += b32[Math.floor(Math.random() * b32.length)];
    }
    
    const base = `${city}-${mmyy}-${unique}`;
    
    // Simple Checksum (A-Z) calculated from all non-hyphen characters
    let sum = 0;
    const cleanBase = base.replace(/-/g, '');
    for (let i = 0; i < cleanBase.length; i++) {
        sum += cleanBase.charCodeAt(i);
    }
    const checksum = String.fromCharCode(65 + (sum % 26));
    
    return `${base}-${checksum}`;
}

function generateTempAssetId(location) {
    const city = locCode(location);
    const prefix = `${city}T`;
    const now = new Date();
    const mm = (now.getMonth() + 1).toString().padStart(2, '0');
    const yy = now.getFullYear().toString().slice(-2);
    const mmyy = `${mm}${yy}`;
    
    const b32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let unique = '';
    for (let i = 0; i < 6; i++) {
        unique += b32[Math.floor(Math.random() * b32.length)];
    }
    
    const base = `${prefix}-${mmyy}-${unique}`;
    
    // Simple Checksum (A-Z) calculated from all non-hyphen characters
    let sum = 0;
    const cleanBase = base.replace(/-/g, '');
    for (let i = 0; i < cleanBase.length; i++) {
        sum += cleanBase.charCodeAt(i);
    }
    const checksum = String.fromCharCode(65 + (sum % 26));
    
    return `${base}-${checksum}`;
}

function makeIdForAsset(asset, existingIds = []) {
    const tc = typeCode(asset.Type);
    const dc = dateCode(asset.PurchaseDate || new Date());
    const lc = locCode(asset.Location);
    const pc = purposeCode(asset.Purpose);
    const base = `${tc}${dc}${lc}${pc}`;
    
    let id = base;
    let counter = 1;
    while (existingIds.includes(id)) {
        id = `${base}-${counter.toString().padStart(2, '0')}`;
        counter++;
    }
    return id;
}

// Tally Integration
const TALLY_CONFIG = {
    host: 'localhost',
    port: 9000
};

async function sendTallyRequest(xml) {
    const http = require('http');
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: TALLY_CONFIG.host,
            port: TALLY_CONFIG.port,
            method: 'POST',
            headers: {
                'Content-Type': 'text/xml',
                'Content-Length': Buffer.byteLength(xml)
            }
        }, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data));
        });
        req.on('error', reject);
        req.write(xml);
        req.end();
    });
}

function parseTallyXml(xml, tagName) {
    // Simple regex-based XML parser for specific tags
    const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'g');
    const results = [];
    let match;
    while ((match = regex.exec(xml)) !== null) {
        const content = match[1];
        const item = {};
        // Extract nested tags
        const tagRegex = /<([^>]+)>([^<]*)<\/\1>/g;
        let tagMatch;
        while ((tagMatch = tagRegex.exec(content)) !== null) {
            item[tagMatch[1]] = tagMatch[2].trim();
        }
        if (Object.keys(item).length > 0) results.push(item);
    }
    return results;
}

module.exports = {
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
};
