const path = require('path');
const fs = require('fs');
const os = require('os');
const IdGenerator = require('./IdGenerator');
const knexConfig = require('./knexfile');

// Helper to get Data Directory from Environment or Default
const getDataDir = () => {
    return process.env.DATA_DIR || path.join(__dirname, '../../data');
};
const dataDir = getDataDir();

// Database connection configuration
const environment = process.env.NODE_ENV || 'development';
const db = require('knex')(knexConfig[environment]);

console.log(`[DB] Knex initialized for environment: ${environment}`);

// File paths (for legacy support or specific data)
// Use DATA_DIR for these JSON files if possible, or fall back to relative
const assetsFile = path.join(dataDir, 'assets.json');
const usersFile = path.join(dataDir, 'users.json');
const auditFile = path.join(dataDir, 'audit_log.json');
const dynamicFile = path.join(dataDir, 'dynamic.json');

// Ensure dynamicFile exists
const dynamicDir = path.dirname(dynamicFile);
if (!fs.existsSync(dynamicDir)) {
    fs.mkdirSync(dynamicDir, { recursive: true });
}
if (!fs.existsSync(dynamicFile)) {
    fs.writeFileSync(dynamicFile, JSON.stringify({}));
}

// JSON Helpers
function readJson(file) {
    try {
        if (!fs.existsSync(file)) return [];
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        return [];
    }
}

