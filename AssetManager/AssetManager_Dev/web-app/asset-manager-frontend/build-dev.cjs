const JavaScriptObfuscator = require('javascript-obfuscator');
const CleanCSS = require('clean-css');
const htmlMinifier = require('html-minifier-terser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Paths
const jsSrcDir = path.join(__dirname, 'js');
const jsDistDir = path.join(__dirname, 'dist/js');
const staticSrcDir = path.join(__dirname, 'static');
const staticDistDir = path.join(__dirname, 'dist/static');
const rootDir = __dirname;
const rootDistDir = path.join(__dirname, 'dist');

// Ensure directories exist
[jsDistDir, staticDistDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// CSS Minifier
const cssMinifier = new CleanCSS({
    level: 2, // Advanced optimizations
    compatibility: '*'
});

// HTML Minifier Options
const htmlOptions = {
    collapseWhitespace: true,
    removeComments: true,
    removeRedundantAttributes: true,
    useShortDoctype: true,
    removeEmptyAttributes: true,
    removeStyleLinkTypeAttributes: true,
    keepClosingSlash: true,
    minifyJS: true,
    minifyCSS: true,
    minifyURLs: true
};

// Obfuscation Options (JS)
const jsOptions = {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.75,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 0.4,
    debugProtection: true,
    debugProtectionInterval: 4000,
    disableConsoleOutput: false,
    identifierNamesGenerator: 'hexadecimal',
    log: false,
    numbersToExpressions: true,
    renameGlobals: false,
    selfDefending: true,
    simplify: true,
    splitStrings: true,
    splitStringsChunkLength: 10,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayCallsTransformThreshold: 0.75,
    stringArrayEncoding: ['base64'],
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false
};

async function build() {
    console.log('[Build] Starting Professional Obfuscation & Minification...');
    console.log('[Build] Working Directory:', process.cwd());
    
    // 1. JS Obfuscation
    const jsFiles = fs.readdirSync(jsSrcDir).filter(f => f.endsWith('.js'));
    for (const file of jsFiles) {
        console.log(`[Build] Scrambling JS: ${file}...`);
        const code = fs.readFileSync(path.join(jsSrcDir, file), 'utf8');
        const result = JavaScriptObfuscator.obfuscate(code, jsOptions);
        fs.writeFileSync(path.join(jsDistDir, file), result.getObfuscatedCode());
    }

    // 2. CSS & JS Minification in Static folder
    if (fs.existsSync(staticSrcDir)) {
        const staticFiles = fs.readdirSync(staticSrcDir);
        
        for (const file of staticFiles) {
            const filePath = path.join(staticSrcDir, file);
            const distPath = path.join(staticDistDir, file);
            
            if (file.endsWith('.css')) {
                console.log(`[Build] Minifying CSS: ${file}...`);
                const code = fs.readFileSync(filePath, 'utf8');
                const minified = cssMinifier.minify(code);
                fs.writeFileSync(distPath, minified.styles);
            } else if (file.endsWith('.js')) {
                console.log(`[Build] Scrambling Static JS: ${file}...`);
                const code = fs.readFileSync(filePath, 'utf8');
                const result = JavaScriptObfuscator.obfuscate(code, jsOptions);
                fs.writeFileSync(distPath, result.getObfuscatedCode());
            }
        }
    }

    // 3. HTML Minification
    const htmlFiles = fs.readdirSync(rootDir).filter(f => f.endsWith('.html'));
    for (const file of htmlFiles) {
        console.log(`[Build] Minifying HTML: ${file}...`);
        const code = fs.readFileSync(path.join(rootDir, file), 'utf8');
        const minified = await htmlMinifier.minify(code, htmlOptions);
        fs.writeFileSync(path.join(rootDistDir, file), minified);
    }
    
    console.log('[Build] Success! All frontend files are now protected and minified.');
}

build().catch(err => {
    console.error('[Build] Failed:', err);
    process.exit(1);
});
