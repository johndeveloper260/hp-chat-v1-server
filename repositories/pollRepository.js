import { getPool } from "../config/getPool.js";
import { formatDisplayName } from "../utils/formatDisplayName.js";

const db = (client) => client ?? getPool();

/** Options arrive as { label, requires_note } (validator-normalised). */
const insertOptions = async (pollId, options, client) => {
  for (const [sortOrder, option] of options.entries()) {
    await db(client).query(
      `INSERT INTO v4.announcement_poll_option_tbl (poll_id, label, sort_order, requires_note) VALUES ($1::uuid, $2, $3, $4)`,
      [pollId, option.label, sortOrder, Boolean(option.requires_note)],
    );
  }
};

const hydrate = (row) => row ? {
  ...row,
  has_responses: Boolean(row.has_responses),
  options: row.options ?? [],
  total_respondents: Number(row.total_respondents ?? 0),
  my_option_ids: row.my_option_ids ?? [],
  my_notes: row.my_notes ?? {},
  has_responded: Boolean(row.has_responded),
} : null;

export const findPollByAnnouncement = async (rowId, businessUnit, client, userId = null) => {
  const { rows } = await db(client).query(
    `SELECT p.*,
       EXISTS (SELECT 1 FROM v4.announcement_poll_response_tbl r WHERE r.poll_id = p.poll_id) AS has_responses,
       (SELECT COUNT(DISTINCT r.user_id) FROM v4.announcement_poll_response_tbl r WHERE r.poll_id = p.poll_id) AS total_respondents,
       COALESCE((SELECT json_agg(json_build_object('option_id', o.option_id, 'label', o.label,
         'sort_order', o.sort_order, 'requires_note', o.requires_note,
         'count', (SELECT COUNT(*) FROM v4.announcement_poll_response_tbl r WHERE r.option_id = o.option_id))
         ORDER BY o.sort_order) FROM v4.announcement_poll_option_tbl o WHERE o.poll_id = p.poll_id), '[]') AS options,
       COALESCE((SELECT array_agg(r.option_id ORDER BY o.sort_order) FROM v4.announcement_poll_response_tbl r
         JOIN v4.announcement_poll_option_tbl o ON o.option_id = r.option_id
         WHERE r.poll_id = p.poll_id AND r.user_id = $3::uuid), ARRAY[]::uuid[]) AS my_option_ids,
       COALESCE((SELECT json_object_agg(r.option_id, r.note) FROM v4.announcement_poll_response_tbl r
         WHERE r.poll_id = p.poll_id AND r.user_id = $3::uuid AND r.note IS NOT NULL), '{}') AS my_notes,
       EXISTS (SELECT 1 FROM v4.announcement_poll_response_tbl r WHERE r.poll_id = p.poll_id AND r.user_id = $3::uuid) AS has_responded
     FROM v4.announcement_poll_tbl p
     WHERE p.announcement_id = $1::integer AND p.business_unit = $2`,
    [rowId, businessUnit, userId],
  );
  return hydrate(rows[0]);
};

export const insertPoll = async ({ announcementId, businessUnit, question, allowMultiple, closesAt, options, userId }, client) => {
  const { rows } = await db(client).query(
    `INSERT INTO v4.announcement_poll_tbl (announcement_id, business_unit, question, allow_multiple, closes_at, created_by)
     VALUES ($1::integer, $2, $3, $4, $5, $6::uuid) RETURNING *`,
    [announcementId, businessUnit, question, allowMultiple, closesAt ?? null, userId],
  );
  await insertOptions(rows[0].poll_id, options, client);
  return rows[0];
};

export const replacePollDefinition = async ({ pollId, question, allowMultiple, closesAt, options, userId }, client) => {
  await db(client).query(`DELETE FROM v4.announcement_poll_option_tbl WHERE poll_id = $1::uuid`, [pollId]);
  await db(client).query(
    `UPDATE v4.announcement_poll_tbl SET question=$2, allow_multiple=$3, closes_at=$4, updated_by=$5::uuid, updated_at=NOW() WHERE poll_id=$1::uuid`,
    [pollId, question, allowMultiple, closesAt ?? null, userId],
  );
  await insertOptions(pollId, options, client);
};

export const updatePollClosesAt = async (pollId, closesAt, userId, client) => {
  await db(client).query(`UPDATE v4.announcement_poll_tbl SET closes_at=$2, updated_by=$3::uuid, updated_at=NOW() WHERE poll_id=$1::uuid`, [pollId, closesAt ?? null, userId]);
};
export const deletePoll = async (pollId, client) => db(client).query(`DELETE FROM v4.announcement_poll_tbl WHERE poll_id=$1::uuid`, [pollId]);
export const countPollResponses = async (pollId, client) => {
  const { rows } = await db(client).query(`SELECT COUNT(DISTINCT user_id) AS count FROM v4.announcement_poll_response_tbl WHERE poll_id=$1::uuid`, [pollId]);
  return Number(rows[0]?.count ?? 0);
};
export const findMyResponse = async (pollId, userId, client) => {
  const { rows } = await db(client).query(
    `SELECT COALESCE(array_agg(r.option_id ORDER BY o.sort_order), ARRAY[]::uuid[]) AS option_ids,
       COALESCE(json_object_agg(r.option_id, r.note) FILTER (WHERE r.note IS NOT NULL), '{}') AS notes,
       MAX(r.responded_at) AS responded_at
     FROM v4.announcement_poll_response_tbl r JOIN v4.announcement_poll_option_tbl o ON o.option_id=r.option_id
     WHERE r.poll_id=$1::uuid AND r.user_id=$2::uuid`, [pollId, userId]);
  return rows[0] ?? { option_ids: [], notes: {}, responded_at: null };
};
/**
 * @param {Record<string,string>} [notes] option_id → explanation. Stored as
 *   NULL when absent or blank so "no note" is one value, not two.
 */
