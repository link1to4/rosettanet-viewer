# RosettaNet Viewer

A React-based viewer for RosettaNet specifications (HTML/Text format). Parses and displays the tree structure of RosettaNet message definitions.

## Features

- **Upload & Parse**: Supports `.htm`, `.html` and `.txt` files containing RosettaNet table definitions.
- **Tree View**: Visualize the hierarchical structure (indentation based on pipe `|` characters).
- **Search**:
  - Keyword search
  - Path search (e.g., `/Pip3A4/ServiceHeader/ProcessControl`)
  - Auto-resolve `Choice` nodes
- **Google Sheets Integration**: Load and save templates directly to a Google Sheet.

## Setup

1.  Clone the repository.
2.  `npm install`
3.  `npm run dev`

## Google Sheets Integration Setup

To enable "Save to Cloud" feature:

1.  **Create a Google Sheet**:
    - Build a new Sheet.
    - Rename the tab to `HTML_Files` (Optional, script defaults to first tab or specific name).
    - Columns: `A: Filename`, `B: Content`, `C: UpdatedAt`.

2.  **Apps Script**:
    - Extensions > Apps Script.
    - Copy the code from `GAS_CODE_EXAMPLE` section below into `Code.gs`.
    - **Deploy**:
        - Click `Deploy` > `New deployment`.
        - Select type: `Web app`.
        - Description: `v1`.
        - Execute as: `Me` (your account).
        - **Who has access**: `Anyone` (Important for CORS).
        - Copy the **Web App URL**.

3.  **Environment Variable**:
    - Create a `.env` file in the project root.
    - Add: `VITE_GAS_WEB_APP_URL=https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec`

### GAS Backend Code (`Code.gs`)

```javascript
/**
 * GAS Backend for RosettaNet Html Storage
 * 
 * Setup:
 * 1. Create a Sheet named "Files" (or it will use the first sheet).
 * 2. Columns: A=Name, B=Content, C=Updated
 */

const SHEET_NAME = "Files";

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);

  try {
    const action = e.parameter.action || (e.postData && JSON.parse(e.postData.contents).action);
    
    // CORS Headers
    const headers = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Content-Type": "application/json"
    };

    if (e.parameter.action === "options") {
       return ContentService.createTextOutput("").setMimeType(ContentService.MimeType.TEXT);
    }
    
    let result = {};

    if (action === "list") {
      result = listFiles();
    } else if (action === "get") {
      const filename = e.parameter.filename;
      result = getFile(filename);
    } else if (action === "save") {
      const data = JSON.parse(e.postData.contents);
      result = saveFile(data.filename, data.content);
    } else {
      result = { status: "error", message: "Invalid action" };
    }

    return ContentService.createTextOutput(JSON.stringify(result))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error", 
      message: err.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(["Name", "Content", "Updated"]); // Header
  }
  return sheet;
}

function listFiles() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  // Skip header
  const files = [];
  for (let i = 1; i < data.length; i++) {
    if (data[i][0]) {
      files.push({
        name: data[i][0],
        updated: data[i][2]
      });
    }
  }
  return { status: "success", files: files };
}

function getFile(filename) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === filename) {
      return { status: "success", content: data[i][1] };
    }
  }
  return { status: "error", message: "File not found" };
}

function saveFile(filename, content) {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  const timestamp = new Date().toISOString();
  
  // Check if exists
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === filename) {
      sheet.getRange(i + 1, 2).setValue(content);
      sheet.getRange(i + 1, 3).setValue(timestamp);
      return { status: "success", message: "Updated" };
    }
  }
  
  // Create new
  sheet.appendRow([filename, content, timestamp]);
  return { status: "success", message: "Created" };
}
```
