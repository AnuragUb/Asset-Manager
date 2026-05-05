/**
 * HierarchyManager.js
 * Manages the organizational structure of assets (Folders and Kinds)
 * Version: 4.0
 */

export class HierarchyManager {
    constructor(data) {
        this.data = data || [];
        this.tree = this.buildTree(this.data);
    }

    /**
     * Standardized way to map database folders and kinds to hierarchy nodes
     */
    static mapNodes(folders = [], kinds = []) {
        return [
            ...folders.map(f => ({ 
                ...f, 
                ID: f.ID || f.id, 
                Name: f.Name || f.name,
                ParentID: f.ParentID || f.parentid,
                Module: f.Module || f.module,
                Icon: f.Icon || f.icon,
                DisplayImage: f.DisplayImage || f.displayimage,
                type: 'folder' 
            })),
            ...kinds.map(k => ({ 
                ...k, 
                ID: k.ID || k.id || k.Name || k.name, 
                Name: k.Name || k.name,
                ParentID: k.ParentID || k.parentid || k.ParentName || k.parentname,
                Module: k.Module || k.module,
                Icon: k.Icon || k.icon,
                DisplayImage: k.DisplayImage || k.displayimage,
                type: 'kind' 
            }))
        ];
    }

    /**
     * Builds a recursive tree structure from flat data
     */
    buildTree(flatData) {
        const nodes = {};
        const tree = [];

        // Create node map - ensure every node has an ID and consistent properties
        flatData.forEach(item => {
            const id = item.ID || item.Name;
            if (id) {
                const node = { 
                    ...item, 
                    ID: id, 
                    Name: item.Name || id,
                    children: [] 
                };
                nodes[id] = node;
                // Also map by name if it's different from ID to allow name-based parent lookups
                if (item.Name && item.Name !== id) {
                    nodes[item.Name] = node;
                }
            }
        });

        // Link children to parents
        const addedToHierarchy = new Set();

        flatData.forEach(item => {
            const id = item.ID || item.Name;
            const node = nodes[id];
            if (!node || addedToHierarchy.has(node.ID)) return;

            const parentId = item.ParentID;
            
            // Check if parent exists in our map (case-insensitive check could be added if needed)
            if (parentId && nodes[parentId] && parentId !== id) {
                // Check if already a child to avoid duplication
                if (!nodes[parentId].children.some(c => c.ID === node.ID)) {
                    nodes[parentId].children.push(node);
                    addedToHierarchy.add(node.ID);
                }
            } else {
                // No parent found, this is a root node
                tree.push(node);
                addedToHierarchy.add(node.ID);
            }
        });

        return tree;
    }

    /**
     * Filters the tree for a specific module (IT, In-House, etc.)
     */
    getModuleTree(moduleName) {
        return this.tree.filter(node => node.Module === moduleName);
    }

    /**
     * Finds a node by ID recursively
     */
    findNode(id, nodes = this.tree) {
        for (const node of nodes) {
            // Use loose equality to handle string/number ID mismatches
            if (node.ID == id) return node;
            if (node.children && node.children.length > 0) {
                const found = this.findNode(id, node.children);
                if (found) return found;
            }
        }
        return null;
    }

    /**
     * Gets all descendants of a node
     */
    getDescendants(parentId, includeSelf = false) {
        const startNode = this.findNode(parentId);
        if (!startNode) return [];

        const results = includeSelf ? [startNode] : [];
        
        const traverse = (node) => {
            if (node.children) {
                node.children.forEach(child => {
                    results.push(child);
                    traverse(child);
                });
            }
        };

        traverse(startNode);
        return results;
    }

    /**
     * Generates HTML for the sidebar tree
     */
    generateSidebarHTML(tree, level = 0, activeId = null) {
        if (!tree || tree.length === 0) return '';

        return tree.map(node => {
            const hasChildren = node.children && node.children.length > 0;
            const paddingLeft = 40 + (level * 15);
            // Check if this node is active (loose equality for string/number match)
            const isActive = activeId && (node.ID == activeId);
            const activeClass = isActive ? 'active' : '';
            
            return `
                <div class="tree-node" data-id="${node.ID}" style="user-select: none;">
                    <div class="tree-item-wrapper ${activeClass}" data-id="${node.ID}" style="padding-left: ${paddingLeft}px;">
                        <span class="tree-toggle" style="visibility: ${hasChildren ? 'visible' : 'hidden'}">
                            ${hasChildren ? '▶' : ''}
                        </span>
                        <span class="tree-icon">
                            ${(node.DisplayImage && (node.DisplayImage.startsWith('/') || node.DisplayImage.startsWith('http')))
                                ? `<img src="${node.DisplayImage}">`
                                : (node.Icon && (node.Icon.startsWith('/') || node.Icon.startsWith('http'))) 
                                    ? `<img src="${node.Icon}">`
                                    : (node.Icon || (node.type === 'folder' ? '📁' : '📦'))}
                        </span>
                        <span class="tree-link ${activeClass}" data-id="${node.ID}">${node.Name}</span>
                        ${node.type === 'kind' ? `
                            <span class="edit-kind-btn" data-id="${node.ID}" title="Edit Category">✏️</span>
                            <span class="delete-kind-btn" data-id="${node.ID}" title="Delete Category">🗑️</span>
                        ` : ''}
                    </div>
                    ${hasChildren ? `
                        <div class="tree-children" id="children-${node.ID}" style="display: none;">
                            ${this.generateSidebarHTML(node.children, level + 1, activeId)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
}

