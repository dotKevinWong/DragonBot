import { Resend } from "resend";

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export class EmailService {
  private client: Resend;
  private fromEmail: string;

  constructor(apiKey: string, fromEmail: string) {
    this.client = new Resend(apiKey);
    this.fromEmail = fromEmail;
  }

  async sendVerificationEmail(to: string, code: string, guildName: string): Promise<void> {
    const safeGuildName = escapeHtml(guildName);
    const safeCode = escapeHtml(code);

    await this.client.emails.send({
      from: this.fromEmail,
      to,
      subject: `Your verification code for ${guildName}`,
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code for <strong>${safeGuildName}</strong> is:</p>
        <h1 style="font-size: 32px; letter-spacing: 4px; font-family: monospace;">${safeCode}</h1>
        <p>This code expires in 30 minutes.</p>
        <p>Use the <code>/verify code</code> command in Discord to complete verification.</p>
      `,
    });
  }
}
