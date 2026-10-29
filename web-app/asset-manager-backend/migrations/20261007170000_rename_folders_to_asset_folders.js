/**
 * Asset folder register is asset_folders.
 * This database was renamed by hand; the migration records that and renames
 * any environment that still has public.folders.
 * inventory_folders is a different table and is left alone.
 *
 * Apply with named migrate only. Never migrate:latest.
 *
 * @param { import("knex").Knex } knex
 */

exports.up = async function (knex) {
  const hasOld = await knex.schema.hasTable('folders');
  const hasNew = await knex.schema.hasTable('asset_folders');
  if (hasOld && hasNew) {
    throw new Error('STOP: both folders and asset_folders exist');
  }
  if (hasOld) {
    await knex.schema.renameTable('folders', 'asset_folders');
  }
};

exports.down = async function (knex) {
  const hasOld = await knex.schema.hasTable('folders');
  const hasNew = await knex.schema.hasTable('asset_folders');
  if (hasOld && hasNew) {
    throw new Error('STOP: both folders and asset_folders exist');
  }
  if (hasNew) {
    await knex.schema.renameTable('asset_folders', 'folders');
  }
};
