const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const {
  getAccess,
  //   getRole,
  //   addRole,
  //   deleteRole,
} = require("../controller/accessController");

//Private
router.get(`/getAccess`, getAccess);

// router.post(`/getRole`, auth, getRole);
// router.post(`/addRole`, auth, addRole);
// router.post(`/deleteRole`, auth, deleteRole);

module.exports = router;
