
exports.up = function(knex) {
  return knex.schema
    .table('assets', function(table) {
      if (!table.client_label) {
        table.text('client_label');
      }
      if (!table.parent_folder) {
        table.text('parent_folder');
      }
    })
    .table('components', function(table) {
      if (!table.itemname) {
        table.text('itemname');
      }
    })
    .table('projects', function(table) {
      if (!table.initials) {
        table.string('initials', 255);
      }
    });
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
