exports.up = async function(knex) {
  const hasTable = await knex.schema.hasTable('inventory_items');
  if (!hasTable) return;

  const addColumnIfMissing = async (name, callback) => {
    const exists = await knex.schema.hasColumn('inventory_items', name);
    if (!exists) {
      await knex.schema.alterTable('inventory_items', (table) => {
        callback(table);
      });
    }
  };

  await addColumnIfMissing('dispatchreceivedt', (table) => table.string('dispatchreceivedt'));
  await addColumnIfMissing('purchasedetails', (table) => table.text('purchasedetails'));
  await addColumnIfMissing('purpose', (table) => table.string('purpose'));
  await addColumnIfMissing('purchasedate', (table) => table.string('purchasedate'));
  await addColumnIfMissing('warranty_tracking', (table) => table.integer('warranty_tracking').defaultTo(1));
  await addColumnIfMissing('quantity_unit', (table) => table.string('quantity_unit'));
  await addColumnIfMissing('quantity_note', (table) => table.text('quantity_note'));
  await addColumnIfMissing('conversion_unit', (table) => table.string('conversion_unit'));
  await addColumnIfMissing('conversion_factor', (table) => table.float('conversion_factor').defaultTo(null));
  await addColumnIfMissing('conversion_mode', (table) => table.string('conversion_mode'));
  await addColumnIfMissing('macaddress', (table) => table.string('macaddress'));
  await addColumnIfMissing('ipaddress', (table) => table.string('ipaddress'));
  await addColumnIfMissing('networktype', (table) => table.string('networktype'));
  await addColumnIfMissing('physicalport', (table) => table.string('physicalport'));
  await addColumnIfMissing('vlan', (table) => table.string('vlan'));
  await addColumnIfMissing('socketid', (table) => table.string('socketid'));
  await addColumnIfMissing('userid', (table) => table.string('userid'));
};

exports.down = async function() {
  // Intentionally no-op: preview-only schema expansion on 9090.
};
