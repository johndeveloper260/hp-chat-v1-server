const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const {
  createAnnouncement,
  getAnnouncements,
  updateAnnouncement,
} = require("../controller/feedController");

//Private
router.post(`/createAnnouncement`, auth, createAnnouncement);
router.get(`/getAnnouncements`, auth, getAnnouncements);
router.put(`/updateAnnouncement`, auth, updateAnnouncement);

module.exports = router;
