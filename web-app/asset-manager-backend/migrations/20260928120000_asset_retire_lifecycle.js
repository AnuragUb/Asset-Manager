/**
 * Asset Retire lifecycle (PHYSICAL_TALLY_AUTHORITY_ADR §4).
 *
 * - assets.retired_at / retired_by / retire_reason / retire_note
 * - retire_reason ∈ SCRAPPED | LOST | DAMAGED_BEYOND_REPAIR | WRITTEN_OFF
 * - permission asset.retire (superuser + admin)
 *
 * Additive only; existing is_retired / status values are not rewritten.
 */

const RETIRE_REASONS = `('SCRAPPED','LOST','DAMAGED_BEYOND_REPAIR','WRITTEN_OFF')`;
const PERM = { key: 'asset.retire', description: 'Retire asset (scrapped / lost / damaged / written off)', category: 'action' };
const GRANT_ROLES = ['superuser', 'admin'];

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('assets')) {
    const cols = await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'assets' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));

    await knex.schema.alterTable('assets', (table) => {
      if (!have.has('retired_at')) table.timestamp('retired_at', { useTz: true }).nullable();
      if (!have.has('retired_by')) table.string('retired_by', 255).nullable();
      if (!have.has('retire_reason')) table.string('retire_reason', 32).nullable();
      if (!have.has('retire_note')) table.text('retire_note').nullable();
    });

    await knex.raw(`
      DO $$ BEGIN
        ALTER TABLE assets
          ADD CONSTRAINT assets_retire_reason_check
          CHECK (retire_reason IS NULL OR retire_reason IN ${RETIRE_REASONS});
      EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    `);
  }

  if (await knex.schema.hasTable('permissions')) {
    const exists = await knex('permissions').where({ key: PERM.key }).first();
    if (!exists) await knex('permissions').insert(PERM);

    if (await knex.schema.hasTable('role_permissions') && await knex.schema.hasTable('roles')) {
      for (const role of GRANT_ROLES) {
        const roleRow = await knex('roles').where({ name: role }).first();
        if (!roleRow) continue;
        const has = await knex('role_permissions').where({ role_name: role, permission_key: PERM.key }).first();
        if (!has) await knex('role_permissions').insert({ role_name: role, permission_key: PERM.key });
      }
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasTable('role_permissions')) {
    await knex('role_permissions').where({ permission_key: PERM.key }).del();
  }
  if (await knex.schema.hasTable('permissions')) {
    await knex('permissions').where({ key: PERM.key }).del();
  }
  if (await knex.schema.hasTable('assets')) {
    await knex.raw('ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_retire_reason_check');
    const cols = await knex('information_schema.columns')
      .where({ table_schema: 'public', table_name: 'assets' })
      .select('column_name');
    const have = new Set(cols.map((c) => c.column_name));
    await knex.schema.alterTable('assets', (table) => {
      for (const col of ['retire_note', 'retire_reason', 'retired_by', 'retired_at']) {
        if (have.has(col)) table.dropColumn(col);
      }
    });
  }
};
