const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const { db } = require('../utils');
const cache = require('./cacheService');

/**
 * Minimum OAuth scopes for existing AssetEngine Zoho operations.
 * Products ALL covers catalog pull + asset product create/update.
 * Deals READ covers sync-deals.
 * findUser(false) avoids mandatory users/org READ scopes.
 */
const ZOHO_OAUTH_SCOPES = [
    'ZohoCRM.modules.products.ALL',
    'ZohoCRM.modules.deals.READ'
].join(',');

const OAUTH_STATE_TTL_SEC = 600;
const TOKEN_FILE = path.join(__dirname, '../zoho_tokens.txt');
const ACCOUNTS_AUTH_BASE = 'https://accounts.zoho.in/oauth/v2/auth';

/**
 * SDK FileStore CSV columns (see @zohocrm/nodejs-sdk-8.0 FileStore.setToken):
 * id, user_name, client_id, client_secret, refresh_token, access_token,
 * grant_token, expiry_time, redirect_url, api_domain
 */
const FS_COL = {
    ID: 0,
    REFRESH_TOKEN: 4,
    ACCESS_TOKEN: 5,
    GRANT_TOKEN: 6
};

/**
 * Parse Zoho SDK FileStore CSV text for a usable credential.
 * Header-only / empty / blank data rows → null (not authenticated).
 * Does not return secret values to callers beyond presence for builder wiring
 * when used internally — callers must not log the returned strings.
 *
 * @param {string} fileContents
 * @returns {{ id: string|null, refreshToken: string|null, accessToken: string|null }|null}
 */
function parseZohoFileStoreCredentials(fileContents) {
    if (!fileContents || !String(fileContents).trim()) return null;
    const lines = String(fileContents)
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
    if (lines.length < 2) return null; // header only or empty

    // Skip header (first line). Find first data row with refresh or access token.
    for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        if (cols.length < 6) continue;
        const id = (cols[FS_COL.ID] || '').trim() || null;
        const refreshToken = (cols[FS_COL.REFRESH_TOKEN] || '').trim() || null;
        const accessToken = (cols[FS_COL.ACCESS_TOKEN] || '').trim() || null;
        // A usable persisted session needs refresh and/or access (SDK build keys).
        if (refreshToken || accessToken) {
            return { id, refreshToken, accessToken };
        }
    }
    return null;
}

/**
 * Zoho CRM Service
 *
 * Token persistence: FileStore (Option A — lowest risk).
 * DB `oauthtoken` migration exists but SDK DBStore is MySQL-oriented;
 * FileStore remains the active store. File is gitignored and lives on
 * the bind-mounted host tree so restarts keep authorization.
 */
class ZohoService {
    constructor() {
        this.initialized = false;
        /** @type {Promise<any>|null} */
        this._oauthExchangePromise = null;
    }

    _loadEnv() {
        require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
    }

    getTokenFilePath() {
        return TOKEN_FILE;
    }

    /**
     * Read first usable credential from FileStore CSV (no logging of values).
     */
    readPersistedCredential() {
        try {
            if (!fs.existsSync(TOKEN_FILE)) return null;
            const contents = fs.readFileSync(TOKEN_FILE, 'utf8');
            return parseZohoFileStoreCredentials(contents);
        } catch {
            return null;
        }
    }

    /**
     * True only when FileStore contains a real refresh and/or access token row.
     * Header-only / empty / invalid files return false.
     */
    hasPersistedTokens() {
        return this.readPersistedCredential() != null;
    }