export const replaceUserResponse = async ({ pollId, userId, optionIds, notes = {}, businessUnit }, client) => {
  await deleteUserResponse(pollId, userId, client);
  const noteList = optionIds.map((id) => {
    const note = typeof notes[id] === "string" ? notes[id].trim() : "";
    return note.length ? note : null;
  });
  const { rows } = await db(client).query(
    `INSERT INTO v4.announcement_poll_response_tbl (poll_id,user_id,option_id,note,business_unit)
     SELECT $1::uuid,$2::uuid,o.option_id,o.note,$5
     FROM unnest($3::uuid[], $4::text[]) AS o(option_id, note)
     RETURNING responded_at`, [pollId, userId, optionIds, noteList, businessUnit]);
  const storedNotes = Object.fromEntries(optionIds.flatMap((id, i) => noteList[i] ? [[id, noteList[i]]] : []));
  return { option_ids: optionIds, notes: storedNotes, responded_at: rows[0]?.responded_at ?? null };
};
export const deleteUserResponse = async (pollId, userId, client) => db(client).query(
  `DELETE FROM v4.announcement_poll_response_tbl WHERE poll_id=$1::uuid AND user_id=$2::uuid`, [pollId, userId]);
export const setPollLock = async (pollId, locked, userId, client) => {
  const { rows } = await db(client).query(
    `UPDATE v4.announcement_poll_tbl SET is_locked=$2, locked_at=CASE WHEN $2 THEN NOW() ELSE NULL END,
     locked_by=CASE WHEN $2 THEN $3::uuid ELSE NULL END, updated_by=$3::uuid, updated_at=NOW()
     WHERE poll_id=$1::uuid RETURNING poll_id,is_locked,locked_at,locked_by`, [pollId, locked, userId]);
  return rows[0];
};

export const findPollResults = async (pollId, lang, client) => {
  const { rows } = await db(client).query(
    `SELECT o.option_id,o.label,o.sort_order,o.requires_note,r.user_id AS id,r.note,
       COALESCE(p.first_name,su.first_name) AS fn,p.middle_name AS mn,COALESCE(p.last_name,su.last_name) AS ln,
       COALESCE(c.company_name->>$2,c.company_name->>'en',su.sending_org) AS company,r.responded_at
     FROM v4.announcement_poll_option_tbl o LEFT JOIN v4.announcement_poll_response_tbl r ON r.option_id=o.option_id
     LEFT JOIN v4.user_profile_tbl p ON p.user_id=r.user_id LEFT JOIN v4.souser_tbl su ON su.id=r.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid=c.company_id WHERE o.poll_id=$1::uuid ORDER BY o.sort_order,r.responded_at`, [pollId, lang]);
  const options = [];
  for (const row of rows) {
    let option = options.at(-1);
    if (!option || String(option.option_id) !== String(row.option_id)) {
      option = { option_id: row.option_id, label: row.label, sort_order: row.sort_order, requires_note: Boolean(row.requires_note), count: 0, respondents: [] };
      options.push(option);
    }
    if (row.id) { option.count++; option.respondents.push({ id: row.id, name: formatDisplayName(row.ln,row.fn,row.mn), company: row.company, note: row.note ?? null, responded_at: row.responded_at }); }
  }
  const total_respondents = new Set(options.flatMap((o) => o.respondents.map((r) => String(r.id)))).size;
  return { options, total_respondents };
};

export const findPollExportRows = async (pollId, lang, client) => {
  const { rows } = await db(client).query(
    `SELECT COALESCE(p.first_name,su.first_name) AS fn,p.middle_name AS mn,COALESCE(p.last_name,su.last_name) AS ln,
       COALESCE(c.company_name->>$2,c.company_name->>'en',su.sending_org) AS company,COALESCE(p.sending_org,su.sending_org) AS sending_org,p.country,p.batch_no,o.label AS option,r.note,r.responded_at
     FROM v4.announcement_poll_response_tbl r JOIN v4.announcement_poll_option_tbl o ON o.option_id=r.option_id
     LEFT JOIN v4.user_profile_tbl p ON p.user_id=r.user_id LEFT JOIN v4.souser_tbl su ON su.id=r.user_id
     LEFT JOIN v4.company_tbl c ON p.company::uuid=c.company_id WHERE r.poll_id=$1::uuid ORDER BY r.responded_at,ln,fn,o.sort_order`, [pollId,lang]);
  return rows.map(({ fn,mn,ln,...row }) => ({ ...row, respondent_name: formatDisplayName(ln,fn,mn) }));
};
