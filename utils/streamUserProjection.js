/**
 * Canonical Stream user projection.
 *
 * THE single definition of how a Postgres user row becomes a Stream user object.
 * Every writer — utils/syncUserToStream.js, jobs/streamSyncJob.js, scripts/ — imports
 * from here and contains no SQL of its own. Before this module there were three
 * copies of this query that disagreed on how company_name and visa_type_descr were
 * resolved, so the same user's Stream record flipped between values depending on
 * which writer ran last.
 *
 * Two rules this module enforces structurally, not by convention:
 *
 *   1. business_unit is CREATE-ONLY. It is set once, at registration, by
 *      buildCreatePayload(). buildUpdatePayload() never emits it, so no
 *      reconciliation path can ever rewrite it.
 *
 *   2. Updates are partial (set/unset), never a full replace. Stream's upsertUsers
 *      replaces the whole user object, silently dropping any attribute the writer
 *      does not know about (bu_access, and anything added later). Only the create
 *      path — where there is nothing to preserve — uses a full upsert.
 */

import env from "../config/env.js";
import { formatDisplayName } from "./formatDisplayName.js";

// ── SQL ───────────────────────────────────────────────────────────────────────

export const PROJECTION_SELECT = `
    a.id::text        AS user_id,
    a.email,
    a.business_unit,
    a.is_active,
    p.first_name,
    p.middle_name,
    p.last_name,
    p.user_type,
    p.country,
    p.company,
    p.batch_no,
    p.sending_org,
    v.visa_type,
    COALESCE(
      NULLIF(c.company_name ->> 'ja', ''),
      NULLIF(c.company_name ->> 'en', ''),
      (SELECT value FROM jsonb_each_text(c.company_name) WHERE value <> '' LIMIT 1)
    )                 AS company_name,
    COALESCE(
      NULLIF(vl.descr ->> 'ja', ''),
      NULLIF(vl.descr ->> 'en', ''),
      (SELECT value FROM jsonb_each_text(vl.descr) WHERE value <> '' LIMIT 1)
    )                 AS visa_type_descr,
    sa.s3_key         AS profile_pic_s3_key`;

/**
 * The company join compares normalized text, never casting untrusted p.company.
 *
 * p.company is a text column and PUT /profile/personal-info/:userId writes it with
 * no validation. Casting that text to uuid raises 22P02 on any malformed value,
 * which aborts the whole query — for the nightly job that means zero users sync,
 * every night, until the row is found. Casting the uuid column to text instead can
 * never raise. Lowercasing and trimming preserves matches for uppercase UUIDs
 * and surrounding whitespace without letting malformed input abort the query.
 *
 * The user_profile_tbl join is INNER on purpose: an account with no profile row has
 * no profile data to project, so it is skipped rather than written as a row of
 * nulls. This is what keeps a souser's Stream record (name, user_type, bu_access —
 * owned by souserService) from being flattened on every token fetch.
 */
export const PROJECTION_FROM = `
  FROM v4.user_account_tbl a
  JOIN v4.user_profile_tbl p ON p.user_id = a.id
  LEFT JOIN v4.company_tbl       c  ON c.company_id::text = lower(btrim(p.company))
  LEFT JOIN v4.user_visa_info_tbl v ON v.user_id = a.id
  LEFT JOIN v4.visa_list_tbl     vl ON vl.code = v.visa_type
                                   AND vl.business_unit = a.business_unit
  LEFT JOIN LATERAL (
    SELECT s3_key
    FROM v4.shared_attachments
    WHERE relation_type = 'profile'
      AND relation_id = a.id::text
    ORDER BY created_at DESC
    LIMIT 1
  ) sa ON true`;

/**
 * Anonymized accounts are excluded from every projection.
 *
 * loginService deletes their Stream user on purpose, so a partial update would
 * either fail or resurrect a record that was meant to be gone. Their profile row
 * is scrubbed but retained for foreign-key integrity, so they must be filtered
 * out here rather than relied on to disappear.
 */
const EXCLUDE_ANONYMIZED = `a.email NOT LIKE 'deleted\\_%'`;

/**
 * Composes a projection with a caller-supplied WHERE clause.
 * @param {string} where - SQL predicate, parameterized ($1, $2, …)
 */
