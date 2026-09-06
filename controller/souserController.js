/**
 * SO User Controller — thin HTTP adapter.
 *
 * Every officer-facing handler passes `req.user` to the service, which resolves
 * the target through the officer's own business unit before touching it. The
 * routes carry a bare :id, so the service-side guard is the only thing keeping
 * an officer inside their BU.
 */
import * as souserService from "../services/souserService.js";

export const deleteSouser = async (req, res, next) => {
  try {
    const { warnings } = await souserService.deleteSouser(req.params.id, req.user);
    res.json({ message: "SO User deleted.", warnings });
  } catch (err) {
    next(err);
  }
};

export const getSousers = async (req, res, next) => {
  try {
    const result = await souserService.getSousers(req.user.business_unit);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const getSouserById = async (req, res, next) => {
  try {
    const result = await souserService.getSouserForOfficer(req.params.id, req.user);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const createSouser = async (req, res, next) => {
  try {
    // `warnings` reports side effects that did not complete — most importantly a
    // failed activation email, which is the only place the temporary password
    // exists. The account itself is committed either way.
    const { record, warnings } = await souserService.createSouser(req.body, req.user);
    res.status(201).json({ message: "SO User created successfully.", record, warnings });
  } catch (err) {
    next(err);
  }
};

export const updateSouser = async (req, res, next) => {
  try {
    const record = await souserService.updateSouser(req.params.id, req.body, req.user);
    res.json({ message: "SO User updated.", record });
  } catch (err) {
    next(err);
  }
};

export const toggleSouserActive = async (req, res, next) => {
  try {
    // Accepts an explicit is_active so a retry is idempotent; omitting it keeps
    // the old flip behaviour for clients that have not been updated.
    const record = await souserService.setSouserActive(
      req.params.id,
      typeof req.body?.is_active === "boolean" ? req.body.is_active : undefined,
      req.user,
    );
    res.json({ message: "Status updated.", record });
  } catch (err) {
    next(err);
  }
};

export const grantBuAccess = async (req, res, next) => {
  try {
    const { warnings } = await souserService.grantBuAccess(
      req.params.id, req.body.business_unit, req.user,
    );
    res.json({ message: "BU access granted.", warnings });
  } catch (err) {
    next(err);
  }
};

export const revokeBuAccess = async (req, res, next) => {
  try {
    const { warnings } = await souserService.revokeBuAccess(req.params.id, req.params.bu, req.user);
    res.json({ message: "BU access revoked.", warnings });
  } catch (err) {
    next(err);
  }
};

export const updateBuAccessPermissions = async (req, res, next) => {
  try {
    const { announcements_read, announcements_write } = req.body;
    await souserService.updateBuAccessPermissions(
      req.params.id, req.params.bu, announcements_read, announcements_write, req.user,
    );
    res.json({ message: "Permissions updated." });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /souser/:id/announcements-write
 * Body: { announcements_write: boolean }
 *
 * The account-level "Allow bulletin writing" control. Applies to every BU the
 * account currently holds; the response names them so the UI can say so.
 */
export const setAnnouncementsWrite = async (req, res, next) => {
  try {
    const result = await souserService.setAnnouncementsWrite(
      req.params.id, req.body.announcements_write, req.user,
    );
    res.json({ message: "Bulletin writing permission updated.", ...result });
  } catch (err) {
    next(err);
  }
};

export const resetSouserPassword = async (req, res, next) => {
  try {
    await souserService.resetSouserPassword(req.params.id, req.body.new_password, req.user);
    res.json({ message: "Password reset successfully." });
  } catch (err) {
    next(err);
  }
};

export const getSouserSelf = async (req, res, next) => {
  try {
    // AuthContext probes this endpoint for every authenticated account. A
    // regular user has no row in souser_tbl, so respond with "no SO profile"
    // instead of turning a successful login into a noisy 404 refresh failure.
    if (req.user.userType?.toLowerCase() !== "souser") {
      return res.status(204).end();
    }

    const result = await souserService.getSouserById(req.user.id);
    const platformAdminId = process.env.PLATFORM_ADMIN_ID;
    const scope = req.user.souserScope;
    res.json({
      ...result,
      is_platform_admin: !!platformAdminId && String(req.user.id) === String(platformAdminId),
      // The scope the server will actually enforce, so the client can hide
      // controls it would be refused on rather than discovering it via a 403.
      scope: {
        sending_org: scope?.sendingOrg ?? null,
        business_units: scope?.businessUnits ?? [],
        writable_business_units: scope?.writableBusinessUnits ?? [],
        readable_business_units: scope?.readableBusinessUnits ?? [],
        announcements_read: req.user.souser_announcements_read === true,
        announcements_write: req.user.souser_announcements_write === true,
        valid: scope?.valid === true,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const updateSouserSelf = async (req, res, next) => {
  try {
    const record = await souserService.updateSouserSelf(req.user.id, req.body);
    res.json({ message: "Profile updated.", record });
  } catch (err) {
    next(err);
  }
};
