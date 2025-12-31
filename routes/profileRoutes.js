const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const {
  updateWorkVisa,
  getUserLegalProfile,
  getUserProfile,
  updateUserProfile,
} = require("../controller/profileController");

// Private //

//Visa
router.get(`/user-legal-info/:userId`, auth, getUserLegalProfile);
router.put(`/visa-info/:userId`, auth, updateWorkVisa);

//Profile
router.get("/personal-info/:userId", auth, getUserProfile);
router.put("/personal-info/:userId", auth, updateUserProfile);

module.exports = router;
