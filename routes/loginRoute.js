import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Change require to a named import and add the .js extension
import {
  loginUser,
  handleForgotPassword,
  updatePassword,
  deleteUserAccount,
} from "../controller/loginController.js";

// Public
router.post(`/loginUser`, loginUser);
router.post(`/forgot-password`, handleForgotPassword);

// Private
router.post(`/updatePassword`, auth, updatePassword);
router.delete(`/deleteAccount`, auth, deleteUserAccount);

// 2. Change module.exports to export default
export default router;
