/**
 * folder_path on assets and inventory_items.
 *
 * The whole place of a holding, root to leaf, in one column:
 *   Cineom Assets / Accessories / URSA / Case
 *
 * Existing type, parent_folder, folderid, and kindid stay.
 * The path is filled from those when the chain can be walked.
 *
 * Apply with (after a pg_dump backup):
 *   npx knex migrate:up 20261006130000_folder_path.js --env production
 * Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function up(knex) {
  if (await knex.schema.hasTable('assets') && !(await knex.schema.hasColumn('assets', 'folder_path'))) {
    await knex.schema.alterTable('assets', (table) => {
      table.text('folder_path').nullable();
    });
  }
  if (await knex.schema.hasTable('inventory_items') && !(await knex.schema.hasColumn('inventory_items', 'folder_path'))) {
    await knex.schema.alterTable('inventory_items', (table) => {
      table.text('folder_path').nullable();
    });
  }

  if (await knex.schema.hasTable('assets') && await knex.schema.hasTable('asset_kinds')) {
    const kinds = await knex('asset_kinds').select('name', 'parentname');
    const parentOf = new Map(kinds.map((kind) => [kind.name, kind.parentname || '']));
    const assets = await knex('assets').select('id', 'type', 'parent_folder').whereNull('folder_path');
    for (const asset of assets) {
      const parts = [];
      const seen = new Set();
      let cursor = String(asset.type || '').trim();
      while (cursor && !seen.has(cursor)) {
        seen.add(cursor);
        parts.unshift(cursor);
        cursor = String(parentOf.get(cursor) || '').trim();
      }
      const root = String(asset.parent_folder || '').trim();
      if (root && parts[0] !== root) parts.unshift(root);
      const path = parts.filter(Boolean).join(' / ');
      if (path) await knex('assets').where({ id: asset.id }).update({ folder_path: path });
    }
  }

  if (await knex.schema.hasTable('inventory_items')) {
    const hasFolders = await knex.schema.hasTable('inventory_folders');
    const hasKinds = await knex.schema.hasTable('inventory_kinds');
    const items = await knex('inventory_items').select('id', 'folderid', 'kindid', 'type').whereNull('folder_path');
    for (const item of items) {
      let folderName = '';
      let kindName = '';
      if (hasFolders && item.folderid) {
        const folder = await knex('inventory_folders').where({ id: item.folderid }).first('name');
        folderName = folder ? folder.name : '';
      }
      if (hasKinds && item.kindid) {
        const kind = await knex('inventory_kinds').where({ id: item.kindid }).first('name');
        kindName = kind ? kind.name : '';
      }
      const parts = [folderName, kindName || item.type].filter(Boolean);
      const path = [...new Set(parts)].join(' / ');
      if (path) await knex('inventory_items').where({ id: item.id }).update({ folder_path: path });
    }
  }
};

exports.down = async function down(knex) {
  if (await knex.schema.hasColumn('assets', 'folder_path')) {
    await knex.schema.alterTable('assets', (table) => table.dropColumn('folder_path'));
  }
  if (await knex.schema.hasColumn('inventory_items', 'folder_path')) {
    await knex.schema.alterTable('inventory_items', (table) => table.dropColumn('folder_path'));
  }
};
