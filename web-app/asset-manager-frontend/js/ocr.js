/**
 * OCR & Document Data Extraction
 * Version: 1.0
 */

export function setupOcr() {
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
    const blocksView = document.getElementById('ocrBlocksView');
    const loadingOverlay = document.getElementById('ocrLoadingOverlay');
    const exportExcelBtn = document.getElementById('btnExportOcrExcel');
    const exportWordBtn = document.getElementById('btnExportOcrWord');
    const exportPdfBtn = document.getElementById('btnExportOcrPdf');

    if (!navOcr || !ocrView) return;

    // Add "Add Block" button to the UI if it doesn't exist
    if (!document.getElementById('btnAddOcrBlock')) {
        const toolbar = exportPdfBtn.parentElement;
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

    let selectedFile = null;
    let extractedBlocks = [];

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
        const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];
        if (!allowedTypes.includes(file.type)) {
            alert('Unsupported file type. Please upload a PDF or Image.');
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
        if (!blocksView) return;
        
        if (extractedBlocks.length === 0) {
            blocksView.innerHTML = '<p style="color: #999; text-align: center; margin-top: 40px;">Extracted blocks will appear here...</p>';
            return;
        }

        blocksView.innerHTML = '';
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

            blockDiv.style.cssText = `background: ${bgMap[block.type] || 'white'}; border: 1px solid ${borderMap[block.type] || '#e0e0e0'}; border-radius: 8px; padding: 15px; position: relative; transition: all 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.08); margin-bottom: 15px;`;
            
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; border-bottom: 1px solid #f0f0f0; padding-bottom: 8px;';
            
            const leftHeader = document.createElement('div');
            leftHeader.style.cssText = 'display: flex; align-items: center; gap: 12px;';

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

            const content = document.createElement('textarea');
            content.value = block.text;
            content.style.cssText = 'width: 100%; border: 1px solid #f0f0f0; border-radius: 4px; font-family: "Courier New", monospace; font-size: 13px; color: #222; resize: vertical; min-height: 80px; padding: 10px; background: rgba(255,255,255,0.5); line-height: 1.6;';
            content.oninput = (e) => {
                extractedBlocks[index].text = e.target.value;
                updateResultText();
            };

            blockDiv.appendChild(header);
            blockDiv.appendChild(content);
            blocksView.appendChild(blockDiv);
        });
        
        updateResultText();
    }

    function updateResultText() {
        resultText.value = extractedBlocks.map(b => b.text).join('\n\n');
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
                renderBlocks();
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
        const text = resultText.value;
        if (!text) return;

        const originalName = selectedFile ? selectedFile.name.split('.')[0] : 'exported';
        const filename = `${originalName}_extracted`;

        try {
            const response = await fetch(`/api/ocr/export/${type}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text, filename })
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
}
