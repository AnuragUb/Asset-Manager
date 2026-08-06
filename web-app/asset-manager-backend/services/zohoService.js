const path = require('path');
const ZOHOCRMSDK = require('@zohocrm/nodejs-sdk-8.0');
const { db } = require('../utils');
const cache = require('./cacheService');

/**
 * Zoho CRM Service
 */
class ZohoService {
    constructor() {
        this.initialized = false;
    }

    async init() {
        if (this.initialized) return;

        // Manually load .env since this might be run as a standalone script
        require('dotenv').config({ path: path.join(__dirname, '../../../.env') });
        console.log('[ZohoService] Loading config from:', path.join(__dirname, '../../../.env'));
        console.log('[ZohoService] Client ID present:', !!process.env.ZOHO_CLIENT_ID);

        try {
            /*
             * Create an instance of Logger Class that takes two parameters
             * level -> Level of the log messages to be logged. Can be configured by typing Levels "." and choosing any level from the list displayed.
             * filePath -> Absolute file path to store logs.
             */
            let logger = new ZOHOCRMSDK.LogBuilder()
                .level(ZOHOCRMSDK.Levels.INFO)
                .filePath(path.join(__dirname, '../../sdk_logs.log'))
                .build();

            /*
             * Create an instance of TokenStore
             */
            let tokenstore = new ZOHOCRMSDK.FileStore(path.join(__dirname, '../zoho_tokens.txt'));

            /*
             * Create an instance of Token that takes the following parameters
             */
            let tokenBuilder = new ZOHOCRMSDK.OAuthBuilder()
                .clientId(process.env.ZOHO_CLIENT_ID)
                .clientSecret(process.env.ZOHO_CLIENT_SECRET)
                .redirectURL(process.env.ZOHO_REDIRECT_URL);

            // ONLY add grantToken if it's actually provided in the environment
            const grantToken = process.env.ZOHO_GRANT_TOKEN || process.env.GRANT_TOKEN;
            
            // Check if tokens exist in the file store first
            const tokenStorePath = path.join(__dirname, '../zoho_tokens.txt');
            const hasExistingTokens = require('fs').existsSync(tokenStorePath);

            if (grantToken && grantToken.length > 50) {
                console.log('[ZohoService] Using provided Grant Token:', grantToken.substring(0, 10) + '...');
                tokenBuilder.grantToken(grantToken);
            } else if (!hasExistingTokens) {
                console.error('[ZohoService] ERROR: No Grant Token provided and no existing zoho_tokens.txt found.');
                throw new Error('MANDATORY_GRANT_TOKEN_MISSING');
            }

            let token = tokenBuilder.build();

            /*
             * Create an instance of SDKConfig that takes the following parameters
             * autoRefreshFields -> A boolean value that represents whether to auto-refresh fields or not.
             * pickListValidation -> A boolean value that represents whether to validate picklist values or not.
             * timeout -> An integer value that represents the timeout for the API call.
             */
            let sdkConfig = new ZOHOCRMSDK.SDKConfigBuilder()
                .autoRefreshFields(true)
                .pickListValidation(false)
                .build();

            /*
             * The path containing the absolute directory path to store user-specific files containing module fields information.
             */
            let resourcePath = path.join(__dirname, '../zoho_resources');
            if (!require('fs').existsSync(resourcePath)) {
                require('fs').mkdirSync(resourcePath);
            }

            /*
             * Initialize the SDK.
             */
            let builder = await new ZOHOCRMSDK.InitializeBuilder();
            await builder.environment(ZOHOCRMSDK.INDataCenter.PRODUCTION())
                .token(token)
                .store(tokenstore)
                .SDKConfig(sdkConfig)
                .resourcePath(resourcePath)
                .logger(logger)
                .initialize();

            this.initialized = true;
            console.log('[ZohoService] SDK Initialized successfully');
        } catch (error) {
            console.error('[ZohoService] Initialization failed:', error);
            throw error;
        }
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
     */
    async checkConnection() {
        try {
            await this.init();
            // Attempt a simple lightweight call (fetch 1 module info)
            const recordOperations = new ZOHOCRMSDK.Record.RecordOperations('Products');
            const paramInstance = new ZOHOCRMSDK.ParameterMap();
            paramInstance.add(ZOHOCRMSDK.Record.GetRecordsParam.PER_PAGE, 1);
            
            const response = await recordOperations.getRecords(paramInstance);
            
            if (response != null && [200, 201, 204].includes(response.getStatusCode())) {
                return { 
                    status: 'CONNECTED', 
                    message: 'Authentication successful and API responsive.',
                    timestamp: new Date()
                };
            } else {
                throw new Error(`API returned status code: ${response?.getStatusCode()}`);
            }
        } catch (error) {
            console.error('[ZohoService] Health Check Failed:', error.message);
            return { 
                status: 'DISCONNECTED', 
                message: error.message || 'Unknown connection error',
                timestamp: new Date()
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
