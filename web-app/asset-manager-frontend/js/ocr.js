/**
 * OCR & Document Data Extraction
 * Version: 1.1 (Enhanced UI Fallback)
 */

import { processDocument, extractColumn, processToExcelV2 } from './integration_client.js?v=5.1';

export function setupOcr() {
    console.log('OCR Module Loaded v1.1 (Enhanced Fallback)');
    if (window.ocrInitialized) return;
    window.ocrInitialized = true;

    const navOcr = document.getElementById('nav-ocr');
    const ocrView = document.getElementById('ocr-view');
    const dropZone = document.getElementById('ocrDropZone');
    const fileInput = document.getElementById('ocrFileInput');
    const fileInfo = document.getElementById('ocrFileInfo');
    const fileName = document.getElementById('ocrFileName');
    const fileSize = document.getElementById('ocrFileSize');
    const clearFileBtn = document.getElementById('ocrClearFile');
    const aiProcessBtn = document.getElementById('btnProcessDocumentAI');
    const resultText = document.getElementById('ocrResultText');
    const loadingOverlay = document.getElementById('ocrLoadingOverlay');
    const exportExcelBtn = document.getElementById('btnExportOcrExcel');
    const exportWordBtn = document.getElementById('btnExportOcrWord');
    const exportPdfBtn = document.getElementById('btnExportOcrPdf');

    // OCR State
    let selectedFile = null;
    let extractedBlocks = [];
    let currentOcrFilename = null;

    function apiBase() {
        try {
            return (window.location && window.location.protocol === 'file:') ? 'http://localhost:8080' : '';
        } catch (e) {
            return '';
        }
    }

    // Add view toggle
    if (!document.getElementById('btnToggleOcrView')) {
        const toolbar = exportPdfBtn.parentElement;
        
        // Add Smart Filter button
        const smartFilterBtn = document.createElement('button');
        smartFilterBtn.id = 'btnSmartFilter';
        smartFilterBtn.className = 'action-button';
        smartFilterBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #52c41a; color: white; margin-right: 8px;';
        smartFilterBtn.innerHTML = '🔍 Product Filter';
        smartFilterBtn.onclick = () => {
            const keywords = ['product', 'summary', 'description', 'specification', 'technical', 'detail', 'feature', 'info'];
            let count = 0;
            extractedBlocks.forEach(block => {
                const text = block.text.toLowerCase();
                const isProductInfo = keywords.some(k => text.includes(k));
                block.selected = isProductInfo;
                if (isProductInfo) count++;
            });
            renderBlocks();
            alert(`Smart Filter: Selected ${count} blocks matching product information keywords.`);
        };
        toolbar.appendChild(smartFilterBtn);

        // Add Extract Product Info button
        const extractProductBtn = document.createElement('button');
        extractProductBtn.id = 'btnExtractProductInfo';
        extractProductBtn.className = 'action-button';
        extractProductBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #eb2f96; color: white; margin-right: 8px;';
        extractProductBtn.innerHTML = '🛍️ Extract Products';
        extractProductBtn.onclick = async () => {
            if (!selectedFile) {
                alert('Please select a file first.');
                return;
            }
            
            try {
                extractProductBtn.disabled = true;
                extractProductBtn.textContent = '⏳ Extracting...';
                
                console.log("Extracting product info...");
                
                // Call the new service
                const descriptions = await extractColumn(selectedFile);
                
                // Do something with the result (e.g., display it)
                console.log("Found products:", descriptions);
                
                if (descriptions && descriptions.length > 0) {
                    // Add as a new block
                    extractedBlocks.push({
                        text: descriptions.join('\n'),
                        type: 'block',
                        selected: true,
                        source: 'Product Extraction'
                    });
                    
                    renderBlocks();
                    
                    alert(`Extracted ${descriptions.length} items!\nAdded to Data Blocks view.`);
                } else {
                    alert('No product descriptions found.');
                }
                
            } catch (error) {
                alert("Failed to extract data: " + error.message);
            } finally {
                extractProductBtn.disabled = false;
                extractProductBtn.innerHTML = '🛍️ Extract Products';
            }
        };
        toolbar.appendChild(extractProductBtn);

        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'btnToggleOcrView';
        toggleBtn.className = 'action-button';
        toggleBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #673ab7; color: white;';
        toggleBtn.textContent = 'Switch to Original Layout View';
        let currentMode = 'blocks';
        toggleBtn.onclick = () => {
            if (currentMode === 'blocks') {
                renderOriginalLayout();
                toggleBtn.textContent = 'Switch to Blocks View';
                currentMode = 'layout';
            } else {
                renderBlocks();
                toggleBtn.textContent = 'Switch to Original Layout View';
                currentMode = 'blocks';
            }
        };
        toolbar.prepend(toggleBtn);
    }

    if (!navOcr || !ocrView) return;

    // Load history on start
    loadOcrHistory();

    // Add "Add Block" button to the UI if it doesn't exist
    if (!document.getElementById('btnAddOcrBlock')) {
        const toolbar = exportPdfBtn.parentElement;
        
        // Add Copy All Button
        const copyBtn = document.createElement('button');
        copyBtn.id = 'btnCopyOcrText';
        copyBtn.className = 'action-button';
        copyBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #faad14; color: white;';
        copyBtn.textContent = '📋 Copy All Text';
        copyBtn.onclick = () => {
            const allText = extractedBlocks.map(b => b.text).join('\n\n');
            navigator.clipboard.writeText(allText);
            const originalText = copyBtn.textContent;
            copyBtn.textContent = '✅ Copied!';
            setTimeout(() => copyBtn.textContent = originalText, 2000);
        };
        toolbar.prepend(copyBtn);

        const addBtn = document.createElement('button');
        addBtn.id = 'btnAddOcrBlock';
        addBtn.className = 'action-button blue';
        addBtn.style.cssText = 'padding: 5px 15px; font-size: 13px;';
        addBtn.textContent = '+ Add Block';
        addBtn.onclick = () => {
            extractedBlocks.push({ text: 'New content here...', type: 'block', bbox: null });
            renderBlocks();
        };
        toolbar.prepend(addBtn);
    }

    // Add Save Button
    if (!document.getElementById('btnSaveOcrBlocks')) {
        const toolbar = exportPdfBtn.parentElement;
        const saveBtn = document.createElement('button');
        saveBtn.id = 'btnSaveOcrBlocks';
        saveBtn.className = 'action-button';
        saveBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #52c41a; color: white; display: none;';
        saveBtn.textContent = '💾 Save Changes';
        saveBtn.onclick = async () => {
            if (!currentOcrFilename) {
                console.error('OCR Save: No filename set');
                return;
            }
            
            console.log('OCR Save: Saving blocks for', currentOcrFilename, extractedBlocks);
            
            saveBtn.disabled = true;
            saveBtn.textContent = '⌛ Saving...';
            saveBtn.style.background = '#1890ff';
            
            try {
                const response = await fetch(`/api/ocr/history/${currentOcrFilename}/blocks`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ blocks: extractedBlocks })
                });
                
                if (response.ok) {
                    console.log('OCR Save: Success');
                    saveBtn.textContent = '✅ Saved to Archive';
                    saveBtn.style.background = '#52c41a';
                    
                    // Crucial: reload history so the "Open in Editor" button has the latest data
                    await loadOcrHistory();
                    
                    setTimeout(() => {
                        saveBtn.textContent = '💾 Save Changes';
                        saveBtn.disabled = false;
                    }, 2000);
                } else {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to save');
                }
            } catch (err) {
                console.error('OCR Save: Failed:', err);
                saveBtn.textContent = '❌ Save Failed';
                saveBtn.style.background = '#ff4d4f';
                setTimeout(() => {
                    saveBtn.textContent = '💾 Save Changes';
                    saveBtn.style.background = '#52c41a';
                    saveBtn.disabled = false;
                }, 3000);
                alert('Save failed: ' + err.message);
            }
        };
        toolbar.prepend(saveBtn);
    }

    // Drag & Drop Handlers
    dropZone.onclick = () => fileInput.click();

    dropZone.ondragover = (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    };

    dropZone.ondragleave = () => {
        dropZone.classList.remove('drag-over');
    };

    dropZone.ondrop = (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    };

    fileInput.onchange = (e) => {
        if (e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    };

    function handleFileSelect(file) {
        const allowedTypes = [
            'application/pdf', 
            'image/png', 'image/jpeg', 'image/jpg',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-excel',
            'text/csv'
        ];
        if (!allowedTypes.includes(file.type)) {
            alert('Unsupported file type. Please upload a PDF, Image, or Excel file.');
            return;
        }

        selectedFile = file;
        fileName.textContent = file.name;
        fileSize.textContent = (file.size / 1024 / 1024).toFixed(2) + ' MB';
        
        dropZone.style.display = 'none';
        fileInfo.style.display = 'flex';
        if (aiProcessBtn) aiProcessBtn.disabled = false;
    }

    clearFileBtn.onclick = () => {
        selectedFile = null;
        extractedBlocks = [];
        fileInput.value = '';
        dropZone.style.display = 'flex';
        fileInfo.style.display = 'none';
        if (aiProcessBtn) aiProcessBtn.disabled = true;
        resultText.value = '';
        exportExcelBtn.disabled = true;
        exportWordBtn.disabled = true;
        exportPdfBtn.disabled = true;
    };

    function renderBlocks() {
        const blocksView = document.getElementById('ocrBlocksView');
        console.log('OCR: Rendering blocks, count:', extractedBlocks ? extractedBlocks.length : 'null');
        if (!blocksView) {
            console.error('OCR: blocksView element not found in DOM');
            return;
        }
        
        // Debug: Check if blocksView is actually visible in the DOM hierarchy
        const style = window.getComputedStyle(blocksView);
        console.log('OCR: blocksView visibility check:', {
            display: style.display,
            height: style.height,
            width: style.width,
            visibility: style.visibility,
            opacity: style.opacity
        });
        
        if (!Array.isArray(extractedBlocks) || extractedBlocks.length === 0) {
            console.log('OCR: No blocks to render');
            blocksView.innerHTML = '<p style="color: #999; text-align: center; margin-top: 40px;">No blocks extracted yet. Process a document to see results.</p>';
            return;
        }

        blocksView.innerHTML = '';
        blocksView.style.display = 'flex'; // Force display flex
        blocksView.style.flexDirection = 'column';
        blocksView.style.gap = '15px'; // Add gap for better spacing
        
        extractedBlocks.forEach((block, index) => {
            const blockDiv = document.createElement('div');
            blockDiv.className = 'ocr-block-card';
            
            // Background colors based on type
            const bgMap = {
                'header': '#fffbe6',
                'table': '#f9f9ff',
                'block': 'white'
            };
            const borderMap = {
                'header': '#ffe58f',
                'table': '#d0d0ff',
                'block': '#e0e0e0'
            };

            // Enhanced inline styles to ensure visibility
            blockDiv.style.cssText = `
                display: block !important;
                width: 100% !important;
                background: ${bgMap[block.type] || 'white'}; 
                border: 1px solid ${borderMap[block.type] || '#e0e0e0'}; 
                border-radius: 8px; 
                padding: 15px; 
                position: relative; 
                transition: all 0.2s; 
                box-shadow: 0 2px 8px rgba(0,0,0,0.08); 
                margin-bottom: 15px; 
                opacity: ${block.selected !== false ? '1' : '0.6'};
                min-height: 50px;
                box-sizing: border-box;
            `.replace(/\n\s+/g, ' ');
            
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #f0f0f0; padding-bottom: 8px;';
            
            const leftHeader = document.createElement('div');
            leftHeader.style.cssText = 'display: flex; align-items: center; gap: 12px;';

            // Source Badge (if available)
            if (block.source) {
                const sourceBadge = document.createElement('span');
                sourceBadge.style.cssText = 'font-size: 10px; background: #f0f0f0; color: #666; padding: 2px 8px; border-radius: 10px; font-weight: 600; text-transform: uppercase;';
                sourceBadge.textContent = block.source;
                leftHeader.appendChild(sourceBadge);
            }

            // Selection Checkbox
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = block.selected !== false;
            checkbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
            checkbox.title = 'Include in Export';
            checkbox.onchange = (e) => {
                block.selected = e.target.checked;
                blockDiv.style.opacity = block.selected ? '1' : '0.6';
            };
            leftHeader.appendChild(checkbox);

            // Reorder buttons
            const reorderGroup = document.createElement('div');
            reorderGroup.style.cssText = 'display: flex; flex-direction: column; gap: 2px;';
            
            const upBtn = document.createElement('button');
            upBtn.innerHTML = '▲';
            upBtn.style.cssText = 'font-size: 8px; padding: 2px; cursor: pointer; background: #eee; border: 1px solid #ccc; border-radius: 2px;';
            upBtn.disabled = index === 0;
            upBtn.onclick = () => {
                [extractedBlocks[index], extractedBlocks[index - 1]] = [extractedBlocks[index - 1], extractedBlocks[index]];
                renderBlocks();
            };

            const downBtn = document.createElement('button');
            downBtn.innerHTML = '▼';
            downBtn.style.cssText = 'font-size: 8px; padding: 2px; cursor: pointer; background: #eee; border: 1px solid #ccc; border-radius: 2px;';
            downBtn.disabled = index === extractedBlocks.length - 1;
            downBtn.onclick = () => {
                [extractedBlocks[index], extractedBlocks[index + 1]] = [extractedBlocks[index + 1], extractedBlocks[index]];
                renderBlocks();
            };

            reorderGroup.appendChild(upBtn);
            reorderGroup.appendChild(downBtn);
            leftHeader.appendChild(reorderGroup);

            const title = document.createElement('span');
            title.textContent = `Block ${index + 1}`;
            title.style.cssText = 'font-size: 11px; font-weight: 700; color: #555; text-transform: uppercase;';
            leftHeader.appendChild(title);

            // Type selector
            const typeSelect = document.createElement('select');
            typeSelect.style.cssText = 'font-size: 10px; padding: 2px 5px; border-radius: 4px; border: 1px solid #ccc; background: white;';
            ['block', 'header', 'table'].forEach(t => {
                const opt = document.createElement('option');
                opt.value = t;
                opt.textContent = t.toUpperCase();
                opt.selected = block.type === t;
                typeSelect.appendChild(opt);
            });
            typeSelect.onchange = (e) => {
                extractedBlocks[index].type = e.target.value;
                renderBlocks(); // Re-render to update colors
            };
            leftHeader.appendChild(typeSelect);

            const rightHeader = document.createElement('div');
            rightHeader.style.cssText = 'display: flex; align-items: center; gap: 8px;';

            if (index < extractedBlocks.length - 1) {
                const mergeBtn = document.createElement('button');
                mergeBtn.textContent = 'Merge Down';
                mergeBtn.style.cssText = 'background: #f0f0f0; border: 1px solid #ccc; border-radius: 4px; padding: 3px 8px; font-size: 10px; cursor: pointer; color: #666; font-weight: 600;';
                mergeBtn.onclick = () => {
                    extractedBlocks[index].text += '\n' + extractedBlocks[index + 1].text;
                    extractedBlocks.splice(index + 1, 1);
                    renderBlocks();
                };
                rightHeader.appendChild(mergeBtn);
            }

            const deleteBtn = document.createElement('button');
            deleteBtn.innerHTML = 'Delete';
            deleteBtn.style.cssText = 'background: #fff1f0; border: 1px solid #ffa39e; color: #f5222d; border-radius: 4px; padding: 3px 8px; font-size: 10px; cursor: pointer; font-weight: 600;';
            deleteBtn.onclick = () => {
                if(confirm('Delete this block?')) {
                    extractedBlocks.splice(index, 1);
                    renderBlocks();
                }
            };
            rightHeader.appendChild(deleteBtn);

            header.appendChild(leftHeader);
            header.appendChild(rightHeader);

            blockDiv.appendChild(header);
            
            if (block.type === 'table') {
                const tableContainer = document.createElement('div');
                // Ensure overflow-x works by setting max-width and overflow-x: auto
                tableContainer.style.cssText = 'margin-bottom: 10px; overflow-x: auto; background: white; border-radius: 4px; border: 1px solid #eee; width: 100%; max-width: 100%;';
                
                const table = document.createElement('table');
                // Use white-space: nowrap to force horizontal scrolling for wide tables
                table.style.cssText = 'border-collapse: collapse; font-size: 12px; font-family: "Courier New", monospace; white-space: nowrap; min-width: 100%;';
                
                const createCell = (text, isHeader) => {
                    const td = document.createElement(isHeader ? 'th' : 'td');
                    td.contentEditable = 'true';
                    td.textContent = text ? text.trim() : '';
                    td.style.cssText = 'padding: 8px; border: 1px solid #f0f0f0; text-align: left; white-space: nowrap; font-family: "Courier New", monospace; outline: none; min-width: 120px;';
                    if (isHeader) {
                        td.style.background = '#fafafa';
                        td.style.fontWeight = '600';
                    }
                    return td;
                };

                if (block.tableData) {
                    // Render using structured data
                    const renderRows = (rows, isHeader) => {
                        if (!rows) return;
                        rows.forEach(row => {
                            const tr = document.createElement('tr');
                            row.cells.forEach(cell => {
                                tr.appendChild(createCell(cell.text, isHeader));
                            });
                            table.appendChild(tr);
                        });
                    };

                    renderRows(block.tableData.header_rows, true);
                    renderRows(block.tableData.body_rows, false);
                    if (!block.tableData.header_rows && !block.tableData.body_rows && block.tableData.rows) {
                        renderRows(block.tableData.rows, false);
                    }
                } else {
                    // Fallback to text parsing
                    const lines = block.text.split('\n');
                    lines.forEach((line, rIdx) => {
                        if (!line.trim()) return;
                        const tr = document.createElement('tr');
                        const cells = line.split(/ {2,}|\t+/);
                        
                        cells.forEach((cell, cIdx) => {
                            const td = createCell(cell, rIdx === 0);
                            
                            td.oninput = () => {
                                // Reconstruct the line from cells
                                const rowCells = Array.from(tr.cells).map(c => c.textContent);
                                const currentText = extractedBlocks[index].text;
                                const updatedLines = currentText.split('\n');
                                updatedLines[rIdx] = rowCells.join('    '); // Use 4 spaces as separator
                                extractedBlocks[index].text = updatedLines.join('\n');
                                updateResultText();
                            };
                            
                            tr.appendChild(td);
                        });
                        table.appendChild(tr);
                    });
                }
                
                tableContainer.appendChild(table);
                blockDiv.appendChild(tableContainer);

                // Add a hidden raw text preview for tables
                const rawPreview = document.createElement('pre');
                rawPreview.style.cssText = 'display: none; margin-bottom: 10px; padding: 10px; background: #f5f5f5; border: 1px solid #ccc; border-radius: 4px; font-family: "Courier New", monospace; font-size: 11px; white-space: pre-wrap;';
                rawPreview.textContent = block.text;
                blockDiv.appendChild(rawPreview);

                const toggleBtn = document.createElement('button');
                toggleBtn.textContent = 'Show Raw Text';
                toggleBtn.style.cssText = 'font-size: 10px; color: #1890ff; background: none; border: none; cursor: pointer; padding: 0; margin-bottom: 10px;';
                toggleBtn.onclick = () => {
                    const isVisible = rawPreview.style.display !== 'none';
                    rawPreview.style.display = isVisible ? 'none' : 'block';
                    toggleBtn.textContent = isVisible ? 'Show Raw Text' : 'Hide Raw Text';
                };
                blockDiv.appendChild(toggleBtn);
            } else {
                // For non-table blocks, show an editable div instead of a pre preview
                const editable = document.createElement('div');
                editable.contentEditable = 'true';
                editable.style.cssText = 'margin-bottom: 10px; padding: 15px; background: #fff; border: 1px solid #d9d9d9; border-radius: 4px; font-family: "Courier New", monospace; font-size: 13px; min-height: 60px; white-space: pre-wrap; outline: none; transition: border-color 0.2s;';
                editable.onfocus = () => editable.style.borderColor = '#40a9ff';
                editable.onblur = () => editable.style.borderColor = '#d9d9d9';
                editable.textContent = block.text;
                
                editable.oninput = (e) => {
                    extractedBlocks[index].text = e.target.textContent;
                    updateResultText();
                };
                blockDiv.appendChild(editable);
            }
            blocksView.appendChild(blockDiv);
        });
        
        updateResultText();
    }

    function renderOriginalLayout() {
        const blocksView = document.getElementById('ocrBlocksView');
        if (!blocksView) return;
        blocksView.innerHTML = '';
        
        const container = document.createElement('div');
        container.style.cssText = 'background: white; padding: 30px; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 4px 12px rgba(0,0,0,0.1); min-height: 800px; font-family: "Courier New", monospace; font-size: 12px; white-space: pre; overflow-x: auto; color: #333; line-height: 1.2;';
        
        // Combine all blocks into a single layout view
        container.textContent = extractedBlocks.map(b => b.text).join('\n\n');
        
        const info = document.createElement('div');
        info.style.cssText = 'margin-bottom: 15px; font-size: 11px; color: #666; font-style: italic;';
        info.textContent = 'Showing original layout reconstruction. Use "Switch to Blocks View" to edit individual sections.';
        
        blocksView.appendChild(info);
        blocksView.appendChild(container);
    }

    function updateResultText() {
        if (!resultText) return;
        if (!Array.isArray(extractedBlocks)) return;
        
        resultText.value = extractedBlocks.map(b => b.text).join('\n\n');
        // Update Raw Text tab with monospaced styling
        resultText.style.fontFamily = '"Courier New", monospace';
        resultText.style.fontSize = '12px';
        resultText.style.whiteSpace = 'pre';
        resultText.style.overflowX = 'auto';
    }

    // History management
    async function loadOcrHistory() {
        try {
            const response = await fetch(`${apiBase()}/api/ocr/history`);
            const history = await response.json();
            
            const historyContainer = document.getElementById('ocrHistoryList');
            if (!historyContainer) {
                // Create history section if it doesn't exist
                const section = document.createElement('div');
                section.className = 'ocr-section';
                section.style.marginTop = '30px';
                section.innerHTML = `
                    <h3 style="margin-bottom: 15px; display: flex; align-items: center; gap: 8px; color: #333; font-size: 16px;">
                        <span style="font-size: 20px;">📜</span> Permanent OCR Archive
                    </h3>
                    <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; border: 1px dashed #d9d9d9;">
                        <div id="ocrHistoryList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px;">
                        </div>
                    </div>
                `;
                ocrView.appendChild(section);
            }
            
            const list = document.getElementById('ocrHistoryList');
            list.innerHTML = '';
            
            if (history.length === 0) {
                list.innerHTML = '<p style="color: #999; font-size: 12px;">No hosted PDFs yet.</p>';
                return;
            }
            
            history.forEach(file => {
                const card = document.createElement('div');
                card.style.cssText = 'background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 12px; display: flex; flex-direction: column; gap: 8px; transition: transform 0.2s;';
                card.onmouseover = () => card.style.transform = 'translateY(-2px)';
                card.onmouseout = () => card.style.transform = 'translateY(0)';
                
                const date = new Date(file.date).toLocaleDateString() + ' ' + new Date(file.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const hasBlocks = file.hasBlocks;
                
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px;">
                        <div style="font-weight: 600; font-size: 13px; color: #1890ff; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1;" title="${file.name}">${file.name}</div>
                        <button class="delete-ocr" data-filename="${file.name}" style="background: none; border: none; color: #ff4d4f; cursor: pointer; font-size: 14px; padding: 0 0 0 8px;">×</button>
                    </div>
                    <div style="font-size: 11px; color: #888; margin-bottom: 8px;">
                        ${date} • ${(file.size / 1024 / 1024).toFixed(2)} MB
                        ${hasBlocks ? '<span style="color: #52c41a; margin-left: 8px;">• ✍️ Editable</span>' : ''}
                    </div>
                        <div style="display: flex; flex-direction: column; gap: 8px; margin-top: auto;">
                            <div style="display: flex; gap: 8px;">
                                <button class="load-ocr" style="flex: 2; background: #52c41a; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">Open in Editor</button>
                                <button onclick="window.open('${apiBase()}${file.url}', '_blank')" style="flex: 1; background: #fff; color: #1890ff; border: 1px solid #1890ff; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">PDF</button>
                            </div>
                            <a href="${apiBase()}${file.url}" download="${file.name}" style="background: #1890ff; color: white; border: none; padding: 6px; border-radius: 4px; text-decoration: none; font-size: 11px; text-align: center; font-weight: 600;">Download Searchable PDF</a>
                        </div>
                `;

                card.querySelector('.load-ocr').onclick = async () => {
                    console.log('OCR: Loading document from history:', file.name);
                    
                    if (!file.hasBlocks) {
                        alert('This document doesn\'t have editable blocks saved in the archive yet. You can only view the PDF or re-process the file.');
                        return;
                    }
                    
                    try {
                        loadingOverlay.style.display = 'flex';
                            const res = await fetch(`${apiBase()}/api/ocr/history/${file.name}/blocks`);
                        if (!res.ok) throw new Error('Failed to load blocks');
                        const blocks = await res.json();
                        
                        // Deep copy blocks to prevent accidental mutations
                        extractedBlocks = JSON.parse(JSON.stringify(blocks));
                        currentOcrFilename = file.name;
                        
                        console.log('OCR: Loaded blocks:', extractedBlocks.length);
                        
                        // Enable export buttons
                        if (exportExcelBtn) exportExcelBtn.disabled = false;
                        if (exportWordBtn) exportWordBtn.disabled = false;
                        if (exportPdfBtn) exportPdfBtn.disabled = false;

                        // Update UI
                        const saveBtn = document.getElementById('btnSaveOcrBlocks');
                        if (saveBtn) {
                            saveBtn.style.display = 'inline-block';
                            saveBtn.textContent = '💾 Save Changes';
                            saveBtn.style.background = '#52c41a';
                            saveBtn.disabled = false;
                        }
                        
                        // Clear previous results view if any
                        const blocksView = document.getElementById('ocrBlocksView');
                        if (blocksView) {
                            blocksView.innerHTML = '';
                        }
                        
                        // Render blocks
                        renderBlocks();
                        
                        // Automatically switch to blocks view
                        if (window.switchOcrTab) window.switchOcrTab('blocks');
                        
                        // Update the raw text view
                        updateResultText();
                        
                        // Scroll to results area
                        const resultsArea = document.getElementById('ocrResultsArea');
                        if (resultsArea) {
                            resultsArea.scrollIntoView({ behavior: 'smooth' });
                        }
                        
                // Show a notification
                const bView = document.getElementById('ocrBlocksView');
                if (bView) {
                    const existingHint = bView.parentNode.querySelector('.ocr-status-hint');
                    if (existingHint) existingHint.remove();
                    
                    const hint = document.createElement('div');
                    hint.className = 'ocr-status-hint';
                    hint.style.cssText = 'background: #e6f7ff; border: 1px solid #91d5ff; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 12px; color: #0050b3; display: flex; justify-content: space-between; align-items: center;';
                    hint.innerHTML = `
                        <div><strong>📂 Loaded:</strong> ${file.name}. You can edit and click <strong>Save Changes</strong> to update this archive.</div>
                        <button onclick="document.getElementById('btnDownloadProPdf').click()" style="background: #1890ff; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;">Get Original Pro PDF</button>
                    `;
                    bView.parentNode.insertBefore(hint, bView);
                }
                    } catch (err) {
                        console.error('OCR: Error loading blocks:', err);
                        alert('Error loading this document: ' + err.message);
                    } finally {
                        loadingOverlay.style.display = 'none';
                    }
                };

                card.querySelector('.delete-ocr').onclick = async (e) => {
                    if (confirm('Permanently delete this hosted OCR file?')) {
                        const filename = e.target.getAttribute('data-filename');
                        try {
                            const res = await fetch(`${apiBase()}/api/ocr/history/${filename}`, { method: 'DELETE' });
                            if (res.ok) loadOcrHistory();
                        } catch (err) {
                            console.error('Delete failed:', err);
                        }
                    }
                };
                list.appendChild(card);
            });
        } catch (err) {
            console.error('Failed to load OCR history:', err);
        }
    }

    // AI-only processing is handled below in aiProcessBtn.onclick

    // Process with Document AI
    if (aiProcessBtn) {
        aiProcessBtn.onclick = async () => {
            if (!selectedFile) return;

            loadingOverlay.style.display = 'flex';
            aiProcessBtn.disabled = true;

            try {
                console.log('OCR: Processing with Document AI...', selectedFile.name);
                const result = await processDocument(selectedFile);
                
                // Handle different response formats (standard Document AI vs user's specific format)
                const data = result.data || result;
                console.log('OCR: Data received:', data);
                
                if (result && (result.data || result.status === 'success' || result.ocr_results || result.text)) {
                    // Map Document AI result to the format expected by renderBlocks
                    
                    let newBlocks = [];
                    
                    // 1. Check for full text (from result.data.text or result.ocr_results)
                    let fullText = data.text || (data.ocr_results && Array.isArray(data.ocr_results) && data.ocr_results.map(r => r.text).join('\n'));

                    // Fallback: Check deep for text if not found at top level
                    if (!fullText && data.analyzeResult && data.analyzeResult.content) {
                        fullText = data.analyzeResult.content;
                    }
                    
                    // Fallback: If still no text, try to stringify the data so user sees something
                    if (!fullText) {
                         console.warn('OCR: No text field found in response. Using JSON dump.');
                         fullText = "No direct text content found. Raw Response:\n" + JSON.stringify(data, null, 2);
                    }

                    // Full text block disabled to avoid duplication with Layout blocks.
                    // Will be added as fallback if no other blocks are found.

                    // 2. Check for entities (names, dates, amounts, etc.)
                    const entities = data.entities || data.extraction_results;
                    if (entities && entities.length > 0) {
                        const entityText = entities.map(ent => {
                            const label = ent.type || ent.label || 'Entity';
                            const value = ent.mention_text || ent.text || ent.value || 'N/A';
                            // Confidence hidden per user request
                            return `[${label}]: ${value}`;
                        }).join('\n');

                        newBlocks.push({
                            text: entityText,
                            type: 'header',
                            selected: true,
                            source: 'Document AI (Extraction)'
                        });
                    }

                    // 3. Check for tables
                    const tables = data.tables || (data.extraction_results && data.extraction_results.filter(r => r.type === 'table'));
                    if (tables && tables.length > 0) {
                        tables.forEach((table, tIdx) => {
                            // Convert Document AI table format to our table text format
                            let tableText = '';
                            if (table.header_rows) {
                                tableText += table.header_rows.map(row => row.cells.map(c => c.text).join('    ')).join('\n') + '\n';
                            }
                            if (table.body_rows) {
                                tableText += table.body_rows.map(row => row.cells.map(c => c.text).join('    ')).join('\n');
                            }
                            // Fallback for different table formats
                            if (!tableText && table.rows) {
                                tableText = table.rows.map(row => row.cells.map(c => c.text || c.value).join('    ')).join('\n');
                            }

                            if (tableText.trim()) {
                                newBlocks.push({
                                    text: tableText,
                                    type: 'table',
                                    selected: true,
                                    source: `Document AI (Table ${tIdx + 1})`,
                                    tableData: table
                                });
                            }
                        });
                    }

                    // 4. Check for layout/segments
                    const segments = data.segments || data.layout_results;
                    if (segments && segments.length > 0) {
                        segments.forEach(seg => {
                            if (seg.text) {
                                newBlocks.push({
                                    text: seg.text,
                                    type: seg.type || 'block',
                                    selected: true,
                                    source: 'Document AI (Layout)'
                                });
                            }
                        });
                    }

                    // Fallback: If no structured blocks were found, use the full text
                    if (newBlocks.length === 0 && fullText) {
                        newBlocks.push({
                            text: fullText,
                            type: 'block',
                            selected: true,
                            source: 'Document AI (Text)'
                        });
                    }

                    // Update UI status hint
                    const bView = document.getElementById('ocrBlocksView');
                    
                    // 5. Check for downloadable files from AI (Excel, Word, etc.)
                    const downloadFiles = data.downloads || data.files || [];
                    if (downloadFiles.length > 0 && bView) {
                        // Remove existing downloads if any
                        const existingDownloads = bView.parentNode.querySelector('.ai-downloads');
                        if (existingDownloads) existingDownloads.remove();

                        const downloadContainer = document.createElement('div');
                        downloadContainer.className = 'ai-downloads';
                        downloadContainer.style.cssText = 'background: #f6ffed; border: 1px solid #b7eb8f; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 13px;';
                        downloadContainer.innerHTML = '<strong>📁 AI Generated Files:</strong><div style="display: flex; gap: 10px; margin-top: 5px;"></div>';
                        const btnGroup = downloadContainer.querySelector('div');
                        
                        downloadFiles.forEach(file => {
                            const link = document.createElement('a');
                            link.href = file.url;
                            link.textContent = `Download ${file.type || 'File'}`;
                            link.className = 'action-button green';
                            link.style.cssText = 'padding: 3px 10px; font-size: 11px; text-decoration: none;';
                            link.download = file.name || 'document';
                            btnGroup.appendChild(link);
                        });
                        
                        bView.parentNode.insertBefore(downloadContainer, bView);
                    }

                    extractedBlocks = newBlocks.length > 0 ? newBlocks : [{ text: 'No text extracted', type: 'block' }];
                    
                    // Populate raw text textarea
                    if (resultText && fullText) {
                        resultText.value = fullText;
                    } else if (resultText) {
                        resultText.value = extractedBlocks.map(b => b.text).join('\n\n');
                    }
                    
                    if (bView) {
                        const existingHint = bView.parentNode.querySelector('.ocr-status-hint');
                        if (existingHint) existingHint.remove();
                        
                        const hint = document.createElement('div');
                        hint.className = 'ocr-status-hint';
                        hint.style.cssText = 'background: #f9f0ff; border: 1px solid #d3adf7; padding: 10px; border-radius: 4px; margin-bottom: 15px; font-size: 12px; color: #531dab; display: flex; justify-content: space-between; align-items: center;';
                        hint.innerHTML = `
                            <div><strong>✨ Document AI Analysis Complete:</strong> ${selectedFile.name}. Extracted ${newBlocks.length} data blocks.</div>
                        `;
                        bView.parentNode.insertBefore(hint, bView);
                    }

                    renderBlocks();
                    if (window.switchOcrTab) window.switchOcrTab('blocks');
                    updateResultText();

                    // Enable export buttons
                    if (exportExcelBtn) exportExcelBtn.disabled = false;
                    if (exportWordBtn) exportWordBtn.disabled = false;
                    if (exportPdfBtn) exportPdfBtn.disabled = false;
                } else {
                    throw new Error('Document AI returned no data.');
                }

            } catch (err) {
                console.error('Document AI Process error:', err);
                alert('Error processing with Document AI: ' + err.message);
            } finally {
                loadingOverlay.style.display = 'none';
                aiProcessBtn.disabled = false;
            }
        };
    }

    // Export Handlers
    exportPdfBtn.onclick = async () => {
        const selectedBlocks = extractedBlocks.filter(b => b.selected !== false);
        console.log('OCR: Exporting to PDF. Selected blocks:', selectedBlocks.length);
        
        if (selectedBlocks.length === 0) {
            alert('Please select at least one block to export.');
            return;
        }

        try {
            const apiUrl = `${apiBase()}/api/ocr/export/pdf`;
            console.log(`OCR: Sending export request to ${apiUrl}...`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blocks: selectedBlocks,
                    filename: selectedFile ? selectedFile.name.split('.')[0] + '_reconstructed' : 'exported'
                })
            });

            if (response.ok) {
                console.log('OCR: Export response OK. Downloading PDF...');
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (selectedFile ? selectedFile.name.split('.')[0] + '_reconstructed' : 'exported') + '.pdf';
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    a.remove();
                }, 100);
            } else {
                const errorText = await response.text();
                console.error(`OCR: PDF Export failed with status ${response.status}:`, errorText);
                alert(`Failed to export PDF (${response.status}): ${errorText}`);
            }
        } catch (err) {
            console.error('Export Error:', err);
            if (err.message.includes('Failed to fetch')) {
                 alert('Network Error: Could not connect to the server for PDF export. Please check if the backend server is running.');
            } else {
                 alert('Error exporting PDF: ' + err.message);
            }
        }
    };

    // Export Functions
    async function handleExport(type) {
        console.log(`OCR: Exporting to ${type}. Total blocks:`, extractedBlocks.length);
        const selectedBlocks = extractedBlocks.filter(b => b.selected !== false);
        console.log(`OCR: Selected blocks for export:`, selectedBlocks.length);
        
        if (selectedBlocks.length === 0) {
            alert('Please select at least one block to export.');
            return;
        }

        const originalName = selectedFile ? selectedFile.name.split('.')[0] : 'exported';
        const filename = `${originalName}_extracted`;

        try {
            const apiUrl = `${apiBase()}/api/ocr/export/${type}`;
            console.log(`OCR: Sending export request to ${apiUrl}...`);
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    blocks: selectedBlocks, 
                    text: selectedBlocks.map(b => b.text).join('\n\n'), 
                    filename 
                })
            });

            if (response.ok) {
                console.log(`OCR: Export response OK. Downloading file...`);
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${filename}.${type === 'excel' ? 'xlsx' : 'docx'}`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                    a.remove();
                }, 100);
            } else {
                const errorText = await response.text();
                console.error(`OCR: Export failed with status ${response.status}:`, errorText);
                alert(`Export failed (${response.status}): ${errorText}`);
            }
        } catch (err) {
            console.error('Export error:', err);
            if (err.message.includes('Failed to fetch')) {
                 alert('Network Error: Could not connect to the server. Please check if the backend server is running and accessible.');
            } else {
                 alert('Error exporting file: ' + err.message);
            }
        }
    }

    exportExcelBtn.onclick = () => handleExport('excel');
    // exportWordBtn.onclick = () => handleExport('word');
    
    // Mapped to new V2 Excel Logic as per user request
    exportWordBtn.onclick = async () => {
        if (!selectedFile) {
            alert('Please select a file first.');
            return;
        }
        
        const originalText = exportWordBtn.innerHTML;
        try {
            exportWordBtn.disabled = true;
            exportWordBtn.innerHTML = '⏳ Processing V2...';
            
            await processToExcelV2(selectedFile);
            
        } catch (err) {
            console.error(err);
            alert('V2 Export Failed: ' + err.message);
        } finally {
            exportWordBtn.disabled = false;
            exportWordBtn.innerHTML = originalText;
        }
    };

    // Tab Switching Logic
    window.switchOcrTab = (tab) => {
        const rawView = document.getElementById('ocrRawView');
        const blocksView = document.getElementById('ocrBlocksView');
        const tabs = document.querySelectorAll('.tab-btn');

        if (tab === 'raw') {
            rawView.style.display = 'block';
            blocksView.style.display = 'none';
        } else {
            rawView.style.display = 'none';
            blocksView.style.display = 'flex';
            blocksView.style.flexDirection = 'column';
        }

        tabs.forEach(t => {
            if (t.textContent.toLowerCase().includes(tab)) {
                t.classList.add('active');
            } else {
                t.classList.remove('active');
            }
        });
    };
}
