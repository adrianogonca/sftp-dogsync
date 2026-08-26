import type { FtpConnectionOptions } from "./remoteConnectionTypes";

export function buildBasicFtpAccessOptions(options: FtpConnectionOptions): {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
  secureOptions?: { rejectUnauthorized: boolean };
} {
  const base = {
    host: options.host,
    port: options.port,
    user: options.username,
    password: options.password,
  };
  if (options.ftpSecurityMode === "plainFtp") {
    return { ...base, secure: false };
  }
  if (options.trustFtpSelfSignedCertificate) {
    return {
      ...base,
      secure: true,
      secureOptions: { rejectUnauthorized: false },
    };
  }
  return { ...base, secure: true };
}
