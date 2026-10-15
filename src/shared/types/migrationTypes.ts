import { Database } from "bun:sqlite";

/**
 * Migration function signature
 */
export type MigrationFunction = (db: Database) => void;

/**
 * Migration definition
 */
export interface Migration {
    version: number;
    name: string;
    description?: string;
    up: MigrationFunction;
    down?: MigrationFunction; // Optional rollback function
}

/**
 * Migration record stored in schema_migrations table
 */
export interface MigrationRecord {
    version: number;
    name: string;
    applied_at: string;
    checksum: string;
    execution_time_ms: number;
    migration_type: "app" | "admin";
}

/**
 * Migration runner options
 */
export interface MigrationRunnerOptions {
    dryRun?: boolean;
    verbose?: boolean;
}
