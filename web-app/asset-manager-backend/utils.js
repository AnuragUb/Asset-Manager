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

// Database connection configuration.
// Live tables live in their logical schema. The app pool search_path lists
// those schemas before public, and query-builder table names are qualified
// the same way. public keeps the Knex ledger, retired asset snapshots,
// and the few tables that were never given a logical schema.
const environment = process.env.NODE_ENV || 'development';
const LOGICAL_SEARCH_PATH = [
    'assets',
    'delivery_challans',
    'inventory',
    'purchase_books',
    'purchase_orders',
    'receipt_note',
    'sets',
    'utility',
    'public'
].join(', ');

function schemaMap(schema, tables) {
    return Object.fromEntries(tables.map((table) => [table, schema]));
}

const TABLE_SCHEMA = Object.assign(
    {},
    schemaMap('assets', [
        'assets', 'asset_folders', 'asset_history', 'asset_it_details', 'asset_hierarchy',
        'asset_kinds', 'components'
    ]),
    schemaMap('delivery_challans', [
        'delivery_challans', 'delivery_challan_version', 'dc_disposition_line',
        'dc_item_mappings', 'dc_dispatch_outbox', 'dc_return_inward_outbox', 'dc_dispatch_reason'
    ]),
    schemaMap('inventory', [
        'inventory_items', 'inventory_folders', 'inventory_kinds', 'inventory_components'
    ]),
    schemaMap('purchase_books', [
        'purchase_book', 'purchase_book_line', 'purchase_book_physical', 'purchase_book_dc_consumption'
    ]),
    schemaMap('purchase_orders', [
        'procurement_po', 'procurement_po_line', 'procurement_po_external_ref'
    ]),
    schemaMap('receipt_note', [
        'receipt_note', 'receipt_note_line', 'receipt_idempotency',
        'receipt_physical_output', 'receipt_projection_outbox'
    ]),
    schemaMap('sets', [
        'managed_sets', 'managed_set_components', 'set_requirement', 'set_idempotency',
        'sets', 'set_components'
    ]),
    schemaMap('utility', [
        'arri_clients', 'arri_job_cards', 'audit_log', 'auth_tokens', 'clients',
        'commercial_provenance', 'companies', 'company_templates', 'conversion',
        'conversion_event', 'conversion_line', 'dc_return_log', 'dc_return_log_line',
        'deal_projects', 'delivery_challan_event', 'department_quotas', 'domain_events',
        'employees', 'holding_hsn_history', 'hsn_codes', 'inventory_quantity_event_lines', 'inventory_quantity_events',
        'password_resets', 'permissions', 'physical_intake', 'physical_intake_event',
        'physical_intake_idempotency', 'physical_intake_output', 'physical_marking',
        'procurement_reconciliation', 'procurement_reconciliation_event', 'procurement_sync_event',
        'product', 'product_external_ref', 'product_name_conflict', 'project_assets',
        'project_history', 'project_order_items', 'project_orders', 'projects',
        'purchase_book_event', 'quantity_event_lines', 'quantity_events', 'quotes', 'receipt_event',
        'reservation', 'reservation_event', 'role_permissions', 'roles', 'serial_identity',
        'set_event', 'temporary_assets', 'users', 'vendor_invoice', 'vendor_return',
        'vendor_return_line', 'vendor_return_outbox', 'zoho_account', 'zoho_catalog',
        'zoho_deal_projects', 'zoho_invoices', 'zoho_purchase_orders', 'zoho_sync_logs',
        'zoho_vendors'
    ])
);

