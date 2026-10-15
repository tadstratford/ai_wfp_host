/**
 * Authentication — Area 2
 *
 * Barrel exports for auth-related functions.
 * During V2 migration, these re-export from their current locations (admin/, user/, crypto/).
 * New code should import from "@backend/core/auth/" directly.
 *
 * See docs/2-authentication.md for specification.
 */

// User account management (Supabase)
export { userManager } from "../admin/userManager";

// Supabase client
export * as supabase from "../admin/supabase";

// User profile and LLM config
export { getLLMConfigByDatabaseId } from "../user/getLLMApiKey";

// Encryption for API keys and secrets
export { encrypt, decrypt } from "../../shared/crypto/index";
