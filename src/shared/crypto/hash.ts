/**
 * Password Hashing Utilities
 * Uses Bun's built-in password hashing
 */

export async function hashPassword(password: string): Promise<string> {
    return await Bun.password.hash(password, {
        algorithm: "bcrypt",
        cost: 10
    });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
    return await Bun.password.verify(password, hash);
}
