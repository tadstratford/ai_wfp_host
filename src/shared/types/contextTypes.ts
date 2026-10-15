import type { User } from "./userTypes";

// Extend Hono context types to include user
declare module "hono" {
    interface ContextVariableMap {
        user: User;
    }
}
