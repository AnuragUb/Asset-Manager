const { db } = require('./utils');

// Create dc_remark_templates table
try {
    db.prepare(`
        CREATE TABLE IF NOT EXISTS dc_remark_templates (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            terms TEXT,
            is_default INTEGER DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    `).run();
    console.log('Created dc_remark_templates table');
} catch (err) {
    console.error('Error creating dc_remark_templates table:', err);
}
