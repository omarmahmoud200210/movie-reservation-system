export declare class MailerService {
    private transporter;
    sendOtpEmail(to: string, code: string): Promise<void>;
}
