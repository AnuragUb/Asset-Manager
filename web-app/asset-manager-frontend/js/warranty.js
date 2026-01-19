
console.log('WARRANTY.JS: Module loaded');
// Warranty and AMC Management Module

let warrantyChart = null;
let warrantyRanges = [];

const defaultRanges = [
    { label: 'Expired', min: -999, color: '#000000' },
    { label: '< 3 Months', min: 0, color: '#ff0000' },
    { label: '3-6 Months', min: 3, color: '#ff8c00' },
    { label: '6-12 Months', min: 6, color: '#ffd700' },
    { label: '1-2 Years', min: 12, color: '#90ee90' },
    { label: '2+ Years', min: 24, color: '#006400' }
];

export function initWarrantyView() {
    console.log('initWarrantyView() called - START');
    try {
        loadRanges();
        renderRangesTable();
        updateWarrantyChart();
        
        // Setup event listeners for range management
        const manageBtn = document.getElementById('btnManageWarrantyRanges');
        if (manageBtn) {
            console.log('Attaching click listener to btnManageWarrantyRanges');
            manageBtn.onclick = () => {
                const modal = document.getElementById('warrantyRangeModal');
                if (modal) {
                    resetRangeForm();
                    modal.style.display = 'block';
                }
            };
        } else {
            console.error('btnManageWarrantyRanges NOT FOUND');
        }

        const addRangeForm = document.getElementById('addRangeForm');
        if (addRangeForm) {
            addRangeForm.onsubmit = (e) => {
                e.preventDefault();
                saveRange();
            };
        }

        const closeModal = document.querySelector('#warrantyRangeModal .close-modal');
        if (closeModal) {
            closeModal.onclick = () => {
                document.getElementById('warrantyRangeModal').style.display = 'none';
            };
        }
        console.log('initWarrantyView() - Initialization complete');
    } catch (err) {
        console.error('CRITICAL ERROR in initWarrantyView:', err);
    }
}

function loadRanges() {
    const saved = localStorage.getItem('warranty_ranges');
    if (saved) {
        try {
            warrantyRanges = JSON.parse(saved);
        } catch (e) {
            console.error('Failed to parse saved ranges', e);
            warrantyRanges = [...defaultRanges];
        }
    } else {
        warrantyRanges = [...defaultRanges];
    }
    // Ensure ranges are sorted by min
    warrantyRanges.sort((a, b) => a.min - b.min);
}

function saveRanges() {
    localStorage.setItem('warranty_ranges', JSON.stringify(warrantyRanges));
}

function resetRangeForm() {
    document.getElementById('rangeIndex').value = '-1';
    document.getElementById('rangeLabel').value = '';
    document.getElementById('rangeMinMonths').value = '';
    document.getElementById('rangeColor').value = '#006400';
    document.getElementById('rangeFormTitle').innerText = 'Add New Range';
    document.getElementById('btnSaveRange').innerText = 'Add Range';
}

function renderRangesTable() {
    const body = document.getElementById('warrantyRangesBody');
    if (!body) return;

    body.innerHTML = warrantyRanges.map((range, index) => `
        <tr style="border-bottom: 1px solid #eee;">
            <td style="padding: 10px;"><div style="width: 20px; height: 20px; background: ${range.color}; border-radius: 50%; border: 1px solid #ccc;"></div></td>
            <td style="padding: 10px;">${range.label}</td>
            <td style="padding: 10px;">${range.min}</td>
            <td style="padding: 10px;">
                <button class="icon-button" onclick="window.editWarrantyRange(${index})" title="Edit">✏️</button>
                <button class="icon-button" onclick="window.deleteWarrantyRange(${index})" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

window.editWarrantyRange = (index) => {
    const range = warrantyRanges[index];
    document.getElementById('rangeIndex').value = index;
    document.getElementById('rangeLabel').value = range.label;
    document.getElementById('rangeMinMonths').value = range.min;
    document.getElementById('rangeColor').value = range.color;
    document.getElementById('rangeFormTitle').innerText = 'Edit Range';
    document.getElementById('btnSaveRange').innerText = 'Save Changes';
    document.getElementById('warrantyRangeModal').style.display = 'block';
};

window.deleteWarrantyRange = (index) => {
    if (confirm('Are you sure you want to delete this range?')) {
        warrantyRanges.splice(index, 1);
        saveRanges();
        renderRangesTable();
        updateWarrantyChart();
    }
};

function saveRange() {
    const index = parseInt(document.getElementById('rangeIndex').value);
    const range = {
        label: document.getElementById('rangeLabel').value,
        min: parseFloat(document.getElementById('rangeMinMonths').value),
        color: document.getElementById('rangeColor').value
    };

    if (index === -1) {
        warrantyRanges.push(range);
    } else {
        warrantyRanges[index] = range;
    }

    warrantyRanges.sort((a, b) => a.min - b.min);
    saveRanges();
    renderRangesTable();
    updateWarrantyChart();
    resetRangeForm();
}

function calculateMonthsRemaining(purchaseDate, warrantyMonths) {
    if (!purchaseDate || isNaN(parseInt(warrantyMonths))) return -999;
    
    const pDate = new Date(purchaseDate);
    const expiryDate = new Date(pDate);
    expiryDate.setMonth(pDate.getMonth() + parseInt(warrantyMonths));
    
    const now = new Date();
    const diffTime = expiryDate - now;
    const diffMonths = diffTime / (1000 * 60 * 60 * 24 * 30.44); // Average month length
    
    return diffMonths;
}

export function updateWarrantyChart() {
    const ctx = document.getElementById('warrantyPieChart')?.getContext('2d');
    if (!ctx) return;

    const assets = window.allAssets || [];
    const counts = warrantyRanges.map(() => 0);
    const legendContainer = document.getElementById('warrantyLegend');

    assets.forEach(asset => {
        // Only consider permanent assets (not placeholders)
        if (asset.isPlaceholder) return;
        
        const months = calculateMonthsRemaining(asset.PurchaseDate, asset.warranty_months);
        
        // Find the matching range (ranges are sorted by min)
        // We find the highest range where months >= range.min
        let matchIndex = -1;
        for (let i = warrantyRanges.length - 1; i >= 0; i--) {
            if (months >= warrantyRanges[i].min) {
                matchIndex = i;
                break;
            }
        }
        
        if (matchIndex !== -1) {
            counts[matchIndex]++;
        }
    });

    if (warrantyChart) {
        warrantyChart.destroy();
    }

    warrantyChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: warrantyRanges.map(r => r.label),
            datasets: [{
                data: counts,
                backgroundColor: warrantyRanges.map(r => r.color),
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false // We'll render our own legend
                },
                title: {
                    display: true,
                    text: 'Asset Warranty Status'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
                }
            }
        }
    });

    // Render custom legend
    if (legendContainer) {
        const total = counts.reduce((a, b) => a + b, 0);
        legendContainer.innerHTML = warrantyRanges.map((range, i) => `
            <div style="display: flex; align-items: center; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; border-left: 4px solid ${range.color};">
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 14px;">${range.label}</div>
                    <div style="font-size: 12px; color: #666;">Min: ${range.min} months</div>
                </div>
                <div style="text-align: right;">
                    <div style="font-weight: bold; font-size: 16px;">${counts[i]}</div>
                    <div style="font-size: 11px; color: #888;">${total > 0 ? Math.round((counts[i] / total) * 100) : 0}%</div>
                </div>
            </div>
        `).reverse().join(''); // Show highest ranges first
    }
}

window.initWarrantyView = initWarrantyView;
window.updateWarrantyChart = updateWarrantyChart;
