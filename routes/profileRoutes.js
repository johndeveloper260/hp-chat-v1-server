const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const {
  updateWorkVisa,
  getUserLegalProfile,
} = require("../controller/profileController");

// Private
router.get(`/user-legal-info/:userId`, auth, getUserLegalProfile);
router.put(`/visa-info/:userId`, auth, updateWorkVisa);

module.exports = router;