function tableToken(arg) {
    if (typeof arg !== 'string') return null;
    const token = arg.trim().split(/\s+/)[0].replace(/"/g, '');
    if (token.includes('.')) return null;
    return TABLE_SCHEMA[token] ? token : null;
}

function qualifyTableRef(arg) {
    const token = tableToken(arg);
    if (!token) return arg;
    return arg.replace(token, `${TABLE_SCHEMA[token]}.${token}`);
}

function splitQualifiedTable(raw) {
    if (typeof raw !== 'string') return null;
    const token = raw.trim().split(/\s+/)[0].replace(/"/g, '');
    const dot = token.indexOf('.');
    if (dot > 0) {
        return { schema: token.slice(0, dot), table: token.slice(dot + 1) };
    }
    if (TABLE_SCHEMA[token]) return { schema: TABLE_SCHEMA[token], table: token };
    return null;
}

const BUILDER_TABLE_METHODS = new Set([
    'from', 'into', 'table',
    'join', 'innerJoin', 'leftJoin', 'leftOuterJoin',
    'rightJoin', 'rightOuterJoin', 'fullOuterJoin', 'crossJoin'
]);

function isQueryBuilder(value) {
    return Boolean(value && typeof value === 'object' && typeof value.from === 'function' && typeof value.where === 'function');
}

function wrapBuilder(builder) {
    if (!isQueryBuilder(builder) || builder.__assetSchemaWrapped) return builder;
    const proxy = new Proxy(builder, {
        get(target, prop, receiver) {
            if (prop === '__assetSchemaWrapped') return true;
            const value = Reflect.get(target, prop, receiver);
            if (prop === 'columnInfo' && typeof value === 'function') {
                return (...args) => {
                    const qualified = splitQualifiedTable(target._single && target._single.table);
                    if (qualified) {
                        target._single.table = qualified.table;
                        target._single.schema = qualified.schema;
                    }
                    return value.call(target, ...args);
                };
            }
            if (typeof value !== 'function' || !BUILDER_TABLE_METHODS.has(prop)) {
                return typeof value === 'function' ? value.bind(target) : value;
            }
            return (...args) => {
                if (typeof args[0] === 'string') args[0] = qualifyTableRef(args[0]);
                const result = value.apply(target, args);
                return result === target ? proxy : result;
            };
        }
    });
    return proxy;
}

function routeKnex(knex) {
    return new Proxy(knex, {
        apply(target, _thisArg, args) {
            const built = tableToken(args[0])
                ? target.from(qualifyTableRef(args[0]))
                : target.apply(target, args);
            return isQueryBuilder(built) ? wrapBuilder(built) : built;
        },
        get(target, prop, receiver) {
            if (prop === 'transaction') {
                return function transaction(...args) {
                    const fnIndex = args.findIndex((arg) => typeof arg === 'function');
                    if (fnIndex >= 0) {
                        const userFn = args[fnIndex];
                        args[fnIndex] = (trx) => userFn(routeKnex(trx));
                        return target.transaction.apply(target, args);
                    }
                    return Promise.resolve(target.transaction.apply(target, args)).then((trx) => {
                        return trx && typeof trx === 'function' ? routeKnex(trx) : trx;
                    });
                };
            }
            if (prop === 'schema') {
                const schema = target.schema;
                return new Proxy(schema, {
                    get(schemaTarget, schemaProp) {
                        if (schemaProp === 'hasTable') {
                            return (name) => {
                                const token = tableToken(name);
                                return token
                                    ? target.schema.withSchema(TABLE_SCHEMA[token]).hasTable(token)
                                    : schemaTarget.hasTable(name);
                            };
                        }
                        if (schemaProp === 'hasColumn') {
                            return (name, column) => {
                                const token = tableToken(name);
                                return token
                                    ? target.schema.withSchema(TABLE_SCHEMA[token]).hasColumn(token, column)
                                    : schemaTarget.hasColumn(name, column);
                            };
                        }
                        if (schemaProp === 'table' || schemaProp === 'alterTable' || schemaProp === 'createTable'
                            || schemaProp === 'dropTable' || schemaProp === 'dropTableIfExists') {
                            return (name, ...rest) => {
                                const token = tableToken(name);
                                const builder = token
                                    ? schemaTarget.withSchema(TABLE_SCHEMA[token])
                                    : schemaTarget;
                                return builder[schemaProp](token || name, ...rest);
                            };
                        }
                        const value = Reflect.get(schemaTarget, schemaProp);
                        return typeof value === 'function' ? value.bind(schemaTarget) : value;
                    }
                });
            }
            const value = Reflect.get(target, prop, receiver);
            if (typeof value !== 'function') return value;
            return (...args) => {
                const result = value.apply(target, args);
                return isQueryBuilder(result) ? wrapBuilder(result) : result;
            };
        }
    });
}

const appConfig = {
    ...knexConfig[environment],
    pool: {
        ...(knexConfig[environment].pool || {}),
        afterCreate(conn, done) {
            conn.query(`SET search_path TO ${LOGICAL_SEARCH_PATH}`, (err) => done(err, conn));
        }
    }
};
const db = routeKnex(require('knex')(appConfig));

// Service Database configuration
const serviceConfig = { ...knexConfig[environment] };
if (serviceConfig.connection) {
    serviceConfig.connection = { ...serviceConfig.connection };
    serviceConfig.connection.database = process.env.DB_SERVICE_NAME || (environment === 'test' ? 'asset_manager_service_test' : 'asset_manager_service');
}
const dbService = require('knex')(serviceConfig);

console.log(`[DB] Knex initialized for environment: ${environment}`);
console.log(`[DB] Service DB initialized: ${serviceConfig.connection.database}`);

/**
 * Returns the appropriate database connection based on the category/module.
 * @param {string} category - The module category (e.g., 'IT', 'In-House')
 * @returns {Object} Knex database instance
 */
function getDbForCategory(category) {
    if (category === 'In-House' || category === 'SERVICE') {
        return dbService;
    }
    return db;
}

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

/**
 * Fallback segment code for names not in the lookup maps: first 3 letters/digits only,
 * so free-text like "M/S Cineom" or "4K Cam / Rig" can't put "/" or spaces into an ID.
 */
function fallbackIdCode(raw, defaultCode) {
    const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 3);
    return code.length >= 2 ? code : defaultCode;
}

function generateModernAssetId(location, type) {
    const loc = locCode[location] || fallbackIdCode(location, 'LOC');
    const typ = typeCode[type] || fallbackIdCode(type, 'GEN');
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

function generateProductId(now) {
    return IdGenerator.generateProductId(now);
}

function verifyProductId(id) {
    return IdGenerator.verifyProductId(id);
}

function generateReservationId(now) {
    return IdGenerator.generateReservationId(now);
}

function verifyReservationId(id) {
    return IdGenerator.verifyReservationId(id);
}

function generateConversionId(now) {
    return IdGenerator.generateConversionId(now);
}

function verifyConversionId(id) {
    return IdGenerator.verifyConversionId(id);
}

function generateSetId(now) {
    return IdGenerator.generateSetId(now);
}

function verifySetId(id) {
    return IdGenerator.verifySetId(id);
}

function generateRequirementId(now) {
    return IdGenerator.generateRequirementId(now);
}

function verifyRequirementId(id) {
    return IdGenerator.verifyRequirementId(id);
}

function generateAllocationId(now) {
    return IdGenerator.generateAllocationId(now);
}

function verifyAllocationId(id) {
    return IdGenerator.verifyAllocationId(id);
}

function generateReceiptNoteId(now) {
    return IdGenerator.generateReceiptNoteId(now);
}

function verifyReceiptNoteId(id) {
    return IdGenerator.verifyReceiptNoteId(id);
}

function generateReceiptLineId(now) {
    return IdGenerator.generateReceiptLineId(now);
}

function verifyReceiptLineId(id) {
    return IdGenerator.verifyReceiptLineId(id);
}

function generateReturnLogId(now) {
    return IdGenerator.generateReturnLogId(now);
}

function verifyReturnLogId(id) {
    return IdGenerator.verifyReturnLogId(id);
}

function generateProcurementReconciliationId(now) {
    return IdGenerator.generateProcurementReconciliationId(now);
}

function verifyProcurementReconciliationId(id) {
    return IdGenerator.verifyProcurementReconciliationId(id);
}

function generateVendorReturnId(now) {
    return IdGenerator.generateVendorReturnId(now);
}

function verifyVendorReturnId(id) {
    return IdGenerator.verifyVendorReturnId(id);
}

function generateVendorReturnLineId(now) {
    return IdGenerator.generateVendorReturnLineId(now);
}

function verifyVendorReturnLineId(id) {
    return IdGenerator.verifyVendorReturnLineId(id);
}

function generateProcurementPoId(now) {
    return IdGenerator.generateProcurementPoId(now);
}

function verifyProcurementPoId(id) {
    return IdGenerator.verifyProcurementPoId(id);
}

function generateProcurementPoLineId(now) {
    return IdGenerator.generateProcurementPoLineId(now);
}

function verifyProcurementPoLineId(id) {
    return IdGenerator.verifyProcurementPoLineId(id);
}

function generateProcurementSyncEventId(now) {
    return IdGenerator.generateProcurementSyncEventId(now);
}

function verifyProcurementSyncEventId(id) {
    return IdGenerator.verifyProcurementSyncEventId(id);
}

function generatePhysicalIntakeId(now) {
    return IdGenerator.generatePhysicalIntakeId(now);
}

function verifyPhysicalIntakeId(id) {
    return IdGenerator.verifyPhysicalIntakeId(id);
}

function generatePurchaseBookId(now) {
    return IdGenerator.generatePurchaseBookId(now);
}

function generateVendorInvoiceId(now) {
    return IdGenerator.generateVendorInvoiceId(now);
}

function verifyVendorInvoiceId(id) {
    return IdGenerator.verifyVendorInvoiceId(id);
}

function verifyPurchaseBookId(id) {
    return IdGenerator.verifyPurchaseBookId(id);
}

function generatePurchaseBookLineId(now) {
    return IdGenerator.generatePurchaseBookLineId(now);
}

function verifyPurchaseBookLineId(id) {
    return IdGenerator.verifyPurchaseBookLineId(id);
}

function generatePurchaseBookDcConsumptionId(now) {
    return IdGenerator.generatePurchaseBookDcConsumptionId(now);
}

function verifyPurchaseBookDcConsumptionId(id) {
    return IdGenerator.verifyPurchaseBookDcConsumptionId(id);
}

function generateSerialIdentityId(now) {
    return IdGenerator.generateSerialIdentityId(now);
}

function verifySerialIdentityId(id) {
    return IdGenerator.verifySerialIdentityId(id);
}

function computeProductChecksum(payload) {
    return IdGenerator.computeProductChecksum(payload);
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
    generateProductId,
    verifyProductId,
    generateReservationId,
    verifyReservationId,
    generateConversionId,
    verifyConversionId,
    generateSetId,
    verifySetId,
    generateRequirementId,
    verifyRequirementId,
    generateAllocationId,
    verifyAllocationId,
    generateReceiptNoteId,
    verifyReceiptNoteId,
    generateReceiptLineId,
    verifyReceiptLineId,
    generateReturnLogId,
    verifyReturnLogId,
    generateProcurementReconciliationId,
    verifyProcurementReconciliationId,
    generateVendorReturnId,
    verifyVendorReturnId,
    generateVendorReturnLineId,
    verifyVendorReturnLineId,
    generateProcurementPoId,
    verifyProcurementPoId,
    generateProcurementPoLineId,
    verifyProcurementPoLineId,
    generateProcurementSyncEventId,
    verifyProcurementSyncEventId,
    generatePhysicalIntakeId,
    verifyPhysicalIntakeId,
    generatePurchaseBookId,
    verifyPurchaseBookId,
    generateVendorInvoiceId,
    verifyVendorInvoiceId,
    generatePurchaseBookLineId,
    verifyPurchaseBookLineId,
    generatePurchaseBookDcConsumptionId,
    verifyPurchaseBookDcConsumptionId,
    generateSerialIdentityId,
    verifySerialIdentityId,
    computeProductChecksum,
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
    getDbForCategory,
    dbService,
    STATIC_IP,
    getDataDir
};
