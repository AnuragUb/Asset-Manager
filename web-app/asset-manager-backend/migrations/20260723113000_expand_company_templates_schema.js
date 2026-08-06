exports.up = async function (knex) {
  const requiredColumns = [
    { name: 'name', type: 'string' },
    { name: 'company_name', type: 'string' },
    { name: 'address', type: 'text' },
    { name: 'gst', type: 'string' },
    { name: 'cin', type: 'string' },
    { name: 'state_name', type: 'string' },
    { name: 'state_code', type: 'string' },
    { name: 'is_default', type: 'integer', defaultTo: 0 },
  ];

  for (const column of requiredColumns) {
    const hasColumn = await knex.schema.hasColumn('company_templates', column.name);
    if (!hasColumn) {
      await knex.schema.alterTable('company_templates', (table) => {
        if (column.type === 'string') table.string(column.name);
        if (column.type === 'text') table.text(column.name);
        if (column.type === 'integer') table.integer(column.name).defaultTo(column.defaultTo ?? 0);
      });
    }
  }
};

exports.down = async function (knex) {
  const removableColumns = [
    'is_default',
    'state_code',
    'state_name',
    'cin',
    'gst',
    'address',
    'company_name',
    'name',
  ];

  for (const columnName of removableColumns) {
    const hasColumn = await knex.schema.hasColumn('company_templates', columnName);
    if (hasColumn) {
      await knex.schema.alterTable('company_templates', (table) => {
        table.dropColumn(columnName);
      });
    }
  }
};
