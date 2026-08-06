exports.up = async function (knex) {
  const requiredColumns = [
    { name: 'itemname', type: 'string' },
    { name: 'make', type: 'string' },
    { name: 'model', type: 'string' },
    { name: 'srno', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'category', type: 'string' },
    { name: 'lastupdated', type: 'string' },
    { name: 'noqr', type: 'integer', defaultTo: 0 },
  ];

  for (const column of requiredColumns) {
    const hasColumn = await knex.schema.hasColumn('components', column.name);
    if (!hasColumn) {
      await knex.schema.alterTable('components', (table) => {
        if (column.type === 'string') table.string(column.name);
        if (column.type === 'integer') table.integer(column.name).defaultTo(column.defaultTo ?? 0);
      });
    }
  }
};

exports.down = async function (knex) {
  const removableColumns = [
    'noqr',
    'lastupdated',
    'category',
    'status',
    'srno',
    'model',
    'make',
    'itemname',
  ];

  for (const columnName of removableColumns) {
    const hasColumn = await knex.schema.hasColumn('components', columnName);
    if (hasColumn) {
      await knex.schema.alterTable('components', (table) => {
        table.dropColumn(columnName);
      });
    }
  }
};
