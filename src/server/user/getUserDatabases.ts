/**
 * Get User Databases — Solo Edition
 * In solo mode, each user has exactly one permanent database_id.
 * This function is kept for API compatibility but returns empty.
 * The admin_databases table was dropped in migration 012.
 */

export interface UserDatabase {
  database_id: string;
  database_name: string;
  database_location: string;
  role: string;
}

export const getUserDatabases = async (_userId: string): Promise<UserDatabase[]> => {
  return [];
};
