const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

const createOrdersTable = `
CREATE TABLE IF NOT EXISTS project_orders (
    ID TEXT PRIMARY KEY,
    ProjectID TEXT NOT NULL,
    OrderNo TEXT,
    OrderDate TEXT,
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
    CreatedBy TEXT,
    Timestamp TEXT
)
`;

try {
    console.log('Creating project_orders table...');
    db.prepare(createOrdersTable).run();
    console.log('Table created/verified.');
} catch (err) {
    console.error('Error creating table:', err);
}
