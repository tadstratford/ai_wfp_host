import { scryptSync, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

// Encryption configuration
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;
const AUTH_TAG_LENGTH = 16;

const APP_SECRET = process.env.APP_SECRET;
if (!APP_SECRET) {
    throw new Error(
        "APP_SECRET is not set. Set a long, random APP_SECRET environment variable before starting the server.",
    );
}

// Derive a key from secret
// We could us just the secret if it is 32 bytes, but scrypt makes it robust against weak passwords
const getKey = (salt: Buffer) => scryptSync(APP_SECRET, salt, KEY_LENGTH);

export const encrypt = (text: string): string => {
    if (!text) return "";

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = getKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();

    // Format: salt:iv:authTag:encrypted
    return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
};

export const decrypt = (text: string): string => {
    if (!text) return "";

    const parts = text.split(':');
    if (parts.length !== 4) {
        // Fallback: If not formatted correctly, maybe return original?
        // Or throw error. Since we are transitioning, maybe it was plain text before?
        // For now, assume strict.
        // console.warn("Invalid encrypted text format, returning as is (potentially plain text?)");
        return text;
    }

    const [saltHex, ivHex, authTagHex, encryptedContent] = parts;

    try {
        const salt = Buffer.from(saltHex, 'hex');
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const key = getKey(salt);

        const decipher = createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedContent, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error("Decryption failed:", e);
        return "";
    }
};
