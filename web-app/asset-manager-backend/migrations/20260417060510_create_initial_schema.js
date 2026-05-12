/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function(knex) {
  // 1. Asset Kinds
  await knex.schema.createTable('asset_kinds', (table) => {
    table.string('name').primary();
    table.string('module');
    table.string('icon');
    table.string('parentname');
    table.string('lastupdated');
    table.string('displayimage');
    table.string('identifier');
    table.integer('is_deleted').defaultTo(0);
    table.string('deleted_at');
  });

  // 2. Projects
  await knex.schema.createTable('projects', (table) => {
    table.string('id').primary();
    table.text('projectname').notNullable();
    table.text('clientname');
    table.text('description');
    table.string('status');
    table.string('startdate');
    table.string('enddate');
    table.string('createdby');
    table.string('timestamp');
    table.text('location');
    table.string('currency');
    table.text('owneremail');
    table.text('coordinatoremail');
    table.text('qrcode');
    table.string('type');
    table.text('consigneename');
    table.text('consigneeaddress');
    table.string('consigneegstin');
    table.string('consigneestate');
    table.string('consigneestatecode');
    table.text('buyername');
    table.text('buyeraddress');
    table.string('buyergstin');
    table.string('buyerstate');
    table.string('buyerstatecode');
    table.integer('is_deleted').defaultTo(0);
    table.string('deleted_at');
  });

  // 3. Assets (The core table)
  await knex.schema.createTable('assets', (table) => {
    table.string('id').primary();
    table.string('no');
    table.text('itemname').notNullable();
    table.text('itemdescription');
    table.string('status');
    table.string('make');
    table.string('model');
    table.string('srno');
    table.string('serialno');
    table.string('type');
    table.string('category');
    table.text('icon');
    table.integer('isplaceholder').defaultTo(0);
    table.string('parentid'); 
    table.text('currentlocation');
    table.text('previouslocation');
    table.string('dispatchreceivedt');
    table.text('purchasedetails');
    table.text('remarks');
    table.text('purpose');
    table.string('purchasedate');
    table.string('lastupdated');
    table.text('qrcode');
    table.text('assignedto');
    table.string('macaddress');
    table.string('ipaddress');
    table.string('networktype');
    table.string('physicalport');
    table.string('vlan');
    table.string('socketid');
    table.string('userid');
    table.integer('noqr').defaultTo(0);
    table.string('currency').defaultTo('INR');
    table.float('asset_value').defaultTo(0);
    table.integer('warranty_months').defaultTo(0);
    table.integer('amc_months').defaultTo(0);
    table.string('quantity_parent_id');
    table.string('quantity_root_id');
    table.string('quantity_unit');
    table.float('quantity_total');
    table.float('quantity_available');
    table.integer('quantity_precision');
    table.string('quantity_updated_at');
    table.string('conversion_unit');
    table.float('conversion_factor');
    table.string('conversion_mode');
    table.integer('is_quantity_tracked').defaultTo(0);
    table.integer('warranty_tracking').defaultTo(0);
    table.text('boughtagainstpo');
    table.text('sentagainstdc');
    table.integer('is_batch').defaultTo(0);
    table.integer('linked_po_item_id');
    table.integer('is_deleted').defaultTo(0);
    table.string('deleted_at');
    table.string('department');
  });

  // 4. Asset IT Details
  await knex.schema.createTable('asset_it_details', (table) => {
    table.string('assetid').primary();
    table.string('macaddress');
    table.string('ipaddress');
    table.string('networktype');
    table.string('physicalport');
    table.string('vlan');
    table.string('socketid');
    table.string('userid');
  });

  // 5. Project Assets (Mapping)
  await knex.schema.createTable('project_assets', (table) => {
    table.string('projectid');
    table.string('assetid');
    table.string('assigneddate');
    table.string('type');
    table.primary(['projectid', 'assetid']);
  });

  // 6. Project Orders (PO)
  await knex.schema.createTable('project_orders', (table) => {
    table.string('id').primary();
    table.string('projectid').notNullable();
    table.text('orderno');
    table.string('orderdate');
    table.text('consigneename');
    table.text('consigneeaddress');
    table.string('consigneegstin');
    table.string('consigneestate');
    table.string('consigneestatecode');
    table.text('buyername');
    table.text('buyeraddress');
    table.string('buyergstin');
    table.string('buyerstate');
    table.string('buyerstatecode');
    table.string('createdby');
    table.string('timestamp');
    table.text('ponumber');
    table.string('podate');
    table.text('vendorname');
    table.float('totalamount').defaultTo(0);
    table.string('status').defaultTo('Active');
    table.integer('is_deleted').defaultTo(0);
    table.string('deleted_at');
  });

  // 7. Project Order Items
  await knex.schema.createTable('project_order_items', (table) => {
    table.increments('id').primary();
    table.string('orderid').notNullable();
    table.integer('srno');
    table.text('itemdescription');
    table.string('duedate');
    table.float('qtyordered');
    table.string('uom');
    table.float('unitprice');
    table.float('total');
    table.string('assetid');
    table.string('timestamp');
    table.string('status').defaultTo('Pending');
  });

  // 8. Delivery Challans
  await knex.schema.createTable('delivery_challans', (table) => {
    table.string('id').primary();
    table.text('challanno');
    table.text('customername');
    table.string('deliverydate');
    table.text('assetids');
    table.string('status');
    table.text('qrcode');
    table.text('createdby');
    table.string('timestamp');
    table.text('payloadjson');
  });

  // 9. DC Item Mappings
  await knex.schema.createTable('dc_item_mappings', (table) => {
    table.increments('id').primary();
    table.string('dc_id').notNullable();
    table.string('assetid').notNullable();
    table.text('customname');
    table.text('customdescription');
    table.string('timestamp');
    table.unique(['dc_id', 'assetid']);
  });

  // 10. Users
  await knex.schema.createTable('users', (table) => {
    table.string('username').primary();
    table.text('fullname');
    table.text('password').notNullable();
    table.string('role').defaultTo('user');
    table.string('project_id');
    table.string('client_id');
    table.string('company_id');
    table.string('employee_id');
    table.text('department');
    table.string('created_at');
  });

  // 11. Companies
  await knex.schema.createTable('companies', (table) => {
    table.string('id').primary();
    table.string('name').notNullable();
    table.string('created_at');
  });

  // 12. Audit Log
  await knex.schema.createTable('audit_log', (table) => {
    table.increments('id').primary();
    table.string('action').notNullable();
    table.string('user');
    table.string('assetid');
    table.string('severity');
    table.text('details');
    table.string('timestamp');
  });

  // 13. Quantity Events
  await knex.schema.createTable('quantity_events', (table) => {
    table.increments('id').primary();
    table.string('root_id').notNullable();
    table.string('type').notNullable();
    table.string('actor');
    table.string('timestamp').notNullable();
    table.string('note');
    table.text('metadata_json');
  });

  await knex.schema.createTable('quantity_event_lines', (table) => {
    table.integer('event_id').notNullable().references('id').inTable('quantity_events').onDelete('CASCADE');
    table.string('asset_id').notNullable();
    table.string('unit');
    table.float('delta_available').notNullable().defaultTo(0);
    table.float('delta_total').notNullable().defaultTo(0);
    table.primary(['event_id', 'asset_id']);
  });

  // 14. Roles & Permissions
  await knex.schema.createTable('roles', (table) => {
    table.string('name').primary();
    table.string('description');
  });

  await knex.schema.createTable('permissions', (table) => {
    table.string('key').primary();
    table.string('description');
  });

  await knex.schema.createTable('role_permissions', (table) => {
    table.string('role_name').notNullable().references('name').inTable('roles').onDelete('CASCADE');
    table.string('permission_key').notNullable().references('key').inTable('permissions').onDelete('CASCADE');
    table.primary(['role_name', 'permission_key']);
  });

  // 15. Components
  await knex.schema.createTable('components', (table) => {
    table.string('id').primary();
    table.string('parentid');
    table.string('type');
    table.string('name');
    table.text('description');
  });

  // 16. Employees
  await knex.schema.createTable('employees', (table) => {
    table.string('id').primary();
    table.string('employeeid');
    table.text('name');
    table.string('department');
    table.string('designation');
    table.string('email');
    table.string('phone');
    table.string('status');
    table.string('lastupdated');
  });

  // 17. Department Quotas
  await knex.schema.createTable('department_quotas', (table) => {
    table.string('department');
    table.string('category');
    table.integer('quota');
    table.primary(['department', 'category']);
  });

  // 18. Folders
  await knex.schema.createTable('folders', (table) => {
    table.string('id').primary();
    table.string('name');
    table.string('parentid');
    table.string('icon');
    table.string('module');
    table.string('createdby');
    table.string('timestamp');
  });

  // 19. Company Templates
  await knex.schema.createTable('company_templates', (table) => {
    table.increments('id').primary();
    table.string('company_id');
    table.string('template_type');
    table.text('template_data');
    table.string('created_at');
  });

  // 20. HSN Codes
  await knex.schema.createTable('hsn_codes', (table) => {
    table.string('code').primary();
    table.string('description');
    table.float('gst_rate');
  });

  // 21. Asset Hierarchy
  await knex.schema.createTable('asset_hierarchy', (table) => {
    table.string('id').primary();
    table.string('parentid');
    table.string('assetid');
    table.integer('position');
  });

  // 22. Layouts & Markers
  await knex.schema.createTable('layouts', (table) => {
    table.string('id').primary();
    table.string('name');
    table.string('imageurl');
    table.string('projectid');
  });

  await knex.schema.createTable('layout_markers', (table) => {
    table.string('id').primary();
    table.string('layoutid').references('id').inTable('layouts').onDelete('CASCADE');
    table.string('assetid');
    table.float('x');
    table.float('y');
  });

  // 23. Temporary Assets
  await knex.schema.createTable('temporary_assets', (table) => {
    table.string('id').primary();
    table.string('itemname');
    table.string('make');
    table.string('model');
    table.string('type');
    table.string('category');
    table.string('status');
    table.string('projectid');
    table.integer('ispermanent').defaultTo(0);
    table.float('estimatedprice').defaultTo(0);
    table.string('currency').defaultTo('INR');
    table.integer('linked_po_item_id');
    table.string('timestamp');
    table.integer('is_deleted').defaultTo(0);
    table.string('deleted_at');
  });

  // 24. Project History
  await knex.schema.createTable('project_history', (table) => {
    table.increments('id').primary();
    table.string('projectid').notNullable();
    table.string('action');
    table.string('user');
    table.text('details');
    table.string('timestamp');
  });

  // 25. Temporary Assets (redundant check, already added)
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('project_history');
  await knex.schema.dropTableIfExists('temporary_assets');
  await knex.schema.dropTableIfExists('layout_markers');
  await knex.schema.dropTableIfExists('layouts');
  await knex.schema.dropTableIfExists('asset_hierarchy');
  await knex.schema.dropTableIfExists('hsn_codes');
  await knex.schema.dropTableIfExists('company_templates');
  await knex.schema.dropTableIfExists('folders');
  await knex.schema.dropTableIfExists('department_quotas');
  await knex.schema.dropTableIfExists('employees');
  await knex.schema.dropTableIfExists('components');
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('permissions');
  await knex.schema.dropTableIfExists('roles');
  await knex.schema.dropTableIfExists('quantity_event_lines');
  await knex.schema.dropTableIfExists('quantity_events');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('companies');
  await knex.schema.dropTableIfExists('users');
  await knex.schema.dropTableIfExists('dc_item_mappings');
  await knex.schema.dropTableIfExists('delivery_challans');
  await knex.schema.dropTableIfExists('project_order_items');
  await knex.schema.dropTableIfExists('project_orders');
  await knex.schema.dropTableIfExists('project_assets');
  await knex.schema.dropTableIfExists('asset_it_details');
  await knex.schema.dropTableIfExists('assets');
  await knex.schema.dropTableIfExists('projects');
  await knex.schema.dropTableIfExists('asset_kinds');
};
