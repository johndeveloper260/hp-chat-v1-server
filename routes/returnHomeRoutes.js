import express from "express";
import auth from "../middleware/auth.js";
import {
  searchReturnHome,
  createReturnHome,
  getReturnHomeById,
  updateReturnHome,
  deleteReturnHome,
} from "../controller/returnHomeController.js";

const router = express.Router();

/**
 * @route   GET /return-home/search
 * @desc    Search return home records with filters
 */
router.get("/search", auth, searchReturnHome);

/**
 * @route   POST /return-home/create
 * @desc    Create a new return home application
 */
router.post("/create", auth, createReturnHome);

/**
 * @route   GET /return-home/:id
 * @desc    Get single record with user profile, visa info, and attachments
 */
router.get("/:id", auth, getReturnHomeById);

/**
 * @route   PUT /return-home/update/:id
 * @desc    Update an existing application
 */
router.put("/update/:id", auth, updateReturnHome);

/**
 * @route   DELETE /return-home/delete/:id
 * @desc    Delete a record with cascading cleanup
 */
router.delete("/delete/:id", auth, deleteReturnHome);

export default router;
