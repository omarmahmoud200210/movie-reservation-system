import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT),
    auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS },
  });

  async sendOtpEmail(to: string, code: string): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject: 'Your verification code',
      text: `Your verification code is ${code}. It expires in 10 minutes.`,
      html: `<p>Your verification code is <b>${code}</b>. It expires in 10 minutes.</p>`,
    });
  }
}
