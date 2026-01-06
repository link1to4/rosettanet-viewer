/**
 * Google Apps Script Service
 * Handles communication with the GAS backend for file storage.
 */

const GAS_URL = import.meta.env.VITE_GAS_WEB_APP_URL;

/**
 * Fetch list of HTML files from Google Sheets
 * @returns {Promise<Array<{name: string, updated: string}>>}
 */
export const getFiles = async () => {
    if (!GAS_URL) {
        console.warn("VITE_GAS_WEB_APP_URL is not set. Check .env and restart dev server.");
        alert("Configuration Error: VITE_GAS_WEB_APP_URL is missing. Please restart 'npm run dev' or check .env");
        return [];
    }

    try {
        console.log("Fetching files from:", GAS_URL);
        const response = await fetch(`${GAS_URL}?action=list`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data.status !== "success") throw new Error(data.message || "Unknown error detected in response");

        return data.files || [];
    } catch (error) {
        console.error("Error fetching files. Ensure GAS Script is deployed as 'Anyone'.", error);
        throw error;
    }
};

/**
 * Get specific file content
 * @param {string} filename 
 * @returns {Promise<string>} HTML content
 */
export const getFile = async (filename) => {
    if (!GAS_URL) return "";

    try {
        const response = await fetch(`${GAS_URL}?action=get&filename=${encodeURIComponent(filename)}`);
        if (!response.ok) throw new Error("Failed to fetch file content");

        const data = await response.json();
        if (data.status !== "success") throw new Error(data.message || "Unknown error");

        return data.content || "";
    } catch (error) {
        console.error("Error fetching file content:", error);
        throw error;
    }
};

/**
 * Save HTML content to Google Sheets
 * @param {string} filename 
 * @param {string} content 
 * @returns {Promise<boolean>} success
 */
export const saveFile = async (filename, content) => {
    if (!GAS_URL) {
        console.error("VITE_GAS_WEB_APP_URL is missing.");
        return false;
    }

    try {
        // Use text/plain to avoid CORS preflight (OPTIONS) request, which GAS doesn't handle well.
        // The data is still JSON stringified, so GAS can parse it.
        const response = await fetch(GAS_URL, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=utf-8",
            },
            body: JSON.stringify({
                action: "save",
                filename,
                content
            })
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        if (data.status !== "success") throw new Error(data.message || "Unknown error");

        return true;
    } catch (error) {
        console.error("Error saving file:", error);
        throw error;
    }
};
