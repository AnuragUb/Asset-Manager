// Document AI Client Integration
// Usage: Copy this file into your internal app (192.168.6.59)

/**
 * Configuration for the Document AI Service
 */
const CONFIG = {
  // Point to the LOCAL backend proxy, which handles the connection to 192.168.6.123
  // This avoids CORS issues and ensures proper authentication/logging
  BASE_URL: '/api/ocr', 
  
  // Optional: Your internal app's webhook endpoint to receive results asynchronously
  WEBHOOK_URL: null 
};

/**
 * Helper: Prepare FormData for upload
 * Handles both Browser (File object) and Node (Buffer/Stream) if needed
 */
function createFormData(file, additionalFields = {}) {
    const formData = new FormData();
    formData.append('document', file);
    
    for (const [key, value] of Object.entries(additionalFields)) {
        formData.append(key, value);
    }
    
    return formData;
}

/**
 * Process a document and get JSON results
 * @param {File|string} file - File object (Browser)
 */
async function processDocument(file) {
  try {
    const url = `${CONFIG.BASE_URL}/process`;
    console.log(`Sending document to ${url} (Proxy Mode)...`);

    const formData = createFormData(file);

    const response = await fetch(url, {
      method: 'POST',
      body: formData
      // Note: Content-Type header is set automatically by browser with boundary
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Processing failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log("Processing completed:", result.status);
    
    return result;

  } catch (error) {
    console.error("Document AI Error:", error);
    throw error;
  }
}

/**
 * Generate and download Excel report directly
 * @param {File|string} file - File object (Browser)
 */
async function processToExcel(file) {
  try {
    const url = `${CONFIG.BASE_URL}/excel`;
    console.log(`Requesting Excel from ${url} (Proxy Mode)...`);

    const formData = createFormData(file);

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Excel generation failed: ${response.status} ${errorText}`);
    }

    // Handle Blob for download
    const blob = await response.blob();
    
    if (typeof window !== 'undefined') {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = "processed_document.xlsx";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
    }
    
    return "Excel downloaded";

  } catch (error) {
    console.error("Excel Error:", error);
    throw error;
  }
}

/**
 * Generate and download Excel report using V2 Logic (Directly from Document AI)
 * @param {File|string} file - File object (Browser)
 */
async function processToExcelV2(file) {
  try {
    const url = `${CONFIG.BASE_URL}/v2/excel`;
    console.log(`Requesting V2 Excel from ${url} (Proxy Mode)...`);

    const formData = createFormData(file);

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`V2 Excel generation failed: ${response.status} ${errorText}`);
    }

    // Handle Blob for download
    const blob = await response.blob();
    
    if (typeof window !== 'undefined') {
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = "structured_" + (file.name || "document") + ".xlsx";
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadUrl);
        document.body.removeChild(a);
    }
    
    return "Excel V2 downloaded";
  } catch (error) {
    console.error("Document AI V2 Excel Error:", error);
    throw error;
  }
}

/**
 * Extract specific column (e.g., Description) from tables
 * @param {File|string} file - File object (Browser)
 * @param {string[]} keywords - Optional keywords to identify column (default: description, product)
 */
async function extractColumn(file, keywords = ["description", "product", "particulars", "item"]) {
  try {
    const url = `${CONFIG.BASE_URL}/extract-column`;
    console.log(`Extracting column data from ${url} (Proxy Mode)...`);

    const formData = createFormData(file, {
        keywords: JSON.stringify(keywords)
    });

    const response = await fetch(url, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Extraction failed: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    console.log(`Extracted ${result.count} items.`);
    return result.data; // Returns array of strings

  } catch (error) {
    console.error("Extraction Error:", error);
    throw error;
  }
}

/**
 * NEW: V2 Structure Analysis (Architecture 2.0)
 * Uses Geometry + Heuristics + ML Pipeline
 * Note: This might not have a proxy yet, so it tries direct or fails.
 * Updated to use proxy if available, or stay disabled/direct.
 */
async function analyzeStructure(fileObject) {
    // Currently no proxy endpoint for structure in server.js
    // We'll throw an error or try direct if needed, but for now let's warn.
    console.warn("Structure analysis proxy not implemented yet.");
    throw new Error("Structure analysis not available in Proxy Mode");
}

/**
 * Generates an HTML visualization of the document structure (Debug View)
 * Can be used by your app to display what the AI "sees".
 * @param {Object} apiResult - The full JSON result from processDocument()
 * @returns {string} HTML string representing the visual layout
 */
function generateVisualDebug(apiResult) {
  if (!apiResult || !apiResult.ocr_results) return "<div>No layout data available</div>";
  
  // Container mimicking a standard page (approx scale)
  let html = '<div style="position:relative; width:800px; height:1100px; border:1px solid #ccc; background:white; overflow:hidden; margin: 20px auto;">';
  
  apiResult.ocr_results.forEach(block => {
      if (block.bbox) {
           // Create a box for each detected text element
           const style = `position:absolute; 
                          left:${block.bbox.x}px; 
                          top:${block.bbox.y}px; 
                          width:${block.bbox.width}px; 
                          height:${block.bbox.height}px; 
                          border:1px dashed rgba(0,100,255,0.5); 
                          background: rgba(0,100,255,0.05);
                          font-size:10px; 
                          white-space:nowrap; 
                          overflow:hidden;
                          color:black;
                          font-family: sans-serif;
                          pointer-events:none;`;
           
           // Simple HTML escaping
           const text = String(block.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
           html += `<div style="${style}" title="${text}">${text}</div>`;
      }
  });
  
  html += '</div>';
  return html;
}

// Export for Node.js usage if needed
if (typeof module !== 'undefined') {
  module.exports = { processDocument, processToExcel, processToExcelV2, extractColumn, analyzeStructure, generateVisualDebug };
}

// Export for ES6 usage (Browser)
export { processDocument, processToExcel, processToExcelV2, extractColumn, analyzeStructure, generateVisualDebug };
