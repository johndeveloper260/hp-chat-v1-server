const express = require("express");
const router = express.Router();

const auth = require("../middleware/auth");

const {
  loginUser,
  handleForgotPassword,
  updatePassword,
  deleteUserAccount,
} = require("../controller/loginController");

//Public
router.post(`/loginUser`, loginUser);
router.post(`/forgot-password`, handleForgotPassword);

//Private
router.post(`/updatePassword`, updatePassword);
router.delete(`/deleteAccount`, deleteUserAccount);

module.exports = router;
