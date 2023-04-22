require("dotenv").config();
const sgMail = require('@sendgrid/mail');
const config = require('../config.json');

// Set the API key
sgMail.setApiKey(process.env.EMAIL_API_KEY);

// Create a sendEmail function that takes in an email address and a code
const sendEmail = (email_address, code) => {
    try {
    // Use the sendgrid package to send an email
    sgMail.send({
        from: config.FROM_EMAIL,
        subject: config.EMAIL_SUBJECT,
        to: email_address,
        html: `This code expires in 30 minutes. Your <strong>verification code</strong> is: ${code}`,
    });
    } catch (error) {
        console.log(error)
    }
}

// Export the sendEmail function
module.exports = sendEmail;
