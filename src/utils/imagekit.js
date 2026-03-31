import ImageKit from "imagekit";
import dotenv from "dotenv";

dotenv.config();

const imagekit = new ImageKit({
    publicKey: process.env.IMAGEKIT_PUBLIC_KEY,
    privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
    urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT
});

/**
 * Uploads a base64 or buffer file to ImageKit.
 * @param {string} fileContent - Base64 string or file buffer.
 * @param {string} fileName - Name of the file.
 * @param {string} folder - Destination folder in ImageKit.
 * @returns {Promise<object>} - ImageKit upload response.
 */
export const uploadToImageKit = async (fileContent, fileName, folder = "/uploads") => {
    try {
        const response = await imagekit.upload({
            file: fileContent, // base64, buffer or remote URL
            fileName: fileName,
            folder: folder,
            useUniqueFileName: true
        });
        console.log(`[ImageKit] Upload Success: ${response.url}`);
        return response;
    } catch (error) {
        console.error("[ImageKit] Upload Error:", error);
        throw error;
    }
};

export default imagekit;
