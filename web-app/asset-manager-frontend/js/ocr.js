/**
 * OCR & Document Data Extraction
 * Version: 1.0
 */

export function setupOcr() {
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
    const processBtn = document.getElementById('btnProcessOCR');
    const resultText = document.getElementById('ocrResultText');
    const loadingOverlay = document.getElementById('ocrLoadingOverlay');
    const exportExcelBtn = document.getElementById('btnExportOcrExcel');
    const exportWordBtn = document.getElementById('btnExportOcrWord');
    const exportPdfBtn = document.getElementById('btnExportOcrPdf');

    // OCR State
    let selectedFile = null;
    let extractedBlocks = [];
    let currentOcrFilename = null;

    // Add view toggle
    if (!document.getElementById('btnToggleOcrView')) {
        const toolbar = exportPdfBtn.parentElement;
        
        // Add Original Pro PDF download
        const downloadProBtn = document.createElement('button');
        downloadProBtn.id = 'btnDownloadProPdf';
        downloadProBtn.className = 'action-button';
        downloadProBtn.style.cssText = 'padding: 5px 15px; font-size: 13px; background: #1890ff; color: white; margin-right: 8px;';
        downloadProBtn.innerHTML = '📄 Download Original Pro PDF';
        downloadProBtn.onclick = () => {
            if (currentOcrFilename) {
                const a = document.createElement('a');
                a.href = `/uploads/${currentOcrFilename}`;
                a.download = currentOcrFilename;
                a.click();
            } else {
                alert('Please process or open a document first.');
            }
        };
        toolbar.prepend(downloadProBtn);

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
        processBtn.disabled = false;
    }

    clearFileBtn.onclick = () => {
        selectedFile = null;
        extractedBlocks = [];
        fileInput.value = '';
        dropZone.style.display = 'flex';
        fileInfo.style.display = 'none';
        processBtn.disabled = true;
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
                tableContainer.style.cssText = 'margin-bottom: 10px; overflow-x: auto; background: white; border-radius: 4px; border: 1px solid #eee;';
                
                const table = document.createElement('table');
                table.style.cssText = 'width: 100%; border-collapse: collapse; font-size: 12px; font-family: "Courier New", monospace;';
                
                const lines = block.text.split('\n');
                lines.forEach((line, rIdx) => {
                    if (!line.trim()) return;
                    const tr = document.createElement('tr');
                    const cells = line.split(/ {2,}|\t+/);
                    
                    cells.forEach((cell, cIdx) => {
                        const td = document.createElement(rIdx === 0 ? 'th' : 'td');
                        td.contentEditable = 'true';
                        td.textContent = cell.trim();
                        td.style.cssText = 'padding: 8px; border: 1px solid #f0f0f0; text-align: left; white-space: pre; font-family: "Courier New", monospace; outline: none;';
                        if (rIdx === 0) {
                            td.style.background = '#fafafa';
                            td.style.fontWeight = '600';
                        }
                        
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
            const response = await fetch('/api/ocr/history');
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
                            <button onclick="window.open('${file.url}', '_blank')" style="flex: 1; background: #fff; color: #1890ff; border: 1px solid #1890ff; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 11px; font-weight: 600;">PDF</button>
                        </div>
                        <a href="${file.url}" download="${file.name}" style="background: #1890ff; color: white; border: none; padding: 6px; border-radius: 4px; text-decoration: none; font-size: 11px; text-align: center; font-weight: 600;">Download Searchable PDF</a>
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
                        const res = await fetch(`/api/ocr/history/${file.name}/blocks`);
                        if (!res.ok) throw new Error('Failed to load blocks');
                        const blocks = await res.json();
                        
                        // Deep copy blocks to prevent accidental mutations
                        extractedBlocks = JSON.parse(JSON.stringify(blocks));
                        currentOcrFilename = file.name;
                        
                        console.log('OCR: Loaded blocks:', extractedBlocks.length);
                        
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
                            const res = await fetch(`/api/ocr/history/${filename}`, { method: 'DELETE' });
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

    // Process OCR
    processBtn.onclick = async () => {
        if (!selectedFile) return;

        const formData = new FormData();
        formData.append('document', selectedFile);

        loadingOverlay.style.display = 'flex';
        processBtn.disabled = true;

        try {
            const response = await fetch('/api/ocr/process', {
                method: 'POST',
                body: formData
            });

            const data = await response.json();
            if (data.blocks) {
            extractedBlocks = data.blocks || [];
            
            // Set current filename for saving
            if (data.downloadUrl) {
                currentOcrFilename = data.downloadUrl.split('/').pop();
                const saveBtn = document.getElementById('btnSaveOcrBlocks');
                if (saveBtn) saveBtn.style.display = 'inline-block';
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
                    <div><strong>✅ Pro Processing Complete:</strong> ${selectedFile.name}. Download the searchable PDF below or edit the blocks.</div>
                    <button onclick="document.getElementById('btnDownloadProPdf').click()" style="background: #1890ff; color: white; border: none; padding: 4px 10px; border-radius: 4px; font-size: 11px; cursor: pointer;">Get Pro PDF</button>
                `;
                bView.parentNode.insertBefore(hint, bView);
                
                // Show Pro Mode indicator if applicable
                if (data.isPro) {
                    const indicator = document.createElement('div');
                    indicator.id = 'ocrProIndicator';
                    indicator.style.cssText = 'background: #f6ffed; border: 1px solid #b7eb8f; color: #52c41a; padding: 10px 15px; border-radius: 4px; font-size: 13px; margin-bottom: 15px; display: flex; justify-content: space-between; align-items: center; font-weight: 600;';
                    
                    const leftPart = document.createElement('div');
                    leftPart.style.cssText = 'display: flex; align-items: center; gap: 8px;';
                    leftPart.innerHTML = '<span style="font-size: 16px;">✓</span> Pro OCR Engine Active (OCRmyPDF)';
                    indicator.appendChild(leftPart);

                    if (data.downloadUrl) {
                        const btnGroup = document.createElement('div');
                        btnGroup.style.cssText = 'display: flex; gap: 8px;';

                        const viewBtn = document.createElement('button');
                        viewBtn.textContent = 'View Pro PDF';
                        viewBtn.style.cssText = 'background: #1890ff; color: white; padding: 4px 12px; border-radius: 4px; border: none; cursor: pointer; font-size: 11px;';
                        viewBtn.onclick = () => {
                            window.open(data.downloadUrl, '_blank');
                        };
                        btnGroup.appendChild(viewBtn);

                        const downloadBtn = document.createElement('a');
                        downloadBtn.href = data.downloadUrl;
                        downloadBtn.download = (selectedFile ? selectedFile.name.split('.')[0] : 'pro_ocr') + '_editable.pdf';
                        downloadBtn.textContent = 'Download PDF';
                        downloadBtn.style.cssText = 'background: #52c41a; color: white; padding: 4px 12px; border-radius: 4px; text-decoration: none; font-size: 11px;';
                        btnGroup.appendChild(downloadBtn);

                        indicator.appendChild(btnGroup);
                    }
                    
                    const existing = document.getElementById('ocrProIndicator');
                    if (existing) existing.remove();
                    bView.parentNode.insertBefore(indicator, bView);
                } else {
                    const existing = document.getElementById('ocrProIndicator');
                    if (existing) existing.remove();
                }
            }

                renderBlocks();
                
                // Automatically switch to blocks view
                if (window.switchOcrTab) window.switchOcrTab('blocks');

                // Scroll to results
                const resultsArea = document.getElementById('ocrResultsArea');
                if (resultsArea) {
                    resultsArea.scrollIntoView({ behavior: 'smooth' });
                }

                loadOcrHistory(); // Refresh history
                exportExcelBtn.disabled = false;
                exportWordBtn.disabled = false;
                exportPdfBtn.disabled = false;
            } else {
                alert('Error: ' + (data.error || 'Failed to extract text'));
            }
        } catch (err) {
            console.error('OCR Error:', err);
            alert('Error processing document');
        } finally {
            loadingOverlay.style.display = 'none';
            processBtn.disabled = false;
        }
    };

    // Export Handlers
    exportPdfBtn.onclick = async () => {
        if (extractedBlocks.length === 0) return;

        try {
            const response = await fetch('/api/ocr/export/pdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    blocks: extractedBlocks,
                    filename: selectedFile ? selectedFile.name.split('.')[0] + '_reconstructed' : 'exported'
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = (selectedFile ? selectedFile.name.split('.')[0] + '_reconstructed' : 'exported') + '.pdf';
                document.body.appendChild(a);
                a.click();
                a.remove();
            } else {
                alert('Failed to export PDF');
            }
        } catch (err) {
            console.error('Export Error:', err);
            alert('Error exporting PDF');
        }
    };

    // Export Functions
    async function handleExport(type) {
        const selectedBlocks = extractedBlocks.filter(b => b.selected !== false);
        
        if (selectedBlocks.length === 0) {
            alert('Please select at least one block to export.');
            return;
        }

        const originalName = selectedFile ? selectedFile.name.split('.')[0] : 'exported';
        const filename = `${originalName}_extracted`;

        try {
            const response = await fetch(`/api/ocr/export/${type}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    blocks: selectedBlocks, 
                    text: selectedBlocks.map(b => b.text).join('\n\n'), 
                    filename 
                })
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${filename}.${type === 'excel' ? 'xlsx' : 'docx'}`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                a.remove();
            } else {
                alert('Export failed');
            }
        } catch (err) {
            console.error('Export error:', err);
            alert('Error exporting file: ' + err.message);
        }
    }

    exportExcelBtn.onclick = () => handleExport('excel');
    exportWordBtn.onclick = () => handleExport('word');

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
