const Database = require('better-sqlite3');
const db = new Database('c:/Users/Admin/AssetManager/AssetManager_Prod/data/prod/database_v2.db');

try {
  const cols = db.prepare("PRAGMA table_info(assets)").all();
  const hasCol = (name) => cols.some((c) => c.name === name);

  if (!hasCol('BoughtAgainstPO')) {
    db.prepare('ALTER TABLE assets ADD COLUMN BoughtAgainstPO TEXT').run();
    console.log('Added BoughtAgainstPO to Prod');
  }
  if (!hasCol('SentAgainstDC')) {
    db.prepare('ALTER TABLE assets ADD COLUMN SentAgainstDC TEXT').run();
    console.log('Added SentAgainstDC to Prod');
  }
  if (!hasCol('is_batch')) {
    db.prepare('ALTER TABLE assets ADD COLUMN is_batch INTEGER DEFAULT 0').run();
    console.log('Added is_batch to Prod');
  }
  
  console.log('Migration completed successfully for Production DB.');
} catch (err) {
  console.error('Error during manual migration:', err);
}
