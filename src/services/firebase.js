/**
 * Firebase Service
 * Handles communication with Firebase Realtime Database for file storage.
 */

import { database } from '../firebase';
import { ref, get, set, child } from 'firebase/database';

/**
 * Encode filename for Firebase path (replace invalid characters)
 * Firebase paths cannot contain: . # $ [ ]
 */
const encodeFilename = (filename) => {
    return filename
        .replace(/\./g, '_DOT_')
        .replace(/#/g, '_HASH_')
        .replace(/\$/g, '_DOLLAR_')
        .replace(/\[/g, '_LBRACKET_')
        .replace(/\]/g, '_RBRACKET_');
};

/**
 * Decode filename from Firebase path
 */
const decodeFilename = (encoded) => {
    return encoded
        .replace(/_DOT_/g, '.')
        .replace(/_HASH_/g, '#')
        .replace(/_DOLLAR_/g, '$')
        .replace(/_LBRACKET_/g, '[')
        .replace(/_RBRACKET_/g, ']');
};

/**
 * Fetch list of HTML files from Firebase
 * @returns {Promise<Array<{name: string, updated: string}>>}
 */
export const getFiles = async () => {
    try {
        console.log("Fetching files from Firebase...");
        const dbRef = ref(database);
        const snapshot = await get(child(dbRef, 'files'));

        if (!snapshot.exists()) {
            console.log("No files found in Firebase");
            return [];
        }

        const data = snapshot.val();
        const files = Object.keys(data).map(key => ({
            name: decodeFilename(key),  // Decode the filename for display
            updated: data[key].updated || new Date().toISOString()
        }));

        return files;
    } catch (error) {
        console.error("Error fetching files from Firebase:", error);
        throw error;
    }
};

/**
 * Get specific file content
 * @param {string} filename 
 * @returns {Promise<string>} HTML content
 */
export const getFile = async (filename) => {
    try {
        const encodedName = encodeFilename(filename);
        const dbRef = ref(database);
        const snapshot = await get(child(dbRef, `files/${encodedName}`));

        if (!snapshot.exists()) {
            throw new Error("File not found");
        }

        const data = snapshot.val();
        return data.content || "";
    } catch (error) {
        console.error("Error fetching file content from Firebase:", error);
        throw error;
    }
};

/**
 * Save HTML content to Firebase
 * @param {string} filename 
 * @param {string} content 
 * @returns {Promise<boolean>} success
 */
export const saveFile = async (filename, content) => {
    try {
        const encodedName = encodeFilename(filename);
        const fileRef = ref(database, `files/${encodedName}`);
        await set(fileRef, {
            content: content,
            updated: new Date().toISOString()
        });

        console.log("File saved to Firebase:", filename, "as", encodedName);
        return true;
    } catch (error) {
        console.error("Error saving file to Firebase:", error);
        throw error;
    }
};
