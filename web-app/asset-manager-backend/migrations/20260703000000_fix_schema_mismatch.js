exports.up = async function(knex) {
  // Check Assets Table
  const hasClientLabel = await knex.schema.hasColumn('assets', 'client_label');
  const hasParentFolder = await knex.schema.hasColumn('assets', 'parent_folder');
  
  if (!hasClientLabel || !hasParentFolder) {
    await knex.schema.table('assets', function(table) {
      if (!hasClientLabel) table.text('client_label');
      if (!hasParentFolder) table.text('parent_folder');
    });
  }

  // Check Components Table
  const hasItemName = await knex.schema.hasColumn('components', 'itemname');
  if (!hasItemName) {
    await knex.schema.table('components', function(table) {
      table.text('itemname');
    });
  }

  // Check Projects Table
  const hasInitials = await knex.schema.hasColumn('projects', 'initials');
  if (!hasInitials) {
    await knex.schema.table('projects', function(table) {
      table.string('initials', 255);
    });
  }
};

exports.down = function(knex) {
  return knex.schema
    .table('assets', function(table) {
      table.dropColumn('client_label');
      table.dropColumn('parent_folder');
    })
    .table('components', function(table) {
      table.dropColumn('itemname');
    })
    .table('projects', function(table) {
      table.dropColumn('initials');
    });
};