export const projectionSql = (where) => `
  SELECT ${PROJECTION_SELECT}
  ${PROJECTION_FROM}
  WHERE ${EXCLUDE_ANONYMIZED}
    AND (${where})
  ORDER BY a.id`;

/** Projects one user. Takes $1 = user id. */
export const PROJECT_ONE_SQL = projectionSql("a.id = $1");

/**
 * Projects every user for full reconciliation — active AND inactive.
 *
 * Deactivating a user does not deactivate them in Stream, so filtering on
 * is_active here would freeze their Stream record at whatever it held on the day
 * they were deactivated, with no path back to correctness. Postgres is the source
 * of truth for deactivated users too.
 */
export const PROJECT_ALL_SQL = projectionSql("true");

/** Every user in one company. $1 = company id (text), $2 = business unit. */
export const PROJECT_BY_COMPANY_SQL = projectionSql(
  "c.company_id::text = lower(btrim($1::text)) AND a.business_unit = $2",
);

/** Every user on one visa code. $1 = visa code, $2 = business unit. */
export const PROJECT_BY_VISA_TYPE_SQL = projectionSql(
  "v.visa_type = $1 AND a.business_unit = $2",
);

// ── Payload building ──────────────────────────────────────────────────────────

/**
 * Resolves the permanent image URL for a projected row.
 * CloudFront when configured; otherwise the backend proxy route, which mints a
 * fresh signed S3 URL per request. Returns null when the user has no avatar.
 */
export const resolveImageUrl = (row) => {
  if (!row.profile_pic_s3_key) return null;
  return env.aws.cloudfrontDomain
    ? `https://${env.aws.cloudfrontDomain}/${row.profile_pic_s3_key}`
    : `${env.app.backendUrl}/profile/avatar/${row.user_id}`;
};

/**
 * Every attribute Postgres owns on a Stream user, except business_unit.
 * Order is the order they appear in the Stream dashboard, for readability.
 *
 * Exported so scripts/reconcileStreamVsDb.js diffs against exactly what the
 * writers write — an audit built from its own field list could drift from them.
 */
export const projectAttributes = (row) => ({
  name:            formatDisplayName(row.last_name, row.first_name, row.middle_name),
  email:           row.email?.toLowerCase().trim() ?? null,
  image:           resolveImageUrl(row),
  user_type:       row.user_type,
  company:         row.company,
  company_name:    row.company_name,
  batch_no:        row.batch_no,
  sending_org:     row.sending_org,
  visa_type:       row.visa_type,
  visa_type_descr: row.visa_type_descr,
  country:         row.country,
});

/** null, undefined and "" all mean "Postgres has no value here". */
const isAbsent = (v) => v === null || v === undefined || v === "";

/**
 * Builds a Stream partial-update payload from a projected row.
 *
 * Fields with a value go in `set`; fields Postgres has cleared go in `unset`, so
 * reconciliation still removes stale metadata without touching attributes this
 * projection knows nothing about. business_unit is never emitted.
 *
 * @param   {object} row - a row from PROJECT_ONE_SQL / PROJECT_ALL_SQL
 * @returns {{ id: string, set?: object, unset?: string[] } | null}
 *          null when there is nothing to write (caller should skip the user).
 */
export const buildUpdatePayload = (row) => {
  if (!row?.user_id) return null;

  const set = {};
  const unset = [];

  for (const [key, value] of Object.entries(projectAttributes(row))) {
    if (isAbsent(value)) unset.push(key);
    else set[key] = value;
  }

  if (!Object.keys(set).length && !unset.length) return null;

  return {
    id: String(row.user_id),
    ...(Object.keys(set).length ? { set } : {}),
    ...(unset.length ? { unset } : {}),
  };
};

/**
 * Builds the full user object for a brand-new Stream user.
 *
 * This is the ONLY payload that carries business_unit — there is no existing
 * record to preserve, so a full upsert is correct here and only here.
 *
 * @param   {object} row - a row from PROJECT_ONE_SQL
 * @returns {object} a Stream user object, suitable for upsertUser()
 */
export const buildCreatePayload = (row) => {
  const user = { id: String(row.user_id), business_unit: row.business_unit };

  for (const [key, value] of Object.entries(projectAttributes(row))) {
    if (!isAbsent(value)) user[key] = value;
  }

  return user;
};
