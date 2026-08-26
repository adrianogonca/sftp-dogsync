import type { ConnectionOptions } from "./sftpClient";
import type { FtpSecurityMode } from "./syncJsonFile";

/**
 * Opções de ligação FTP/FTPS (credenciais já resolvidas; a senha não deve vir do JSON).
 */
export interface FtpConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly username: string;
  readonly password: string;
  readonly ftpSecurityMode: FtpSecurityMode;
  /** Se true, aceita certificados TLS não confiáveis (ex.: autoassinado). */
  readonly trustFtpSelfSignedCertificate: boolean;
}

/**
 * Ligação discriminada: SFTP (SSH) ou FTP/FTPS.
 */
export type RemoteConnection =
  | {
      readonly kind: "sftp";
      readonly options: ConnectionOptions;
      readonly poolKey: string;
    }
  | {
      readonly kind: "ftp";
      readonly options: FtpConnectionOptions;
      readonly poolKey: string;
    };
