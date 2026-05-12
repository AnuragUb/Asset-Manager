const { db } = require('./utils');

// Create company_templates table
try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS company_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            company_name TEXT,
            address TEXT,
            gst TEXT,
            cin TEXT,
            state_name TEXT,
            state_code TEXT,
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log('Created company_templates table');
} catch (err) {
    console.error('Error creating company_templates table:', err);
}
