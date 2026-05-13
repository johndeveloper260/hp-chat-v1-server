/**
 * App Support Routes
 */
import express from "express";
import auth          from "../middleware/auth.js";
import { validate }  from "../middleware/validate.js";
import {
  createAppSupportSchema,
  updateAppSupportSchema,
} from "../validators/appSupportValidator.js";
import {
  searchTickets,
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  getSupportAgents,
} from "../controller/appSupportController.js";

const router = express.Router();

// ── All authenticated users ────────────────────────────────────────────────────
// Controller scopes to own records for non-support roles
router.get("/search",          auth, searchTickets);
router.get("/agents",          auth, getSupportAgents);
router.post("/create",         auth, validate(createAppSupportSchema), createTicket);

// ── Own-record access or support/admin — enforced inside the controller ────────
router.get("/:ticketId",               auth, getTicket);
router.put("/update/:ticketId",        auth, validate(updateAppSupportSchema), updateTicket);
router.delete("/delete/:ticketId",     auth, deleteTicket);

export default router;
