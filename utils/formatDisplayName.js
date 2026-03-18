/**
 * Returns true if the string contains characters outside the Latin script
 * (Basic Latin through Latin Extended Additional, U+0000–U+024F).
 * Covers CJK, Japanese kana, Thai, Arabic, Devanagari, etc.
 */
const isNonRoman = (str) => /[^\u0000-\u024F]/.test(str ?? "");

/**
 * Formats a display name as: LastName, FirstName MiddleName
 *
 * Constraints:
 *  - No firstName → LastName only (no comma)
 *  - Non-Roman characters in any name part → no comma (space-separated)
 */
export const formatDisplayName = (lastName, firstName, middleName) => {
  const last = lastName?.trim() ?? "";
  const first = firstName?.trim() ?? "";
  const mid = middleName?.trim() ?? "";

  if (!last) return [first, mid].filter(Boolean).join(" ");

  const givenName = [first, mid].filter(Boolean).join(" ");

  if (isNonRoman(last) || isNonRoman(first) || isNonRoman(mid)) {
    return [last, givenName].filter(Boolean).join(" ");
  }

  if (!first) return last;

  return `${last}, ${givenName}`;
};
