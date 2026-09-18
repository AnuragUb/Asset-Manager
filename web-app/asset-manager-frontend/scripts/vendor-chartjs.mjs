/**
 * Copy the Chart.js UMD build into js/vendor so Express can serve it from source.
 * Docker hides frontend node_modules; the browser cannot import from there.
 *
 * Usage (from asset-manager-frontend): npm run vendor:chartjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'node_modules', 'chart.js', 'package.json');
const src = path.join(root, 'node_modules', 'chart.js', 'dist', 'chart.umd.js');
const licenseSrc = path.join(root, 'node_modules', 'chart.js', 'LICENSE.md');
const destDir = path.join(root, 'js', 'vendor');
const dest = path.join(destDir, 'chart.umd.js');
const destLicense = path.join(destDir, 'chart.js.LICENSE.md');

if (!fs.existsSync(src)) {
    console.error('Chart.js is not installed. From web-app/asset-manager-frontend run: npm install');
    process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(src, dest);
if (fs.existsSync(licenseSrc)) fs.copyFileSync(licenseSrc, destLicense);
fs.writeFileSync(path.join(destDir, 'CHARTJS_VERSION.txt'), `${pkg.version}\n`, 'utf8');
console.log(`Vendored Chart.js ${pkg.version} -> js/vendor/chart.umd.js`);
