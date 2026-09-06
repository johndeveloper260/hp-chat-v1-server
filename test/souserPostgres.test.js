import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import * as feed from "../repositories/feedRepository.js";
import * as accounts from "../repositories/souserRepository.js";
import * as contacts from "../repositories/chatAccessRepository.js";
import { canViewAnnouncement } from "../utils/announcementVisibility.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("PostgreSQL: migration rerun, feed/notification isolation, grants and deactivation", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE SCHEMA v4;
    CREATE TABLE v4.user_account_tbl (id uuid PRIMARY KEY, email text, business_unit text, is_active boolean DEFAULT true, password_hash text DEFAULT 'fixture', last_seen timestamptz, updated_at timestamptz);
    CREATE TABLE v4.user_profile_tbl (user_id uuid PRIMARY KEY, first_name text, middle_name text, last_name text, user_type text, sending_org text, country text, company text, batch_no text);
    CREATE TABLE v4.souser_tbl (id uuid PRIMARY KEY, first_name text, last_name text, display_name text, sending_org text, country text, primary_bu text, is_active boolean DEFAULT true, updated_by uuid, updated_at timestamptz);
    CREATE TABLE v4.souser_bu_access_tbl (souser_id uuid, business_unit text, announcements_write boolean DEFAULT true, announcements_read boolean DEFAULT false, granted_at timestamptz DEFAULT now(), granted_by uuid, revoked_at timestamptz, revoked_by uuid, PRIMARY KEY(souser_id,business_unit));
    CREATE TABLE v4.company_tbl (company_id uuid PRIMARY KEY, company_name jsonb, sort_order integer);
    CREATE TABLE v4.announcement_tbl (row_id serial PRIMARY KEY, business_unit text, company text[], batch_no text, country text[], sending_org text, title text, content_text text, reactions jsonb, date_from date, date_to date, active boolean DEFAULT true, comments_on boolean DEFAULT true, created_by uuid, created_at timestamptz DEFAULT now(), last_updated_by uuid, last_updated_at timestamptz);
    CREATE TABLE v4.shared_comments (relation_id integer, relation_type text);
    CREATE TABLE v4.announcement_views (announcement_id integer, user_id uuid);
    CREATE TABLE v4.announcement_favorites (row_id integer, user_id uuid);
    CREATE TABLE v4.shared_attachments (attachment_id uuid, relation_type text, relation_id text, s3_key text, s3_bucket text, display_name text, file_type text, created_at timestamptz);
  `);
  // 1 SOUSER A, 2 SOUSER B, 3 USER A, 4 USER B, 5 officer, 6 USER A in another BU.
  for (let n = 1; n <= 6; n++) {
    await db.query("INSERT INTO v4.user_account_tbl(id,email,business_unit) VALUES($1,$2,$3)", [id(n), `fixture${n}@example.test`, n === 6 ? "OTHER" : "BU"]);
    if (n <= 2) {
      await db.query("INSERT INTO v4.souser_tbl(id,first_name,last_name,sending_org,country,primary_bu) VALUES($1,'SO','User',$2,'PH','BU')", [id(n), n === 1 ? "A" : "B"]);
      await accounts.insertBuAccess(id(n), "BU", id(5), true, db);
    } else {
      await db.query("INSERT INTO v4.user_profile_tbl(user_id,first_name,last_name,user_type,sending_org,country,company) VALUES($1,'Test','User',$2,$3,'VN',$4)", [id(n), n === 5 ? "OFFICER" : "USER", n === 4 ? "B" : "A", id(20)]);
    }
  }
  await db.query("INSERT INTO v4.announcement_tbl(business_unit,title,created_by,sending_org,country) VALUES('BU','A post',$1,'A',ARRAY['PH']),('BU','B post',$2,'B',NULL),('BU','General',$3,NULL,NULL),('OTHER','Other BU',$3,NULL,NULL)", [id(1),id(2),id(5)]);
  const migration = await readFile(new URL("../migrations/20260906_souser_scope.sql", import.meta.url), "utf8");
  await db.exec(migration);
  assert.equal(await accounts.isAnnouncementsWriteEnabled(id(1), db), false);
  await accounts.setAnnouncementsWriteForAccount(id(1), true, db);
  await db.exec(migration);
  assert.equal(await accounts.isAnnouncementsWriteEnabled(id(1), db), true, "rerun must preserve newly enabled permission");
  const list = (userId, souser, businessUnits = ["BU"], isOfficer = false) => feed.findAnnouncements({ userId, lang: "en", businessUnits, isOfficer, isManagement: false, souser, company_filter: souser ? null : id(20), client: db });
  const aFeed = await list(id(1), { sendingOrg: "A", country: "PH" });
  assert.deepEqual(aFeed.map((a) => a.title).sort(), ["A post", "General"]);
  const employeeFeed = await list(id(3), null);
  assert.deepEqual(employeeFeed.map((a) => a.title).sort(), ["A post", "General"], "SO bulletin ignores country");
  assert.equal((await list(id(5), null, ["BU"], true)).length, 3, "officer retains full BU control");
  assert.equal((await list(id(1), { sendingOrg: "A", country: "PH" }, ["BU", "OTHER"])).length, 3);
  const audience = await feed.findRecipientIds("BU", id(1), null, ["PH"], "A", "A", db);
  assert.deepEqual(audience.sort(), [id(3), id(5)]);
  const target = await feed.findAnnouncementForVisibility(aFeed.find((a) => a.title === "A post").row_id, db);
  assert.equal(canViewAnnouncement({ userType: "SOUSER", sendingOrg: "B", businessUnits: ["BU"] }, target), false);
  const found = await contacts.findSouserContacts({ businessUnits: ["BU"], sendingOrg: "A" }, db);
  assert.deepEqual(found.map((u) => u.id).sort(), [id(1), id(3), id(5)]);
  // Read/Write controls do not alter the sending-org audience.
  await accounts.updateBuAccessPermissions(id(1), "BU", true, false, db);
  const reader = await feed.findViewerIdentity(id(1), db);
  assert.equal(reader.bu_access[0].announcements_read, true);
  assert.equal(reader.bu_access[0].announcements_write, false);
  await accounts.updateBuAccessPermissions(id(1), "BU", false, false, db);
  const disabled = await feed.findViewerIdentity(id(1), db);
  assert.equal(disabled.bu_access[0].announcements_read, false);
  assert.equal(disabled.sending_org, "A");
  const noRead = { userType: "SOUSER", sendingOrg: "A", businessUnit: "BU", businessUnits: [] };
  assert.equal(canViewAnnouncement(noRead, target), false, "empty read scope cannot fall back to primary BU");
  const created = await feed.insertAnnouncement({ userBU: "BU", company: null, country: null,
    sending_org: "A", title: "Created via repository", content_text: "Fixture", active: true,
    comments_on: true, userId: id(1), createdBySendingOrg: "A" }, db);
  assert.equal(created.created_by_sending_org, "A");
  const updated = await feed.updateAnnouncement({ userBU: "BU", rowId: created.row_id,
    company: null, country: null, sending_org: "A", title: "Updated", content_text: "Fixture",
    active: true, comments_on: true, userId: id(1) }, db);
  assert.equal(updated.title, "Updated");
  assert.equal(updated.created_by_sending_org, "A");
  await accounts.revokeBuAccess(id(1), "BU", id(5), db);
  assert.deepEqual((await accounts.findActiveBuList(id(1), db)).rows, []);
  await accounts.insertBuAccess(id(1), "BU", id(5), false, db);
  assert.equal((await accounts.findActiveBuList(id(1), db)).rows.length, 1);
  assert.equal(await accounts.isAnnouncementsWriteEnabled(id(1), db), false);
  await accounts.setActive(id(1), false, id(5), db);
  assert.equal(await feed.findViewerIdentity(id(1), db), null);
  assert.equal((await contacts.findChatIdentity(id(1), db)).is_active, false);
  const status = await db.query("SELECT s.is_active AS profile, a.is_active AS account FROM v4.souser_tbl s JOIN v4.user_account_tbl a USING(id) WHERE id=$1", [id(1)]);
  assert.deepEqual(status.rows[0], { profile: false, account: false });
});