    /**
     * Delete token file so OAuth code exchange is not poisoned by stale/header-only store.
     * Does not touch catalog, assets, or DB.
     */
    _clearTokenFileForOAuthExchange() {
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                fs.unlinkSync(TOKEN_FILE);
            }
        } catch (err) {
            console.error('[ZohoService] Failed to clear token file before OAuth exchange:', err.message);
            const e = new Error('TOKEN_FILE_CLEAR_FAILED');
            e.code = 'TOKEN_FILE_CLEAR_FAILED';
            throw e;
        }
    }

    /**
     * Safe config presence (never returns secret values).
     */
    getConfigStatus() {
        this._loadEnv();
        const present = (key) => {
            const v = process.env[key];
            if (v === undefined || v === null) return 'MISSING';
            return String(v).trim() ? 'PRESENT' : 'EMPTY';
        };
        return {
            ZOHO_CLIENT_ID: present('ZOHO_CLIENT_ID'),
            ZOHO_CLIENT_SECRET: present('ZOHO_CLIENT_SECRET'),
            ZOHO_REDIRECT_URL: present('ZOHO_REDIRECT_URL'),
            ZOHO_GRANT_TOKEN: present('ZOHO_GRANT_TOKEN') === 'PRESENT' || present('GRANT_TOKEN') === 'PRESENT'
                ? 'PRESENT'
                : 'MISSING',
            tokenFile: this.hasPersistedTokens() ? 'PRESENT' : 'MISSING',
            dataCenter: 'INDataCenter.PRODUCTION',
            oauthScopes: ZOHO_OAUTH_SCOPES,
            crmOrgIdConfigured: present('ZOHO_CRM_ORG_ID'),
            redirectUrlExpected: 'https://api.spvtm.com/api/zoho/oauth/callback'
        };
    }

    getCrmProductUrl(zohoProductId) {
        this._loadEnv();
        const orgId = String(process.env.ZOHO_CRM_ORG_ID || '60021949576').trim();
        const id = String(zohoProductId || '').trim();
        if (!id) return null;
        return `https://crm.zoho.in/crm/org${orgId}/tab/Products/${id}`;
    }

    getOAuthScopes() {
        return ZOHO_OAUTH_SCOPES;
    }

    async init(options = {}) {
        // Wait out an in-flight OAuth code exchange so health checks do not race FileStore.
        if (this._oauthExchangePromise && !options.authorizationCode) {
            try {
                await this._oauthExchangePromise;
            } catch (_) {
                /* exchange failed; continue into normal init / NOT_AUTHORIZED */
            }
        }

        if (this.initialized && !options.force && !options.authorizationCode) return;

        this._loadEnv();
        console.log('[ZohoService] Loading config from repo-root .env');
        console.log('[ZohoService] Client ID present:', !!process.env.ZOHO_CLIENT_ID);

        const clientId = process.env.ZOHO_CLIENT_ID;
        const clientSecret = process.env.ZOHO_CLIENT_SECRET;
        const redirectURL = process.env.ZOHO_REDIRECT_URL;

        if (!clientId || !clientSecret || !redirectURL) {
            const err = new Error('ZOHO_NOT_CONFIGURED');
            err.code = 'ZOHO_NOT_CONFIGURED';
            throw err;
        }

        try {
            let logger = new ZOHOCRMSDK.LogBuilder()
                .level(ZOHOCRMSDK.Levels.INFO)
                .filePath(path.join(__dirname, '../../sdk_logs.log'))
                .build();

            let tokenstore = new ZOHOCRMSDK.FileStore(TOKEN_FILE);

            let tokenBuilder = new ZOHOCRMSDK.OAuthBuilder()
                .clientId(clientId)
                .clientSecret(clientSecret)
                .redirectURL(redirectURL)
                .findUser(false);

            const authorizationCode = options.authorizationCode
                ? String(options.authorizationCode).trim()
                : '';
            const grantToken = process.env.ZOHO_GRANT_TOKEN || process.env.GRANT_TOKEN;
            const persisted = authorizationCode ? null : this.readPersistedCredential();

            if (authorizationCode) {
                // Server-based OAuth callback: SDK exchanges authorization_code via grantToken.
                console.log('[ZohoService] OAuth authorization code received');
                tokenBuilder.grantToken(authorizationCode);
            } else if (persisted && persisted.refreshToken) {
                console.log('[ZohoService] Persisted Zoho refresh token found');
                tokenBuilder.refreshToken(persisted.refreshToken);
            } else if (persisted && persisted.accessToken) {
                console.log('[ZohoService] Persisted Zoho access token found');
                tokenBuilder.accessToken(persisted.accessToken);
            } else if (persisted && persisted.id) {
                console.log('[ZohoService] Persisted Zoho token id found');
                tokenBuilder.id(persisted.id);
            } else if (grantToken && String(grantToken).trim().length > 50) {
                // Legacy Self Client / grant-token bootstrap (still supported)
                console.log('[ZohoService] Initializing with env grant token bootstrap (value not logged)');
                tokenBuilder.grantToken(String(grantToken).trim());
            } else {
                const err = new Error('ZOHO_NOT_AUTHORIZED');
                err.code = 'ZOHO_NOT_AUTHORIZED';
                throw err;
            }

            let token = tokenBuilder.build();

            let sdkConfig = new ZOHOCRMSDK.SDKConfigBuilder()
                .autoRefreshFields(true)
                .pickListValidation(false)
                .build();

            let resourcePath = path.join(__dirname, '../zoho_resources');
            if (!fs.existsSync(resourcePath)) {
                fs.mkdirSync(resourcePath);
            }

            // Re-init path after OAuth / disconnect
            this.initialized = false;

            let builder = await new ZOHOCRMSDK.InitializeBuilder();
            await builder.environment(ZOHOCRMSDK.INDataCenter.PRODUCTION())
                .token(token)
                .store(tokenstore)
                .SDKConfig(sdkConfig)
                .resourcePath(resourcePath)
                .logger(logger)
                .initialize();

            this.initialized = true;
            if (authorizationCode) {
                console.log('[ZohoService] OAuth token exchange successful');
            } else {
                console.log('[ZohoService] SDK Initialized successfully');
            }
        } catch (error) {
            this.initialized = false;
            if (!error.code) {
                console.error('[ZohoService] Initialization failed:', error.message || error);
            }
            throw error;
        }
    }

    /**
     * Create OAuth state bound to an admin user (CSRF protection).
     */
    async createOAuthState(userId) {
        const state = crypto.randomBytes(32).toString('hex');
        await cache.set(`zoho:oauth:state:${state}`, {
            userId: String(userId),
            createdAt: Date.now()
        }, OAUTH_STATE_TTL_SEC);
        return state;
    }

    /**
     * Validate and consume OAuth state (one-time use).
     */
    async consumeOAuthState(state, expectedUserId = null) {
        if (!state || typeof state !== 'string') {
            return { ok: false, reason: 'MISSING_STATE' };
        }
        const key = `zoho:oauth:state:${state}`;
        const saved = await cache.get(key);
        await cache.del(key);
        if (!saved || !saved.userId) {
            return { ok: false, reason: 'INVALID_OR_EXPIRED_STATE' };
        }
        if (expectedUserId && String(saved.userId) !== String(expectedUserId)) {
            return { ok: false, reason: 'STATE_USER_MISMATCH' };
        }
        return { ok: true, userId: saved.userId };
    }

    /**
     * Build Zoho India accounts authorization URL (server-based app).
     */
    buildAuthorizationUrl(state) {
        this._loadEnv();
        const clientId = process.env.ZOHO_CLIENT_ID;
        const redirectURL = process.env.ZOHO_REDIRECT_URL;
        if (!clientId || !redirectURL) {
            const err = new Error('ZOHO_NOT_CONFIGURED');
            err.code = 'ZOHO_NOT_CONFIGURED';
            throw err;
        }
        const params = new URLSearchParams({
            scope: ZOHO_OAUTH_SCOPES,
            client_id: clientId,
            response_type: 'code',
            access_type: 'offline',
            redirect_uri: redirectURL,
            state: state,
            prompt: 'consent'
        });
        return `${ACCOUNTS_AUTH_BASE}?${params.toString()}`;
    }

    /**
     * Complete server-based OAuth using authorization code from callback.
     * Clears stale/header-only FileStore first so exchange is not poisoned.
     */
    async completeOAuthWithCode(authorizationCode) {
        if (!authorizationCode || !String(authorizationCode).trim()) {
            const err = new Error('MISSING_AUTHORIZATION_CODE');
            err.code = 'MISSING_AUTHORIZATION_CODE';
            throw err;
        }

        const exchange = (async () => {
            this.initialized = false;
            // Do not treat existing FileStore as authorized — start clean for code exchange.
            this._clearTokenFileForOAuthExchange();
            await this.init({
                authorizationCode: String(authorizationCode).trim(),
                force: true
            });
            if (!this.hasPersistedTokens()) {
                const err = new Error('TOKEN_PERSISTENCE_FAILED');
                err.code = 'TOKEN_PERSISTENCE_FAILED';
                throw err;
            }
            return { ok: true, authorized: true };
        })();

        this._oauthExchangePromise = exchange;
        try {
            return await exchange;
        } finally {
            if (this._oauthExchangePromise === exchange) {
                this._oauthExchangePromise = null;
            }
        }
    }

    /**
     * Remove persisted OAuth tokens. Does not touch catalog/assets/projects data.
     */
    async disconnect() {
        this.initialized = false;
        try {
            if (fs.existsSync(TOKEN_FILE)) {
                fs.unlinkSync(TOKEN_FILE);
            }
        } catch (err) {
            console.error('[ZohoService] Disconnect failed to remove token file:', err.message);
            const e = new Error('DISCONNECT_FAILED');
            e.code = 'DISCONNECT_FAILED';
            throw e;
        }
        return { ok: true, authorized: false };
    }

    /**
     * Build an intelligent description string.
     * If it has children -> "KIT INCLUDES" list.
     * If standalone -> Standard specifications.
     */
    async buildAssetDescription(parentId) {
        try {
            // 1. Fetch the Parent Asset
            const parent = await db('assets').where('id', parentId).first();
            if (!parent) throw new Error('Parent asset not found');

            // 2. Fetch all Child Assets
            const children = await db('assets')
                .where('parentid', parentId)
                .where('is_deleted', 0)
                .select('itemname', 'make', 'model', 'serialno', 'srno');

            // 3. Construct the string
            if (children.length > 0) {
                let description = `KIT INCLUDES:\n`;
                description += `----------------\n`;
                children.forEach((child, index) => {
                    const sn = child.serialno || child.srno || 'N/A';
                    const makeModel = (child.make || child.model) ? ` [${child.make} ${child.model}]` : '';
                    description += `${index + 1}. ${child.itemname}${makeModel} (S/N: ${sn})\n`;
                });
                return description;
            } else {
                // Standalone Product Description
                let description = parent.itemdescription || '';
                if (parent.make || parent.model) {
                    description += `\nSpecs: ${parent.make || ''} ${parent.model || ''}`.trim();
                }
                return description || 'Standalone Product';
            }
        } catch (error) {
            console.error('[ZohoService] Failed to build description:', error);
            throw error;
        }
    }

    /**
     * Sync an Asset to Zoho CRM as a Product.
     * Handles both Supersets (Kits) and Standalone Products.
     */
    async syncAssetToZoho(parentId) {
        await this.init();
        let payload = {};
        try {
            // 1. Fetch Parent Data
            const parent = await db('assets').where('id', parentId).first();
            if (!parent) throw new Error('Parent asset not found');

            // 2. Build Intelligent Description
            const description = await this.buildAssetDescription(parentId);

            // 3. Prepare Zoho Record
            const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Products');
            const requestWrapper = new ZOHOCRMSDK.Record.BodyWrapper();
            const record = new ZOHOCRMSDK.Record.Record();

            payload = {
                product_name: parent.itemname,
                description: description,
                unit_price: parseFloat(parent.asset_value || 0),
                make: parent.make,
                model: parent.model
            };

            // Map Literals
            record.addFieldValue(ZOHOCRMSDK.Record.Field.Products.PRODUCT_NAME, parent.itemname);
            record.addFieldValue(ZOHOCRMSDK.Record.Field.Products.DESCRIPTION, description);
            record.addFieldValue(ZOHOCRMSDK.Record.Field.Products.UNIT_PRICE, payload.unit_price);
            
            // Map Custom Specs
            if (parent.make) record.addKeyValue('Make', parent.make);
            if (parent.model) record.addKeyValue('Model', parent.model);

            let response;
            let mode = parent.zoho_product_id ? 'UPDATE' : 'CREATE';

            if (parent.zoho_product_id) {
                record.setId(parent.zoho_product_id);
                requestWrapper.setData([record]);
                response = await recordOperations.updateRecords(requestWrapper);
            } else {
                requestWrapper.setData([record]);
                response = await recordOperations.createRecords(requestWrapper);
            }

            const result = await this.handleSyncResponse(response, parentId, mode.toLowerCase());
            
            await this.logSync({
                module: 'Products',
                operation: `PUSH_ASSET_${mode}`,
                status: 'SUCCESS',
                localId: parentId,
                zohoId: result.zohoId,
                payload: payload,
                response: result
            });

            return result;
        } catch (error) {
            await this.logSync({
                module: 'Products',
                operation: 'PUSH_ASSET',
                status: 'ERROR',
                localId: parentId,
                payload: payload,
                errorMessage: error.message
            });
            throw error;
        }
    }

    /**
     * Internal helper to log all sync activities to the database.
     */
    async logSync(data) {
        try {
            await db('zoho_sync_logs').insert({
                module: data.module,
                operation: data.operation,
                status: data.status,
                local_id: data.localId || null,
                zoho_id: data.zohoId || null,
                payload: data.payload ? JSON.stringify(data.payload) : null,
                response: data.response ? JSON.stringify(data.response) : null,
                error_message: data.errorMessage || null,
                created_at: new Date()
            });
        } catch (err) {
            console.error('[ZohoService] Logging failed:', err.message);
        }
    }

    /**
     * Check the health of the Zoho CRM connection and Token status.
     * Returns structured status codes without secrets.
     */
    async checkConnection() {
        const config = this.getConfigStatus();
        const timestamp = new Date();

        if (config.ZOHO_CLIENT_ID !== 'PRESENT' || config.ZOHO_CLIENT_SECRET !== 'PRESENT' || config.ZOHO_REDIRECT_URL !== 'PRESENT') {
            return {
                status: 'NOT_CONFIGURED',
                message: 'Zoho client credentials or redirect URL are not configured.',
                timestamp,
                authorized: false,
                config
            };
        }

        if (config.tokenFile !== 'PRESENT' && config.ZOHO_GRANT_TOKEN !== 'PRESENT') {
            return {
                status: 'NOT_AUTHORIZED',
                message: 'Zoho is configured but not authorized. Connect via Server-Based OAuth (or temporary grant-token bootstrap).',
                timestamp,
                authorized: false,
                config
            };
        }

        try {
            await this.init();
            const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Products');
            const paramInstance = new ZOHOCRMSDK.ParameterMap();
            paramInstance.add(ZOHOCRMSDK.Record.GetRecordsParam.PER_PAGE, 1);

            const response = await recordOperations.getRecords(paramInstance);

            if (response != null && [200, 201, 204].includes(response.getStatusCode())) {
                return {
                    status: 'CONNECTED',
                    message: 'Authentication successful and API responsive.',
                    timestamp,
                    authorized: true,
                    config
                };
            }
            return {
                status: 'API_ERROR',
                message: `API returned status code: ${response?.getStatusCode()}`,
                timestamp,
                authorized: this.hasPersistedTokens(),
                config
            };
        } catch (error) {
            const msg = error.message || String(error);
            const code = error.code || '';
            console.error('[ZohoService] Health Check Failed:', code || msg);

            if (code === 'ZOHO_NOT_CONFIGURED') {
                return { status: 'NOT_CONFIGURED', message: msg, timestamp, authorized: false, config };
            }
            if (code === 'ZOHO_NOT_AUTHORIZED' || msg.includes('MANDATORY_GRANT_TOKEN') || msg.includes('ZOHO_NOT_AUTHORIZED') || code === 'MANDATORY VALUE ERROR' || msg.includes('MANDATORY VALUE ERROR')) {
                return { status: 'NOT_AUTHORIZED', message: 'Not authorized with Zoho.', timestamp, authorized: false, config };
            }
            if (/refresh|token|oauth|invalid_code|invalid_grant/i.test(msg)) {
                return { status: 'TOKEN_REFRESH_FAILED', message: 'Token refresh or OAuth credential failure.', timestamp, authorized: false, config };
            }
            if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network|unreachable/i.test(msg)) {
                return { status: 'ZOHO_UNREACHABLE', message: 'Unable to reach Zoho CRM APIs.', timestamp, authorized: false, config };
            }
            return {
                status: 'API_ERROR',
                message: 'Zoho API error during health check.',
                timestamp,
                authorized: this.hasPersistedTokens(),
                config
            };
        }
    }

    /**
     * Pull Products from Zoho and sync them to the local Reference Catalog (zoho_catalog).
     * These are kept separate from native inventory as they are non-native.
     */
    async syncProductsFromZoho() {
        await this.init();

        // 1. Rate Limiting / Debouncing (Check cache for recent sync)
        const lastSync = await cache.get('zoho:last_catalog_sync');
        if (lastSync && (Date.now() - lastSync) < 300000) { // 5 minutes cooldown
            console.log('[ZohoService] Catalog sync called too recently. Skipping API call.');
            return { ok: true, syncCount: 0, totalFound: 0, fromCache: true };
        }

        try {
            const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Products');
            const paramInstance = new ZOHOCRMSDK.ParameterMap();
            
            const response = await recordOperations.getRecords(paramInstance);

            if (response != null) {
                const responseObject = response.getObject();
                if (responseObject instanceof ZOHOCRMSDK.Record.ResponseWrapper) {
                    const products = responseObject.getData();
                    let syncCount = 0;

                    for (const product of products) {
                        const zohoId = product.getId();
                        const productName = product.getFieldValue(ZOHOCRMSDK.Record.Field.Products.PRODUCT_NAME);
                        const unitPrice = product.getFieldValue(ZOHOCRMSDK.Record.Field.Products.UNIT_PRICE);
                        const description = product.getFieldValue(ZOHOCRMSDK.Record.Field.Products.DESCRIPTION);
                        const sku = product.getFieldValue(ZOHOCRMSDK.Record.Field.Products.PRODUCT_CODE);
                        const make = product.getKeyValue('Make'); 
                        const model = product.getKeyValue('Model'); 
                        const hsn = product.getKeyValue('HSN_Code'); 

                        const catalogData = {
                            product_name: productName,
                            unit_price: unitPrice || 0,
                            description: description || null,
                            sku: sku || null,
                            make: make || null,
                            model: model || null,
                            hsn_code: hsn || null,
                            last_synced_at: new Date().toISOString()
                        };

                        const existing = await db('zoho_catalog').where('zoho_product_id', zohoId).first();
                        
                        if (existing) {
                            await db('zoho_catalog').where('zoho_product_id', zohoId).update(catalogData);
                        } else {
                            await db('zoho_catalog').insert({
                                ...catalogData,
                                zoho_product_id: zohoId
                            });
                            syncCount++;
                        }
                    }

                    // 2. Set cooldown in Redis
                    await cache.set('zoho:last_catalog_sync', Date.now(), 300); // 5 min TTL

                    await this.logSync({
                        module: 'Products',
                        operation: 'PULL_CATALOG',
                        status: 'SUCCESS',
                        response: { syncCount, totalFound: products.length }
                    });

                    return { ok: true, syncCount, totalFound: products.length };
                }
            }
        } catch (error) {
            await this.logSync({
                module: 'Products',
                operation: 'PULL_CATALOG',
                status: 'ERROR',
                errorMessage: error.message
            });
            throw error;
        }
    }

    /**
     * Fetch recent Deals from Zoho and sync them to local Projects
     */
    async syncDealsFromZoho() {
        await this.init();
        try {
            const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Deals');
            const paramInstance = new ZOHOCRMSDK.ParameterMap();
            
            // Fetch deals modified in the last 7 days (or just get latest 200)
            const response = await recordOperations.getRecords(paramInstance);

            if (response != null) {
                const responseObject = response.getObject();
                if (responseObject instanceof ZOHOCRMSDK.Record.ResponseWrapper) {
                    const deals = responseObject.getData();
                    let syncCount = 0;

                    for (const deal of deals) {
                        const dealId = deal.getId();
                        const dealName = deal.getFieldValue(ZOHOCRMSDK.Record.Field.Deals.DEAL_NAME);
                        const dealType = deal.getFieldValue(ZOHOCRMSDK.Record.Field.Deals.TYPE); // "Project" vs "Box Sale"
                        const projectIdKey = deal.getKeyValue('Project_ID'); // Custom Match Key
                        
                        // Check if project already exists locally
                        let existingProject = await db('projects')
                            .where('zoho_deal_id', dealId)
                            .orWhere('zoho_project_id_key', projectIdKey)
                            .first();

                        const projectData = {
                            projectname: dealName,
                            zoho_deal_id: dealId,
                            zoho_project_id_key: projectIdKey,
                            sale_type: dealType || 'Project',
                            lastupdated: new Date().toISOString()
                        };

                        if (existingProject) {
                            await db('projects').where('id', existingProject.id).update(projectData);
                        } else {
                            // Generate a local ID if missing
                            const localId = projectIdKey || `PROJ-${dealId.substring(dealId.length - 6)}`;
                            await db('projects').insert({
                                ...projectData,
                                id: localId,
                                status: 'Active'
                            });
                            syncCount++;
                        }
                    }
                    return { ok: true, syncCount, totalFound: deals.length };
                }
            }
        } catch (error) {
            console.error('[ZohoService] Failed to sync deals:', error);
            throw error;
        }
    }

    /**
     * Handle the SDK response and update local mapping
     */
    async handleSyncResponse(response, parentId, mode) {
        if (response != null) {
            const responseObject = response.getObject();
            if (responseObject instanceof ZOHOCRMSDK.Record.ActionWrapper) {
                const actionResponses = responseObject.getData();
                const actionResponse = actionResponses[0];

                if (actionResponse instanceof ZOHOCRMSDK.Record.SuccessResponse) {
                    const zohoId = actionResponse.getDetails().get('id');
                    
                    // Update local "Memory"
                    await db('assets').where('id', parentId).update({
                        zoho_product_id: zohoId
                    });

                    console.log(`[ZohoService] Successfully ${mode}d record in Zoho. ID: ${zohoId}`);
                    return { ok: true, zohoId, mode };
                } else if (actionResponse instanceof ZOHOCRMSDK.Record.APIException) {
                    throw new Error(actionResponse.getMessage().getValue());
                }
            }
        }
        throw new Error('Unknown Zoho API Error');
    }

    /**
     * Inspect a module's fields to find API names for mapping
     */
    async inspectModuleFields(moduleName) {
        await this.init();
        try {
            // Attempt 7: Standardize inspection and ensure delay for token persistence
            const FieldsOperations = ZOHOCRMSDK.Fields.FieldsOperations;
            const fieldOperations = new FieldsOperations();
            const paramInstance = new ZOHOCRMSDK.ParameterMap();
            
            const GetFieldsParam = ZOHOCRMSDK.Fields.GetFieldsParam;
            await paramInstance.add(GetFieldsParam.MODULE, moduleName);
            
            const response = await fieldOperations.getFields(paramInstance);

            if (response != null) {
                console.log(`[ZohoService] Inspecting ${moduleName} - Status Code: ${response.getStatusCode()}`);
                let responseObject = response.getObject();
                
                if (responseObject instanceof ZOHOCRMSDK.Fields.ResponseWrapper) {
                    let fields = responseObject.getFields();
                    console.log(`--- Fields for module: ${moduleName} ---`);
                    fields.forEach(field => {
                        console.log(`Label: ${field.getFieldLabel().padEnd(35)} | API Name: ${field.getAPIName()}`);
                    });
                    return fields;
                } else if (responseObject instanceof ZOHOCRMSDK.Fields.APIException) {
                    console.log(`[ZohoService] API Error for ${moduleName}: ${responseObject.getMessage().getValue()}`);
                }
            }
        } catch (error) {
            console.error(`[ZohoService] Field inspection failed for ${moduleName}:`, error);
        }
    }

    /**
     * Test function to fetch a few modules to verify connection
     */
    async testConnection() {
        await this.init();
        try {
            // Attempt 12: Try Modules as a test to see if we can get anything
            const moduleOperations = new ZOHOCRMSDK.Modules.ModulesOperations();
            const response = await moduleOperations.getModules();

            if (response != null) {
                console.log('[ZohoService] Test Connection Response Status Code: ' + response.getStatusCode());
                
                if ([204, 304].includes(response.getStatusCode())) {
                    console.log('[ZohoService] No Content');
                    return [];
                }

                let responseObject = response.getObject();
                if (responseObject instanceof ZOHOCRMSDK.Record.ResponseWrapper || responseObject instanceof ZOHOCRMSDK.Modules.ResponseWrapper) {
                    let items = responseObject.getModules ? responseObject.getModules() : responseObject.getData();
                    console.log(`[ZohoService] Successfully fetched ${items.length} items`);
                    return items;
                } else {
                    console.log('[ZohoService] Unexpected response object type:', responseObject.constructor.name);
                    if (responseObject.getMessage) console.log('[ZohoService] Message:', responseObject.getMessage().getValue());
                }
            }
        } catch (error) {
            console.error('[ZohoService] Test Connection failed:', error);
            throw error;
        }
    }
}

module.exports = new ZohoService();
module.exports.parseZohoFileStoreCredentials = parseZohoFileStoreCredentials;
