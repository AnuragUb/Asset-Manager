const db = require('./utils').db;
async function run() {
  try {
    const isPostgres = process.env.DB_CLIENT === 'postgresql';
    if (!isPostgres) {
        console.log('Not using postgres');
        return;
    }
    const rows = await db('quantity_events').select('id');
    console.log('Current quantity_events IDs:', rows.map(r => r.id));
    const seqResult = await db.raw("SELECT nextval('quantity_events_id_seq')");
    console.log('Next value from sequence:', seqResult.rows[0].nextval);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await db.destroy();
  }
}
run();
