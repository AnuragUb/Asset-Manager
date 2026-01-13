import { showView } from './utils.js?v=3.4';

console.log('QR.JS: Module loading (v3.0)');

export function setupQrGenerator() {
    const navQrCode = document.getElementById('navQrCode');
    const navGenerateCode = document.getElementById('navGenerateCode');
    const btnGenerateQr = document.getElementById('btnGenerateQr');
    const qrAssetId = document.getElementById('qrAssetId');
    const qrDiv = document.getElementById('qrDiv');

    if (navQrCode) {
        navQrCode.addEventListener('click', (e) => {
            e.preventDefault();
            showView('qrView');
        });
    }

    if (navGenerateCode) {
        navGenerateCode.addEventListener('click', (e) => {
            e.preventDefault();
            showView('qrView');
        });
    }

    if (btnGenerateQr) {
        console.log('QR: btnGenerateQr found, attaching listener');
        btnGenerateQr.addEventListener('click', () => {
            const id = qrAssetId.value.trim();
            console.log('QR: Generate clicked for ID:', id);
            if (!id) {
                alert('Please enter an ID or text to generate a QR code.');
                return;
            }
            
            // Show loading
            qrDiv.innerHTML = '<p>Generating...</p>';
            
            // Use the API we just created
            const img = new Image();
            img.onload = () => {
                qrDiv.innerHTML = '';
                
                // Wrap in a link to open in new tab
                const link = document.createElement('a');
                link.href = img.src;
                link.target = '_blank';
                link.title = 'Click to open bigger';
                link.appendChild(img);
                
                qrDiv.appendChild(link);
                
                const tip = document.createElement('p');
                tip.style.fontSize = '12px';
                tip.style.color = '#666';
                tip.textContent = 'Click QR code to open in new tab (bigger)';
                qrDiv.appendChild(tip);

                // Show print options and set default size class
                const printOptions = document.getElementById('qrPrintOptions');
                if (printOptions) {
                    printOptions.style.display = 'block';
                    qrDiv.classList.add('qr-print-5cm'); // Default to 5cm as in HTML
                }
            };
            img.onerror = () => {
                qrDiv.innerHTML = '<p style="color:red;">Error generating QR code.</p>';
            };
            img.src = `/api/qr/${encodeURIComponent(id)}?size=500&v=${Date.now()}`;
            // img.style.maxWidth = '400px'; // REMOVED to avoid conflict with size classes
            // img.style.width = '100%';    // REMOVED to avoid conflict with size classes
            img.style.cursor = 'pointer';
            img.style.border = '1px solid #ddd';
            img.style.padding = '10px';
            img.style.background = 'white';
        });
    }

    // Print Size Selection
    const qrPrintOptions = document.getElementById('qrPrintOptions');
    if (qrPrintOptions) {
        qrPrintOptions.querySelectorAll('.size-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                qrPrintOptions.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                
                // Update qrDiv class for print sizing
                const size = btn.dataset.size;
                qrDiv.classList.remove('qr-print-1cm', 'qr-print-2cm', 'qr-print-5cm');
                qrDiv.classList.add(`qr-print-${size}`);
            });
        });
    }

    // Print Button
    const btnPrintQr = document.getElementById('btnPrintQr');
    if (btnPrintQr) {
        btnPrintQr.addEventListener('click', () => {
            // Ensure the correct size class is set before printing
            const activeBtn = document.querySelector('.size-btn.active');
            if (activeBtn) {
                const size = activeBtn.dataset.size;
                qrDiv.classList.remove('qr-print-1cm', 'qr-print-2cm', 'qr-print-5cm');
                qrDiv.classList.add(`qr-print-${size}`);
            }
            
            window.print();
        });
    }
}
