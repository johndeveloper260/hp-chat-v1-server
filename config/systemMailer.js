const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs").promises; // Using standard promises API
const path = require("path");

/**
 * 1. Initialize Transporter once (Singleton)
 * Reusing the connection pool is significantly faster.
 */
const transporter = nodemailer.createTransport({
  service: process.env.MAIL_SERVICE,
  host: process.env.MAIL_HOST, // Better to have host/port for non-Gmail services
  port: process.env.MAIL_PORT || 587,
  secure: process.env.MAIL_SECURE === "true",
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PWORD,
  },
});

/**
 * 2. Helper to Compile and Render Handlebars Templates
 */
const renderTemplate = async (templateName, replacements) => {
  const filePath = path.join(
    __dirname,
    "../email_templates",
    `${templateName}.html`
  );
  const source = await fs.readFile(filePath, "utf-8");
  const template = handlebars.compile(source);
  return template(replacements);
};

/**
 * 3. Base Send Function
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
    throw error; // Re-throw so the calling controller knows it failed
  }
}

/**
 * 4. Exported Email Methods
 */

exports.newRegistration = async (
  emailId,
  emailTitle,
  name,
  password,
  homeurl
) => {
  const html = await renderTemplate("newregistration", {
    name,
    password,
    homeurl,
  });
  await sendEmail(emailId, emailTitle, html);
};

exports.additionalRegistration = async (
  emailId,
  emailTitle,
  name,
  business_unit
) => {
  const html = await renderTemplate("additionalregistration", {
    name,
    business_unit,
  });
  await sendEmail(emailId, emailTitle, html);
};

exports.passwordResetCode = async (emailId, emailTitle, resetCode) => {
  const html = await renderTemplate("getyourcode", { resetCode });
  await sendEmail(emailId, emailTitle, html);
};

// This is the one for your new "Simple Password" flow
exports.newPasswordMail = async (emailId, emailTitle, password) => {
  const html = await renderTemplate("resetpassword", { password });
  await sendEmail(emailId, emailTitle, html);
};

exports.contactUs = async (senderEmail, emailTitle, message) => {
  const html = await renderTemplate("contactus", { senderEmail, message });

  // Clean up the recipient logic
  const supportEmail = "support@horensoplus.com";
  // Send to support, but mention the user's email in the recipient list or body
  const recipientList = [supportEmail, senderEmail].join(", ");

  await sendEmail(recipientList, emailTitle, html);
};
