require("dotenv").config();

const { sendEmail } = require("../utils/emailService");

const testEmail = async () => {
  try {
    const info = await sendEmail({
      to: process.env.TEST_EMAIL_TO,
      subject: "Volta - Email Integration Test",
      text: "Hello! This is a test email from Volta Task Management System.",
      html: `
        <div style="font-family: Arial, sans-serif; padding: 20px;">
          <h2>Volta Task Management System</h2>
          <p>Hello!</p>
          <p>Your Gmail email integration is working successfully.</p>
          <p>This is a test email.</p>
          <br />
          <p>Regards,<br />Volta Team</p>
        </div>
      `,
    });

    console.log("Test email sent successfully!");
    console.log("Message ID:", info.messageId);
  } catch (error) {
    console.error("Test email failed:", error.message);
  }
};

testEmail();