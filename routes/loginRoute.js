import express from "express";
import auth from "../middleware/auth.js";
const router = express.Router();

// 1. Change require to a named import and add the .js extension
import {
  loginUser,
  handleForgotPassword,
  updatePassword,
  deleteUserAccount,
  requestWebDeletion,
  finalizeDeletion,
} from "../controller/loginController.js";

// Public
router.post(`/loginUser`, loginUser);
router.post(`/forgot-password`, handleForgotPassword);

// Private
router.post(`/updatePassword`, auth, updatePassword);

// Private Route (For In-App Settings)
router.delete(`/deleteAccount`, auth, deleteUserAccount);

// Public Routes (For Web Deletion Page)
router.post(`/requestWebDeletion`, requestWebDeletion);
router.post(`/verifyAndExcludeAccount`, finalizeDeletion);

export default router;
