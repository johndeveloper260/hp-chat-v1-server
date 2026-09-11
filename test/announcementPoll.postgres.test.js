/**
 * Announcement polls against real Postgres (PGlite, in-memory).
 *
 * The poll repository is all SQL, so the recording stand-in used elsewhere
 * cannot prove it returns the right rows. This applies the real migration and
 * drives pollRepository + the cascade delete end to end.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import * as feed from "../repositories/feedRepository.js";
import * as polls from "../repositories/pollRepository.js";
import { projectPollForViewer, isPollOpen } from "../utils/pollProjection.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("PostgreSQL: poll lifecycle — create, respond, change, lock, results, export, cascade", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA v4;
    CREATE TABLE v4.user_account_tbl (id uuid PRIMARY KEY, email text, business_unit text, is_active boolean DEFAULT true);
    CREATE TABLE v4.user_profile_tbl (user_id uuid PRIMARY KEY, first_name text, middle_name text, last_name text, user_type text, sending_org text, country text, company text, batch_no text);
    CREATE TABLE v4.souser_tbl (id uuid PRIMARY KEY, first_name text, last_name text, sending_org text, country text);
    CREATE TABLE v4.souser_bu_access_tbl (souser_id uuid, business_unit text, announcements_write boolean, announcements_read boolean, revoked_at timestamptz);
    CREATE TABLE v4.company_tbl (company_id uuid PRIMARY KEY, company_name jsonb, sort_order integer);
    CREATE TABLE v4.announcement_tbl (row_id serial PRIMARY KEY, business_unit text, company text[], batch_no text, country text[], sending_org text, created_by_sending_org text, title text, content_text text, reactions jsonb, date_from date, date_to date, active boolean DEFAULT true, comments_on boolean DEFAULT true, created_by uuid, created_at timestamptz DEFAULT now(), last_updated_by uuid, last_updated_at timestamptz);
    CREATE TABLE v4.shared_comments (relation_id integer, relation_type text, business_unit text);
    CREATE TABLE v4.announcement_views (announcement_id integer, user_id uuid, business_unit text);
    CREATE TABLE v4.announcement_favorites (row_id integer, user_id uuid);
    CREATE TABLE v4.shared_attachments (attachment_id uuid, relation_type text, relation_id text, s3_key text, s3_bucket text, display_name text, file_type text, created_at timestamptz, business_unit text);
    CREATE TABLE v4.notification_history_tbl (relation_id text, relation_type text, business_unit text);
  `);
  for (const file of ["20260911_announcement_poll.sql", "20260911_poll_option_note.sql"]) {
    const migration = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration); // idempotent re-run
  }

  // 1 = USER Alice (company 20), 2 = USER Bob, 3 = SOUSER, 5 = officer
  await db.query("INSERT INTO v4.company_tbl VALUES ($1, '{\"en\":\"Acme\",\"ja\":\"アクメ\"}', 1)", [id(20)]);
  for (const n of [1, 2, 3, 5]) {
    await db.query("INSERT INTO v4.user_account_tbl(id,email,business_unit) VALUES($1,$2,'BU')", [id(n), `u${n}@example.test`]);
  }
  await db.query("INSERT INTO v4.user_profile_tbl(user_id,first_name,last_name,user_type,sending_org,country,company,batch_no) VALUES ($1,'Alice','Anders','USER','ORG','VN',$3,'B1'),($2,'Bob','Brown','USER','ORG','VN',$3,'B1'),($4,'Olive','Officer','OFFICER',NULL,NULL,NULL,NULL)", [id(1), id(2), id(20), id(5)]);
  await db.query("INSERT INTO v4.souser_tbl(id,first_name,last_name,sending_org,country) VALUES ($1,'Sam','Souser','ORG','PH')", [id(3)]);

  const { rows: [ann] } = await db.query(
    "INSERT INTO v4.announcement_tbl(business_unit,title,created_by,active,date_from,date_to) VALUES ('BU','Shift poll',$1,true,CURRENT_DATE - 1,CURRENT_DATE + 7) RETURNING *",
    [id(5)],
  );
  const rowId = ann.row_id;

  // ── create ──
  const created = await polls.insertPoll({
    announcementId: rowId, businessUnit: "BU", question: "Which shift?",
    allowMultiple: false, closesAt: null,
    options: [{ label: "Morning", requires_note: false }, { label: "Night", requires_note: true }], userId: id(5),
  }, db);
  assert.ok(created.poll_id);

  let poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(poll.question, "Which shift?");
  assert.deepEqual(poll.options.map((o) => o.label), ["Morning", "Night"]);
  assert.deepEqual(poll.options.map((o) => o.requires_note), [false, true]);
  assert.deepEqual(poll.my_notes, {});
  assert.equal(poll.has_responses, false);
  assert.equal(poll.has_responded, false);
  assert.deepEqual(poll.my_option_ids, []);
  assert.equal(poll.total_respondents, 0);
  assert.equal(await polls.findPollByAnnouncement(rowId, "OTHER", db, id(1)), null, "BU-bounded");
  const [morning, night] = poll.options.map((o) => o.option_id);

  // ── the feed carries the same poll, counts intact at SQL level ──
  const feedRows = await feed.findAnnouncements({ lang: "en", userId: id(1), company_filter: null, businessUnits: ["BU"], isOfficer: false, isManagement: false, souser: null, client: db });
  assert.equal(feedRows.length, 1);
  assert.equal(feedRows[0].poll.question, "Which shift?");
  assert.equal(feedRows[0].poll.options[0].count, 0);
  assert.equal(feedRows[0].poll.options[1].requires_note, true);
  assert.deepEqual(feedRows[0].poll.my_notes, {});

  // ── respond / change / second respondent ──
  let mine = await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(1), optionIds: [morning], businessUnit: "BU" }, db);
  assert.deepEqual(mine.option_ids, [morning]);
  assert.ok(mine.responded_at);
  mine = await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(1), optionIds: [night], notes: { [night]: "  I study by day  " }, businessUnit: "BU" }, db);
  assert.deepEqual(mine.notes, { [night]: "I study by day" }, "note is trimmed");
  const stored = await polls.findMyResponse(poll.poll_id, id(1), db);
  assert.deepEqual(stored.option_ids, [night], "response replaced, not appended");
  assert.deepEqual(stored.notes, { [night]: "I study by day" });
  await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(2), optionIds: [morning], businessUnit: "BU" }, db);
  await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(3), optionIds: [morning], businessUnit: "BU" }, db);

  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(poll.has_responses, true);
  assert.equal(poll.has_responded, true);
  assert.deepEqual(poll.my_option_ids, [night]);
  assert.deepEqual(poll.my_notes, { [night]: "I study by day" });
  assert.equal(poll.total_respondents, 3);
  assert.deepEqual(poll.options.map((o) => Number(o.count)), [2, 1]);
  assert.equal(await polls.countPollResponses(poll.poll_id, db), 3);

  const none = await polls.findMyResponse(poll.poll_id, id(5), db);
  assert.deepEqual(none.option_ids, []);
  assert.equal(none.responded_at, null);

  // ── projection: respondents never see counts, officers do ──
  const forUser = projectPollForViewer(poll, ann, { userType: "USER" });
  assert.deepEqual(forUser.options.map((o) => o.requires_note), [false, true]);
  assert.deepEqual(forUser.my_notes, { [night]: "I study by day" }, "own note comes back for editing");
  assert.equal("total_respondents" in forUser, false);
  assert.ok(forUser.options.every((o) => !("count" in o)));
  assert.equal(forUser.is_open, true);
  for (const k of ["business_unit", "created_by", "locked_by", "updated_by", "announcement_id"]) {
    assert.equal(k in forUser, false, `internal column ${k} must not reach the client`);
  }
  const forOfficer = projectPollForViewer(poll, ann, { userType: "OFFICER" });
  assert.equal(forOfficer.total_respondents, 3);
  assert.deepEqual(forOfficer.options.map((o) => o.count), [2, 1]);

  // ── lock / unlock ──
  const locked = await polls.setPollLock(poll.poll_id, true, id(5), db);
  assert.equal(locked.is_locked, true);
  assert.ok(locked.locked_at);
  assert.equal(locked.locked_by, id(5));
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(isPollOpen(poll, ann), false);
  const unlocked = await polls.setPollLock(poll.poll_id, false, id(5), db);
  assert.equal(unlocked.is_locked, false);
  assert.equal(unlocked.locked_at, null);
  assert.equal(unlocked.locked_by, null);

  // ── closes_at ──
  await polls.updatePollClosesAt(poll.poll_id, "2020-01-01T00:00:00Z", id(5), db);
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(isPollOpen(poll, ann), false, "past closes_at closes the poll");
  await polls.updatePollClosesAt(poll.poll_id, null, id(5), db);
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(isPollOpen(poll, ann), true);

  // ── results ──
  const results = await polls.findPollResults(poll.poll_id, "ja", db);
  assert.equal(results.total_respondents, 3);
  const byLabel = Object.fromEntries(results.options.map((o) => [o.label, o]));
  assert.equal(byLabel.Morning.count, 2);
  assert.equal(byLabel.Night.count, 1);
  assert.deepEqual(byLabel.Night.respondents.map((r) => r.name), ["Anders, Alice"]);
  assert.equal(byLabel.Night.respondents[0].note, "I study by day");
  assert.equal(byLabel.Night.requires_note, true);
  assert.equal(byLabel.Morning.respondents[0].note, null, "no note stored as null, not empty string");
  assert.equal(byLabel.Night.respondents[0].company, "アクメ", "company in caller language");
  const sam = byLabel.Morning.respondents.find((r) => r.id === id(3));
  assert.equal(sam.company, "ORG", "SOUSER falls back to sending_org");
  assert.equal(sam.name, "Souser, Sam");

  // ── export ──
  const exportRows = await polls.findPollExportRows(poll.poll_id, "en", db);
  assert.equal(exportRows.length, 3);
  const alice = exportRows.find((r) => r.respondent_name === "Anders, Alice");
  assert.equal(alice.option, "Night");
  assert.equal(alice.note, "I study by day");
  assert.equal(alice.company, "Acme");
  assert.equal(alice.sending_org, "ORG");
  assert.equal(alice.country, "VN");
  assert.equal(alice.batch_no, "B1");

  // ── withdraw ──
  await polls.deleteUserResponse(poll.poll_id, id(1), db);
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(poll.has_responded, false);
  assert.equal(poll.total_respondents, 2);

  // ── multi-select stores one row per option ──
  await db.query("UPDATE v4.announcement_poll_tbl SET allow_multiple = true WHERE poll_id = $1", [poll.poll_id]);
  await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(1), optionIds: [morning, night], businessUnit: "BU" }, db);
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.deepEqual(poll.my_option_ids, [morning, night]);
  assert.equal(poll.total_respondents, 3, "one respondent, two options");
  assert.deepEqual(poll.options.map((o) => Number(o.count)), [3, 1]);

  // ── replace definition (only legal with no responses, but the SQL must work) ──
  await db.query("DELETE FROM v4.announcement_poll_response_tbl WHERE poll_id = $1", [poll.poll_id]);
  await polls.replacePollDefinition({ pollId: poll.poll_id, question: "Which day?", allowMultiple: false, closesAt: null, options: [{ label: "Mon" }, { label: "Tue", requires_note: true }, { label: "Wed" }], userId: id(5) }, db);
  poll = await polls.findPollByAnnouncement(rowId, "BU", db, id(1));
  assert.equal(poll.question, "Which day?");
  assert.deepEqual(poll.options.map((o) => o.label), ["Mon", "Tue", "Wed"]);
  assert.deepEqual(poll.options.map((o) => o.requires_note), [false, true, false]);
  await polls.replaceUserResponse({ pollId: poll.poll_id, userId: id(2), optionIds: [poll.options[0].option_id], businessUnit: "BU" }, db);

  // ── cascade delete removes every poll row ──
  await feed.cascadeDeleteAnnouncement(rowId, "BU", db);
  for (const table of ["announcement_poll_response_tbl", "announcement_poll_option_tbl", "announcement_poll_tbl"]) {
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM v4.${table}`);
    assert.equal(rows[0].n, 0, `${table} emptied by cascade`);
  }
  const { rows: remaining } = await db.query("SELECT COUNT(*)::int AS n FROM v4.announcement_tbl");
  assert.equal(remaining[0].n, 0);
});

test("PostgreSQL: deletePoll removes options through the FK cascade", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA v4;
    CREATE TABLE v4.announcement_tbl (row_id serial PRIMARY KEY, business_unit text);
  `);
  for (const file of ["20260911_announcement_poll.sql", "20260911_poll_option_note.sql"]) {
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  const { rows: [ann] } = await db.query("INSERT INTO v4.announcement_tbl(business_unit) VALUES ('BU') RETURNING row_id");
  const created = await polls.insertPoll({ announcementId: ann.row_id, businessUnit: "BU", question: "Q", allowMultiple: false, closesAt: null, options: [{ label: "A" }, { label: "B" }], userId: id(5) }, db);
  await polls.deletePoll(created.poll_id, db);
  const { rows } = await db.query("SELECT COUNT(*)::int AS n FROM v4.announcement_poll_option_tbl");
  assert.equal(rows[0].n, 0);
  assert.equal(await polls.findPollByAnnouncement(ann.row_id, "BU", db, null), null);
});
