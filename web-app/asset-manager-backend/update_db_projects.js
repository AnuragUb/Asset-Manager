const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'database_v2.db');
const db = new Database(dbPath);

console.log('Updating database schema for Projects and Temporary Assets...');

db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
        ID TEXT PRIMARY KEY,
        ProjectName TEXT NOT NULL,
        ClientName TEXT NOT NULL,
        Description TEXT,
        Status TEXT DEFAULT 'Planning',
        StartDate TEXT,
        EndDate TEXT,
        CreatedBy TEXT,
        Timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS temporary_assets (
        ID TEXT PRIMARY KEY,
        ItemName TEXT NOT NULL,
        Type TEXT,
        Category TEXT,
        Make TEXT,
        Model TEXT,
        EstimatedPrice REAL,
        Quantity INTEGER DEFAULT 1,
        ProjectId TEXT,
        Status TEXT DEFAULT 'Temporary',
        IsPermanent INTEGER DEFAULT 0,
        PermanentAssetId TEXT,
        Timestamp TEXT,
        FOREIGN KEY (ProjectId) REFERENCES projects(ID)
    );

    CREATE TABLE IF NOT EXISTS project_assets (
        ProjectID TEXT,
        AssetID TEXT,
        AssignedDate TEXT,
        Type TEXT DEFAULT 'Permanent', -- 'Permanent' or 'Temporary'
        PRIMARY KEY (ProjectID, AssetID),
        FOREIGN KEY (ProjectID) REFERENCES projects(ID)
    );
`);

console.log('Database schema updated successfully.');
db.close();
