/**
 * Compare prod-before vs scratch-after effective permissions per active user.
 */
const fs = require('fs');
const path = require('path');

function loadCsv(p) {
  const text = fs.readFileSync(p, 'utf8').trim();
  const lines = text.split(/\r?\n/).slice(1);
  const map = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    // CSV: username,role,permission_key — usernames may contain commas rarely; use last two commas
    const parts = line.split(',');
    if (parts.length < 3) continue;
    const perm = parts[parts.length - 1];
    const role = parts[parts.length - 2];
    const username = parts.slice(0, parts.length - 2).join(',');
    if (!map.has(username)) map.set(username, { role, perms: new Set() });
    map.get(username).perms.add(perm);
  }
  return map;
}

const root = path.join(__dirname, '../../../docs/rbac-v2');
const before = loadCsv(path.join(root, 'before_effective_user_permissions.csv'));
const after = loadCsv(path.join(root, 'after_effective_user_permissions_scratch.csv'));

const lines = [];
lines.push('# Effective Access Comparison (Phase 25)');
lines.push('');
lines.push('BEFORE = production `asset_manager` role_permissions (pre V2 action expansion).');
lines.push('AFTER = scratch `asset_manager_rbac_scratch` after Phase 19 role authority migration.');
lines.push('');
lines.push('Note: AFTER includes new action keys; many “gains” are precision grants replacing implicit authorizeRoles triad, not net-new business capability — except Logistics Executive (no active user today).');
lines.push('');

const users = [...new Set([...before.keys(), ...after.keys()])].sort();
for (const u of users) {
  const b = before.get(u) || { role: '?', perms: new Set() };
  const a = after.get(u) || { role: '?', perms: new Set() };
  const gained = [...a.perms].filter((p) => !b.perms.has(p)).sort();
  const lost = [...b.perms].filter((p) => !a.perms.has(p)).sort();
  lines.push(`## ${u} (${b.role} → ${a.role})`);
  lines.push('');
  lines.push(`- Before count: ${b.perms.size}`);
  lines.push(`- After count: ${a.perms.size}`);
  lines.push(`- Gained: ${gained.length}`);
  lines.push(`- Lost: ${lost.length}`);
  lines.push('');
  if (gained.length) {
    lines.push('### Gained');
    lines.push('');
    gained.forEach((p) => lines.push(`- \`${p}\``));
    lines.push('');
  }
  if (lost.length) {
    lines.push('### Lost');
    lines.push('');
    lost.forEach((p) => lines.push(`- \`${p}\``));
    lines.push('');
  }
  if (!gained.length && !lost.length) {
    lines.push('_No set difference (unexpected if V2 actions added)._');
    lines.push('');
  }
}

const out = path.join(root, 'EFFECTIVE_ACCESS_COMPARISON.md');
fs.writeFileSync(out, lines.join('\n') + '\n');
console.log('Wrote', out);
for (const u of users) {
  const b = before.get(u) || { perms: new Set() };
  const a = after.get(u) || { perms: new Set() };
  console.log(u, 'before', b.perms.size, 'after', a.perms.size, 'gained', [...a.perms].filter((p) => !b.perms.has(p)).length, 'lost', [...b.perms].filter((p) => !a.perms.has(p)).length);
}
