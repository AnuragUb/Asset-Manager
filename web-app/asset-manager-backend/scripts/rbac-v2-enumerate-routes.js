/**
 * Enumerate mutation routes and auth posture in server.js
 */
const fs = require('fs');
const path = require('path');

const serverPath = path.join(__dirname, '../server.js');
const t = fs.readFileSync(serverPath, 'utf8');
const lines = t.split(/\n/);

const rows = [];
for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const m = line.match(/app\.(get|post|put|patch|delete)\(\s*['"]([^'"]+)['"]/);
  if (!m) continue;
  const method = m[1].toUpperCase();
  const route = m[2];
  if (!route.startsWith('/api/')) continue;
  const hasAuth = /authenticateJWT/.test(line);
  const hasReq = /requirePermission\s*\(\s*['"]([^'"]+)['"]\s*\)/.test(line);
  const reqMatch = line.match(/requirePermission\s*\(\s*['"]([^'"]+)['"]\s*\)/);
  const hasRoles = /authorizeRoles/.test(line);
  const rolesMatch = line.match(/authorizeRoles\(([^)]*)\)/);
  rows.push({
    line: i + 1,
    method,
    route,
    hasAuth,
    hasReq,
    permission: reqMatch ? reqMatch[1] : '',
    hasRoles,
    roles: rolesMatch ? rolesMatch[1].replace(/'/g, '') : '',
    isMutation: ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  });
}

const mutations = rows.filter((r) => r.isMutation);
const rolesOnly = mutations.filter((r) => r.hasRoles && !r.hasReq);
const authNoPerm = mutations.filter((r) => r.hasAuth && !r.hasReq && !r.hasRoles);
const bare = mutations.filter((r) => !r.hasAuth && !r.hasReq && !r.hasRoles);
const viewProtectedMutations = mutations.filter(
  (r) => r.hasReq && (/^view\.|\.view$/.test(r.permission) || r.permission.endsWith('.view'))
);

console.log(JSON.stringify({
  totalApi: rows.length,
  mutations: mutations.length,
  withRequirePermission: mutations.filter((r) => r.hasReq).length,
  rolesOnly: rolesOnly.length,
  authNoPerm: authNoPerm.length,
  bare: bare.length,
  viewProtectedMutations: viewProtectedMutations.length
}, null, 2));

console.log('\n=== ROLES ONLY (need requirePermission) ===');
rolesOnly.forEach((r) => console.log(`${r.method}\t${r.route}\t${r.roles}`));

console.log('\n=== AUTH NO PERM ===');
authNoPerm.forEach((r) => console.log(`${r.method}\t${r.route}`));

console.log('\n=== BARE (no auth) ===');
bare.forEach((r) => console.log(`${r.method}\t${r.route}`));

console.log('\n=== VIEW-PROTECTED MUTATIONS ===');
viewProtectedMutations.forEach((r) => console.log(`${r.method}\t${r.route}\t${r.permission}`));

// Write machine-readable inventory
const outDir = path.join(__dirname, '../../../docs/rbac-v2');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, 'route_inventory.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), rows, mutations, rolesOnly, authNoPerm, bare }, null, 2)
);
console.log('\nWrote docs/rbac-v2/route_inventory.json');
