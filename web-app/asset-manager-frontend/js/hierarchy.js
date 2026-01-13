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
     * Builds a recursive tree structure from flat data
     */
    buildTree(flatData) {
        const nodes = {};
        const tree = [];

        // Create node map
        flatData.forEach(item => {
            nodes[item.ID] = { ...item, children: [] };
        });

        // Link children to parents
        flatData.forEach(item => {
            const node = nodes[item.ID];
            if (item.ParentID && nodes[item.ParentID]) {
                nodes[item.ParentID].children.push(node);
            } else {
                tree.push(node);
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
            if (node.ID === id) return node;
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
    generateSidebarHTML(tree, level = 0) {
        if (!tree || tree.length === 0) return '';

        return tree.map(node => {
            const hasChildren = node.children && node.children.length > 0;
            const paddingLeft = 40 + (level * 15);
            
            return `
                <div class="tree-node" data-id="${node.ID}" style="user-select: none;">
                    <div class="tree-item-wrapper" style="padding: 6px 20px 6px ${paddingLeft}px; display: flex; align-items: center; gap: 8px; cursor: pointer; transition: background 0.2s;">
                        <span class="tree-toggle" style="width: 14px; text-align: center; color: #999; font-size: 10px; visibility: ${hasChildren ? 'visible' : 'hidden'}">
                            ${hasChildren ? '▶' : ''}
                        </span>
                        <span class="tree-icon">${node.Icon || (node.type === 'folder' ? '📁' : '📦')}</span>
                        <span class="tree-link" data-id="${node.ID}" style="flex: 1; color: #555; font-size: 13px;">${node.Name}</span>
                    </div>
                    ${hasChildren ? `
                        <div class="tree-children" id="children-${node.ID}" style="display: none;">
                            ${this.generateSidebarHTML(node.children, level + 1)}
                        </div>
                    ` : ''}
                </div>
            `;
        }).join('');
    }
}

