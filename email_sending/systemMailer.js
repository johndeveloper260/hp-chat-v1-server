const nodemailer = require("nodemailer");
const handlebars = require("handlebars");
const fs = require("fs-extra");
const path = require("path");

async function sendEmail(receipient, subject, text, htmlToSend) {
  // await console.log(subject);

  // create reusable transporter object using the default SMTP transport
  let transporter = await nodemailer.createTransport({
    service: process.env.MAIL_SERVICE,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PWORD,
    },
  });

  // send mail with defined transport object
  let info = await transporter.sendMail({
    from: process.env.MAIL_SENDER,
    to: receipient,
    subject: subject,
    text: text,
    html: htmlToSend,
  });

  // await console.log("Mail Sent: " + receipient);
}

exports.newRegistration = async (
  emailId,
  emailTitle,
  name,
  password,
  homeurl
) => {
  const filePath = path.join(
    __dirname,
    "../email_templates/newregistration.html"
  );
  const source = fs.readFileSync(filePath, "utf-8").toString();
  const template = handlebars.compile(source);

  const replacements = {
    name: name,
    password: password,
    homeurl: homeurl,
  };
  const htmlToSend = template(replacements);

  //Send Email
  await sendEmail(emailId, emailTitle, "", htmlToSend).catch(console.error);
};

exports.additionalRegistration = async (
  emailId,
  emailTitle,
  name,
  business_unit
) => {
  const filePath = path.join(
    __dirname,
    "../email_templates/additionalregistration.html"
  );
  const source = fs.readFileSync(filePath, "utf-8").toString();
  const template = handlebars.compile(source);

  const replacements = {
    name: name,
    business_unit: business_unit,
  };
  const htmlToSend = template(replacements);

  //Send Email
  await sendEmail(emailId, emailTitle, "", htmlToSend).catch(console.error);
};

exports.passwordResetCode = async (emailId, emailTitle, resetCode) => {
  const filePath = path.join(__dirname, "../email_templates/getyourcode.html");
  const source = fs.readFileSync(filePath, "utf-8").toString();
  const template = handlebars.compile(source);

  const replacements = {
    resetCode: resetCode,
  };
  const htmlToSend = template(replacements);

  //Send Email
  await sendEmail(emailId, emailTitle, "", htmlToSend).catch(console.error);
};

exports.newPasswordMail = async (emailId, emailTitle, password) => {
  const filePath = path.join(
    __dirname,
    "../email_templates/resetpassword.html"
  );
  const source = fs.readFileSync(filePath, "utf-8").toString();
  const template = handlebars.compile(source);

  const replacements = {
    password: password,
  };
  const htmlToSend = template(replacements);

  //Send Email
  await sendEmail(emailId, emailTitle, "", htmlToSend).catch(console.error);
};