function writeJson(file, data) {
    try {
        fs.writeFileSync(file, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('Audit Log Error:', err);
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

/**
 * Normalizes database objects by converting all keys to lowercase.
 * This is crucial for PostgreSQL compatibility when keys are in PascalCase or CamelCase.
 * @param {Object|Array} data - The data object or array to normalize
 * @returns {Object|Array} The normalized data
 */
function normalizeDBData(data) {
    if (!data || typeof data !== 'object') return data;
    if (Array.isArray(data)) return data.map(normalizeDBData);
    
    const normalized = {};
    for (const key of Object.keys(data)) {
        // Skip null values if needed, but for now just lowercase keys
        normalized[key.toLowerCase()] = data[key];
    }
    return normalized;
}

// Global STATIC_IP from .env or detected IP
const STATIC_IP = process.env.STATIC_IP || getLocalIP();

async function appendAudit(entry) {
    try {
        const record = {
            action: entry.Action || 'UNKNOWN',
            user: entry.User || 'System',
            assetid: entry.AssetId || '',
            severity: entry.Severity || 'INFO',
            details: entry.Details || '',
            timestamp: entry.Timestamp || new Date().toISOString()
        };
        await db('audit_log').insert(record);
    } catch (err) {
        console.error('Audit Log Error:', err);
    }
}

function readDynamic() {
    try {
        if (!fs.existsSync(dynamicFile)) return {};
        return JSON.parse(fs.readFileSync(dynamicFile, 'utf8'));
    } catch (err) {
        return {};
    }
}

function writeDynamic(data) {
    try {
        fs.writeFileSync(dynamicFile, JSON.stringify(data, null, 2));
    } catch (err) {
    }
}

// ID Generators
function genCode(prefix) {
    return prefix + '-' + Math.floor(Math.random() * 10000);
}

const typeCode = {
    'Laptop': 'LPT',
    'Desktop': 'DSK',
    'Monitor': 'MON',
    'Printer': 'PRT',
    'Server': 'SRV',
    'Switch': 'SWT',
    'Router': 'RTR',
    'Firewall': 'FWL',
    'Access Point': 'AP',
    'Camera': 'CAM',
    'NVR': 'NVR',
    'Phone': 'PHN',
    'Tablet': 'TBL',
    'Projector': 'PRJ',
    'Scanner': 'SCN',
    'UPS': 'UPS',
    'Rack': 'RCK',
    'Cable': 'CBL',
    'Software': 'SFT',
    'License': 'LIC',
    'Set': 'SET',
    'Accessory': 'ACC',
    'Other': 'OTH'
};

const locCode = {
    'Mumbai': 'MUM',
    'Cineom': 'CNM',
    'Cineom Mumbai': 'CNM',
    'Delhi': 'DEL',
    'Bangalore': 'BLR',
    'Chennai': 'CHN',
    'Hyderabad': 'HYD',
    'Pune': 'PUN',
    'Kolkata': 'KOL',
    'Ahmedabad': 'AMD',
    'Jaipur': 'JAI',
    'Lucknow': 'LKO',
    'Kanpur': 'KNP',
    'Nagpur': 'NGP',
    'Indore': 'IND',
    'Thane': 'THA',
    'Bhopal': 'BHO',
    'Visakhapatnam': 'VIS',
    'Pimpri-Chinchwad': 'PIM',
    'Patna': 'PAT',
    'Vadodara': 'VAD',
    'Ghaziabad': 'GHA',
    'Ludhiana': 'LUD',
    'Agra': 'AGR',
    'Nashik': 'NAS',
    'Faridabad': 'FAR',
    'Meerut': 'MEE',
    'Rajkot': 'RAJ',
    'Kalyan-Dombivli': 'KAL',
    'Vasai-Virar': 'VAS',
    'Varanasi': 'VAR',
    'Srinagar': 'SRI',
    'Aurangabad': 'AUR',
    'Dhanbad': 'DHA',
    'Amritsar': 'AMR',
    'Navi Mumbai': 'NAV',
    'Allahabad': 'ALL',
    'Ranchi': 'RAN',
    'Howrah': 'HOW',
    'Coimbatore': 'COI',
    'Jabalpur': 'JAB',
    'Gwalior': 'GWA',
    'Vijayawada': 'VIJ',
    'Jodhpur': 'JOD',
    'Madurai': 'MAD',
    'Raipur': 'RAI',
    'Kota': 'KOT',
    'Guwahati': 'GUW',
    'Chandigarh': 'CHA',
    'Solapur': 'SOL',
    'Hubli-Dharwad': 'HUB',
    'Bareilly': 'BAR',
    'Moradabad': 'MOR',
    'Mysore': 'MYS',
    'Gurgaon': 'GUR',
    'Aligarh': 'ALI',
    'Jalandhar': 'JAL',
    'Tiruchirappalli': 'TIR',
    'Bhubaneswar': 'BHU',
    'Salem': 'SAL',
    'Mira-Bhayandar': 'MIR',
    'Warangal': 'WAR',
    'Thiruvananthapuram': 'THI',
    'Bhiwandi': 'BHI',
    'Saharanpur': 'SAH',
    'Guntur': 'GUN',
    'Amravati': 'AMR',
    'Bikaner': 'BIK',
    'Noida': 'NOI',
    'Jamshedpur': 'JAM',
    'Bhilai': 'BHL',
    'Cuttack': 'CUT',
    'Firozabad': 'FIR',
    'Kochi': 'KOC',
    'Nellore': 'NEL',
    'Bhavnagar': 'BHA',
    'Dehradun': 'DEH',
    'Durgapur': 'DUR',
    'Asansol': 'ASA',
    'Rourkela': 'ROU',
    'Nanded': 'NAN',
    'Kolhapur': 'KOL',
    'Ajmer': 'AJM',
    'Akola': 'AKO',
    'Gulbarga': 'GUL',
    'Jamnagar': 'JAM',
    'Ujjain': 'UJJ',
    'Loni': 'LON',
    'Siliguri': 'SIL',
    'Jhansi': 'JHA',
    'Ulhasnagar': 'ULH',
    'Jammu': 'JMU',
    'Sangli-Miraj & Kupwad': 'SAN',
    'Mangalore': 'MAN',
    'Erode': 'ERO',
    'Belgaum': 'BEL',
    'Ambattur': 'AMB',
    'Tirunelveli': 'TIR',
    'Malegaon': 'MAL',
    'Gaya': 'GAY',
    'Jalgaon': 'JAL',
    'Udaipur': 'UDA',
    'Maheshtala': 'MAH',
    'Davanagere': 'DAV',
    'Kozhikode': 'KOZ',
    'Kurnool': 'KUR',
    'Rajpur Sonarpur': 'RAJ',
    'Rajahmundry': 'RAJ',
    'Bokaro': 'BOK',
    'South Dumdum': 'SOU',
    'Bellary': 'BEL',
    'Patiala': 'PAT',
    'Gopalpur': 'GOP',
    'Agartala': 'AGA',
    'Bhagalpur': 'BHA',
    'Muzaffarnagar': 'MUZ',
    'Bhatpara': 'BHA',
    'Panihati': 'PAN',
    'Latur': 'LAT',
    'Dhule': 'DHU',
    'Tirupati': 'TIR',
    'Rohtak': 'ROH',
    'Korba': 'KOR',
    'Bhilwara': 'BHI',
    'Berhampur': 'BER',
    'Muzaffarpur': 'MUZ',
    'Ahmednagar': 'AHM',
    'Mathura': 'MAT',
    'Kollam': 'KOL',
    'Avadi': 'AVA',
    'Kadapa': 'KAD',
    'Kamarhati': 'KAM',
    'Sambalpur': 'SAM',
    'Bilaspur': 'BIL',
    'Shahjahanpur': 'SHA',
    'Satara': 'SAT',
    'Bijapur': 'BIJ',
    'Kakinada': 'KAK',
    'Rampur': 'RAM',
    'Shimoga': 'SHI',
    'Chandrapur': 'CHA',
    'Junagadh': 'JUN',
    'Thrissur': 'THR',
    'Alwar': 'ALW',
    'Bardhaman': 'BAR',
    'Kulti': 'KUL',
    'Kakinada': 'KAK',
    'Nizamabad': 'NIZ',
    'Parbhani': 'PAR',
    'Tumkur': 'TUM',
    'Khammam': 'KHA',
    'Ozhukarai': 'OZH',
    'Bihar Sharif': 'BIH',
    'Panipat': 'PAN',
    'Darbhanga': 'DAR',
    'Bally': 'BAL',
    'Aizawl': 'AIZ',
    'Dewas': 'DEW',
    'Ichalkaranji': 'ICH',
    'Karnal': 'KAR',
    'Bathinda': 'BAT',
    'Jalna': 'JAL',
    'Eluru': 'ELU',
    'Kirari Suleman Nagar': 'KIR',
    'Barasat': 'BAR',
    'Purnia': 'PUR',
    'Satna': 'SAT',
    'Mau': 'MAU',
    'Sonipat': 'SON',
    'Farrukhabad': 'FAR',
    'Sagar': 'SAG',
    'Rourkela': 'ROU',
    'Durg': 'DUR',
    'Imphal': 'IMP',
    'Ratlam': 'RAT',
    'Hapur': 'HAP',
    'Arrah': 'ARR',
    'Karimnagar': 'KAR',
    'Anantapur': 'ANA',
    'Etawah': 'ETA',
    'Ambernath': 'AMB',
    'North Dumdum': 'NOR',
    'Bharatpur': 'BHA',
    'Begusarai': 'BEG',
    'New Delhi': 'NEW',
    'Gandhidham': 'GAN',
    'Baranagar': 'BAR',
    'Tiruvottiyur': 'TIR',
    'Pondicherry': 'PON',
    'Sikar': 'SIK',
    'Thoothukudi': 'THO',
    'Rewa': 'REW',
    'Mirzapur': 'MIR',
    'Raichur': 'RAI',
    'Pali': 'PAL',
    'Ramagundam': 'RAM',
    'Haridwar': 'HAR',
    'Vijayanagaram': 'VIJ',
    'Katihar': 'KAT',
    'Nagercoil': 'NAG',
    'Sri Ganganagar': 'SRI',
    'Karawal Nagar': 'KAR',
    'Mango': 'MAN',
    'Thanjavur': 'THA',
    'Bulandshahr': 'BUL',
    'Uluberia': 'ULU',
    'Murwara': 'MUR',
    'Sambhal': 'SAM',
    'Singrauli': 'SIN',
    'Nadiad': 'NAD',
    'Secunderabad': 'SEC',
    'Naihati': 'NAI',
    'Yamunanagar': 'YAM',
    'Bidhan Nagar': 'BID',
    'Pallavaram': 'PAL',
    'Bidar': 'BID',
    'Munger': 'MUN',
    'Panchkula': 'PAN',
    'Burhanpur': 'BUR',
    'Raurkela Industrial Township': 'RAU',
    'Kharagpur': 'KHA',
    'Dindigul': 'DIN',
    'Gandhinagar': 'GAN',
    'Hospet': 'HOS',
    'Nangloi Jat': 'NAN',
    'English Bazar': 'ENG',
    'Ongole': 'ONG',
    'Deoghar': 'DEO',
    'Chapra': 'CHA',
    'Haldia': 'HAL',
    'Khandwa': 'KHA',
    'Nandyal': 'NAN',
    'Chittoor': 'CHI',
    'Morena': 'MOR',
    'Amroha': 'AMR',
    'Anand': 'ANA',
    'Bhind': 'BHI',
    'Bhalswa Jahangir Pur': 'BHA',
    'Madhyamgram': 'MAD',
    'Bhiwani': 'BHI',
    'Navi Mumbai Panvel Raigad': 'NAV',
    'Baharampur': 'BAH',
    'Ambala': 'AMB',
    'Morvi': 'MOR',
    'Fatehpur': 'FAT',
    'Rae Bareli': 'RAE',
    'Khora': 'KHO',
    'Bhusawal': 'BHU',
    'Orai': 'ORA',
    'Bahraich': 'BAH',
    'Vellore': 'VEL',
    'Mahesana': 'MAH',
    'Sambalpur': 'SAM',
    'Raiganj': 'RAI',
    'Sirsa': 'SIR',
    'Danapur': 'DAN',
    'Serampore': 'SER',
    'Sultan Pur Majra': 'SUL',
    'Guna': 'GUN',
    'Jaunpur': 'JAU',
    'Panvel': 'PAN',
    'Shivpuri': 'SHI',
    'Surendranagar Dudhrej': 'SUR',
    'Unnao': 'UNN',
    'Hugli and Chinsurah': 'HUG',
    'Alappuzha': 'ALA',
    'Kottayam': 'KOT',
    'Machilipatnam': 'MAC',
    'Shimla': 'SHI',
    'Adoni': 'ADO',
    'Udupi': 'UDU',
    'Tenali': 'TEN',
    'Proddatur': 'PRO',
    'Saharsa': 'SAH',
    'Hindupur': 'HIN',
    'Sasaram': 'SAS',
    'Hajipur': 'HAJ',
    'Bhimavaram': 'BHI',
    'Dehri': 'DEH',
    'Madanapalle': 'MAD',
    'Siwan': 'SIW',
    'Bettiah': 'BET',
    'Guntakal': 'GUN',
    'Srikakulam': 'SRI',
    'Motihari': 'MOT',
    'Dharmavaram': 'DHA',
    'Gudivada': 'GUD',
    'Phagwara': 'PHA',
    'Narasaraopet': 'NAR',
    'Suryapet': 'SUR',
    'Miryalaguda': 'MIR',
    'Tadipatri': 'TAD',
    'Karaikudi': 'KAR',
    'Kishanganj': 'KIS',
    'Jamalpur': 'JAM',
    'Ballia': 'BAL',
    'Kavali': 'KAV',
    'Tadepalligudem': 'TAD',
    'Amaravati': 'AMA',
    'Buxar': 'BUX',
    'Tezpur': 'TEZ',
    'Jehanabad': 'JEH',
    'Aurangabad': 'AUR',
    'Gangtok': 'GAN',
    'Vasco Da Gama': 'VAS'
};

const purposeCode = {
    'Office': 'OFF',
    'Production': 'PRD',
    'Testing': 'TST',
    'Development': 'DEV',
    'Client': 'CLI',
    'Rental': 'RNT',
    'Spare': 'SPR',
    'Scrap': 'SCR'
};

function dateCode() {
    const d = new Date();
    return d.getFullYear().toString().substr(-2) + (d.getMonth() + 1).toString().padStart(2, '0');
}

function generateModernAssetId(location, type) {
    // Lookup location code, default to 'LOC' if not found (or first 3 chars)
    let loc = locCode[location];
    if (!loc) {
        if (location && location.length >= 3) {
            loc = location.substring(0, 3).toUpperCase().replace(/\s+/g, '');
        } else {
            loc = 'LOC'; // Default fallback
        }
    }

    let typ = typeCode[type];
    if (!typ) {
        if (type && type.length >= 3) {
            typ = type.substring(0, 3).toUpperCase();
        } else {
            typ = 'GEN'; // Default fallback
        }
    }

    return IdGenerator.generateAssetId(typ, loc);
}

// Temporary ID generator for assets not yet synced
function generateTempAssetId() {
    return IdGenerator.generateTempAssetId();
}

// Split Asset ID Generator
function generateSplitAssetId(parentId, index) {
    return IdGenerator.generateSplitAssetId(parentId, index);
}

// Project ID Generator
function generateProjectId(location) {
    const loc = (location || 'LOC').substring(0, 3).toUpperCase();
    return IdGenerator.generateProjectId(loc);
}

// Project QR Payload Generator
function generateProjectQRPayload(project, ip, port) {
    // Return a direct URL to the project view
    return `http://${ip}:${port}/project/${encodeURIComponent(project.ID)}`;
}

// Legacy ID Generator (keeping for compatibility)
function makeIdForAsset(asset) {
    return generateModernAssetId(asset.CurrentLocation, asset.Type);
}

// Tally Integration Helpers
const TALLY_CONFIG = {
    host: 'localhost',
    port: 9000,
    company: 'CINEOM'
};

function getTallyConfig() {
    const dynamic = readDynamic();
    return dynamic.tally_config || TALLY_CONFIG;
}

async function sendTallyRequest(xmlData) {
    const config = getTallyConfig();
    const url = `http://${config.host}:${config.port}`;
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'text/xml' },
            body: xmlData
        });
        return await response.text();
    } catch (error) {
        throw error;
    }
}

function parseTallyXml(xml) {
    // Basic XML parser for Tally response
    // In production, use a proper XML parser library
    const status = xml.match(/<STATUS>(.*?)<\/STATUS>/)?.[1];
    const data = xml.match(/<DATA>(.*?)<\/DATA>/)?.[1];
    return { status, data };
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
    STATIC_IP,
    getDataDir
};
