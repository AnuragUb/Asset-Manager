const fs = require('fs');
const path = require('path');
const p = path.join(__dirname, '../server.js');
let t = fs.readFileSync(p, 'utf8');

const pairs = [
  [/requirePermission\('view\.dc'\)/g, "requirePermission('dc.view')"],
  [/requirePermission\('view\.settings'\)/g, "requirePermission('settings.view')"],
  ["app.post('/api/dc', authenticateJWT, requirePermission('dc.view')", "app.post('/api/dc', authenticateJWT, requirePermission('dc.create')"],
  ["app.post('/api/dc/:id/void', authenticateJWT, requirePermission('dc.view')", "app.post('/api/dc/:id/void', authenticateJWT, requirePermission('dc.void')"],
  ["app.post('/api/dc-remarks', authenticateJWT, requirePermission('dc.view')", "app.post('/api/dc-remarks', authenticateJWT, requirePermission('dc.remarks')"],
  ["app.put('/api/dc-remarks/:id', authenticateJWT, requirePermission('dc.view')", "app.put('/api/dc-remarks/:id', authenticateJWT, requirePermission('dc.remarks')"],
  ["app.delete('/api/dc-remarks/:id', authenticateJWT, requirePermission('dc.view')", "app.delete('/api/dc-remarks/:id', authenticateJWT, requirePermission('dc.remarks')"],
  ["app.post('/api/settings/email', authenticateJWT, requirePermission('settings.view')", "app.post('/api/settings/email', authenticateJWT, requirePermission('settings.edit')"],
  ["app.post('/api/settings/email/test', authenticateJWT, requirePermission('settings.view')", "app.post('/api/settings/email/test', authenticateJWT, requirePermission('settings.edit')"],
  ["app.post('/api/settings/email/run-check', authenticateJWT, requirePermission('settings.view')", "app.post('/api/settings/email/run-check', authenticateJWT, requirePermission('settings.edit')"],
  ["app.post('/api/settings/tally', authenticateJWT, requirePermission('settings.view')", "app.post('/api/settings/tally', authenticateJWT, requirePermission('settings.edit')"]
];

for (const pair of pairs) {
  const [a, b] = pair;
  t = typeof a === 'string' ? t.split(a).join(b) : t.replace(a, b);
}
fs.writeFileSync(p, t);
console.log('updated DC/settings permission keys');
