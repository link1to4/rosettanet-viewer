/**
 * Firebase Firestore Service
 * Handles communication with Firebase Firestore for file storage.
 */

import { db } from '../firebase';
import { collection, doc, getDocs, getDoc, setDoc } from 'firebase/firestore';

const FILES_COLLECTION = 'files';

/**
 * Fetch list of HTML files from Firestore
 * @returns {Promise<Array<{name: string, updated: string}>>}
 */
export const getFiles = async () => {
    try {
        console.log("Fetching files from Firestore...");
        const querySnapshot = await getDocs(collection(db, FILES_COLLECTION));

        if (querySnapshot.empty) {
            console.log("No files found in Firestore");
            return [];
        }

        const files = querySnapshot.docs.map(doc => ({
            name: doc.id,
            updated: doc.data().updated || new Date().toISOString()
        }));

        return files;
    } catch (error) {
        console.error("Error fetching files from Firestore:", error);
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
        const docRef = doc(db, FILES_COLLECTION, filename);
        const docSnap = await getDoc(docRef);

        if (!docSnap.exists()) {
            throw new Error("File not found");
        }

        return docSnap.data().content || "";
    } catch (error) {
        console.error("Error fetching file content from Firestore:", error);
        throw error;
    }
};

/**
 * Save HTML content to Firestore
 * @param {string} filename 
 * @param {string} content 
 * @returns {Promise<boolean>} success
 */
export const saveFile = async (filename, content) => {
    try {
        const docRef = doc(db, FILES_COLLECTION, filename);
        await setDoc(docRef, {
            content: content,
            updated: new Date().toISOString()
        });

        console.log("File saved to Firestore:", filename);
        return true;
    } catch (error) {
        console.error("Error saving file to Firestore:", error);
        throw error;
    }
};
