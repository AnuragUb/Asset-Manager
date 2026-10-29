/**
 * Emit SQL for Phase 19 role authority reconcile (scratch apply via psql).
 */
const fs = require('fs');
const path = require('path');
const {
  NEW_PERMISSIONS,
  ROLE_ACTION_GRANTS,
  ROLE_REVOKE_KEYS,
  VIEW_ALIASES
} = require('../services/permissionCatalog');

const lines = [];
lines.push('BEGIN;');

for (const row of NEW_PERMISSIONS) {
  const desc = String(row.description).replace(/'/g, "''");
  const cat = String(row.category || '').replace(/'/g, "''");
  lines.push(
    `INSERT INTO permissions (key, description, category) VALUES ('${row.key}', '${desc}', '${cat}') ` +
      `ON CONFLICT (key) DO UPDATE SET description = EXCLUDED.description, category = EXCLUDED.category;`
  );
}

for (const [legacy, canon] of Object.entries(VIEW_ALIASES)) {
  lines.push(
    `INSERT INTO permissions (key, description, category) VALUES ('${legacy}', 'DEPRECATED alias → ${canon}', 'deprecated') ` +
      `ON CONFLICT (key) DO NOTHING;`
  );
}

for (const [role, keys] of Object.entries(ROLE_ACTION_GRANTS)) {
  for (const key of keys) {
    lines.push(
      `INSERT INTO role_permissions (role_name, permission_key) ` +
        `SELECT '${role.replace(/'/g, "''")}', '${key}' WHERE EXISTS (SELECT 1 FROM roles WHERE name='${role.replace(/'/g, "''")}') ` +
        `AND EXISTS (SELECT 1 FROM permissions WHERE key='${key}') ` +
        `ON CONFLICT (role_name, permission_key) DO NOTHING;`
    );
  }
}

lines.push(
  `INSERT INTO role_permissions (role_name, permission_key) VALUES ('superuser','manage.hierarchy') ON CONFLICT DO NOTHING;`
);
lines.push(
  `INSERT INTO role_permissions (role_name, permission_key) VALUES ('admin','manage.hierarchy') ON CONFLICT DO NOTHING;`
);
lines.push(
  `INSERT INTO role_permissions (role_name, permission_key) VALUES ('superuser','category.delete') ON CONFLICT DO NOTHING;`
);

for (const [role, keys] of Object.entries(ROLE_REVOKE_KEYS)) {
  for (const key of keys) {
    lines.push(
      `DELETE FROM role_permissions WHERE role_name='${role.replace(/'/g, "''")}' AND permission_key='${key}';`
    );
  }
}
lines.push(`DELETE FROM role_permissions WHERE role_name='admin' AND permission_key='category.delete';`);

lines.push(
  `INSERT INTO knex_migrations (name, batch) ` +
    `SELECT '20260923140000_rbac_v2_role_authority_model.js', COALESCE((SELECT MAX(batch) FROM knex_migrations),0)+1 ` +
    `WHERE NOT EXISTS (SELECT 1 FROM knex_migrations WHERE name='20260923140000_rbac_v2_role_authority_model.js');`
);

lines.push('COMMIT;');

const out = path.join(__dirname, '../rbac-v2-role-authority.sql');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log('Wrote', out, 'statements', lines.length);
