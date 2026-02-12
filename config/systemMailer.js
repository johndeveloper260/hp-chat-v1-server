import nodemailer from "nodemailer";
import handlebars from "handlebars";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// 1. Reconstruct __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 2. Initialize Transporter once (Singleton)
 */
const transporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE,
  host: process.env.MAIL_HOST,
  port: process.env.MAIL_PORT || 587,
  secure: process.env.MAIL_SECURE === "true",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PWORD,
  },
});

/**
 * 3. Helper to Compile and Render Handlebars Templates
 */
const renderTemplate = async (templateName, replacements) => {
  const filePath = path.join(
    __dirname,
    "../email_templates",
    `${templateName}.html`,
  );
  const source = await fs.readFile(filePath, "utf-8");
  const template = handlebars.compile(source);
  return template(replacements);
};

/**
 * 4. Base Send Function
 */
async function sendEmail(recipient, subject, html) {
  try {
    const info = await transporter.sendMail({
      from: process.env.MAIL_SENDER || process.env.MAIL_USER,
      to: recipient,
      subject: subject,
      html: html,
    });
    console.log(`Email sent: ${info.messageId} to ${recipient}`);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw error;
  }
}

/**
 * 5. Exported Email Methods (Using Named Exports)
 */

export const newRegistration = async (
  emailId,
  emailTitle,
  name,
  password,
  homeurl,
) => {
  const html = await renderTemplate("newregistration", {
    name,
    password,
    homeurl,
  });
  await sendEmail(emailId, emailTitle, html);
};

export const additionalRegistration = async (
  emailId,
  emailTitle,
  name,
  business_unit,
) => {
  const html = await renderTemplate("additionalregistration", {
    name,
    business_unit,
  });
  await sendEmail(emailId, emailTitle, html);
};

export const passwordResetCode = async (emailId, emailTitle, resetCode) => {
  const html = await renderTemplate("getyourcode", { resetCode });
  await sendEmail(emailId, emailTitle, html);
};

export const newPasswordMail = async (emailId, emailTitle, password) => {
  const html = await renderTemplate("resetpassword", { password });
  await sendEmail(emailId, emailTitle, html);
};

export const contactUs = async (senderEmail, emailTitle, message) => {
  const html = await renderTemplate("contactus", { senderEmail, message });
  const supportEmail = "support@horensoplus.com";
  const recipientList = [supportEmail, senderEmail].join(", ");
  await sendEmail(recipientList, emailTitle, html);
};
/**
 * Send Account Deletion Verification Code
 */
export const sendDeletionCode = async (emailId, emailTitle, otpCode, name) => {
  try {
    // 1. Use the existing renderTemplate helper to keep logic consistent
    const html = await renderTemplate("deleteaccount", {
      otpCode,
      name: name || "User",
    });

    // 2. Call the base sendEmail function with consistent parameters
    await sendEmail(emailId, emailTitle, html);
  } catch (error) {
    console.error("Error in sendDeletionCode:", error);
    throw error;
  }
};
