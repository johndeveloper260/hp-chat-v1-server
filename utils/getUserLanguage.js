// backend/utils/getUserLanguage.js
import { getPool } from "../config/getPool.js";

export const getUserLanguage = async (userId) => {
  try {
    const result = await getPool().query(
      "SELECT preferred_language FROM v4.user_account_tbl WHERE id = $1",
      [userId],
    );
    return result.rows[0]?.preferred_language || "en";
  } catch (error) {
    console.error("Error fetching language:", error);
    return "en";
  }
};
