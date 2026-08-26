import type { RemoteConnection } from "./remoteConnectionTypes";
import {
  downloadRemoteFileForPreview as downloadPreviewSftp,
  downloadRemoteToLocal as downloadRemoteToLocalSftp,
  deleteRemotePath as deleteRemotePathSftp,
  uploadLocalPathToRemoteRecursive as uploadPathRecursiveSftp,
  uploadLocalFileToRemote as uploadFileSftp,
  listRemoteDirectory as listRemoteDirectorySftp,
  type RemoteListingEntry,
  type RemotePreviewResult,
} from "./sftpClient";
import {
  downloadRemoteFileForPreviewFtp,
  downloadRemoteToLocalFtp,
  deleteRemotePathFtp,
  uploadLocalPathToRemoteRecursiveFtp,
  uploadLocalFileToRemoteFtp,
  listRemoteDirectoryFtp,
} from "./ftpClient";

export type { RemoteListingEntry, RemotePreviewResult };
export { EDITOR_PREVIEW_BYTES_LIMIT } from "./sftpClient";

export async function listRemoteDirectory(
  connection: RemoteConnection,
  remoteDirectoryPosixPath: string
): Promise<RemoteListingEntry[]> {
  if (connection.kind === "sftp") {
    return listRemoteDirectorySftp(
      connection.poolKey,
      connection.options,
      remoteDirectoryPosixPath
    );
  }
  return listRemoteDirectoryFtp(
    connection.poolKey,
    connection.options,
    remoteDirectoryPosixPath
  );
}

export async function uploadLocalFileToRemote(
  connection: RemoteConnection,
  localPath: string,
  remotePosixPath: string
): Promise<void> {
  if (connection.kind === "sftp") {
    return uploadFileSftp(
      connection.poolKey,
      connection.options,
      localPath,
      remotePosixPath
    );
  }
  return uploadLocalFileToRemoteFtp(
    connection.poolKey,
    connection.options,
    localPath,
    remotePosixPath
  );
}

export async function uploadLocalPathToRemoteRecursive(
  connection: RemoteConnection,
  absoluteLocalPath: string,
  destinationRemotePosixPath: string,
  absoluteLocalRoot: string,
  shouldIgnoreRelative: (posixRelative: string) => boolean
): Promise<void> {
  if (connection.kind === "sftp") {
    return uploadPathRecursiveSftp(
      connection.poolKey,
      connection.options,
      absoluteLocalPath,
      destinationRemotePosixPath,
      absoluteLocalRoot,
      shouldIgnoreRelative
    );
  }
  return uploadLocalPathToRemoteRecursiveFtp(
    connection.poolKey,
    connection.options,
    absoluteLocalPath,
    destinationRemotePosixPath,
    absoluteLocalRoot,
    shouldIgnoreRelative
  );
}

export async function deleteRemotePath(
  connection: RemoteConnection,
  remotePosixPath: string
): Promise<void> {
  if (connection.kind === "sftp") {
    return deleteRemotePathSftp(
      connection.poolKey,
      connection.options,
      remotePosixPath
    );
  }
  return deleteRemotePathFtp(
    connection.poolKey,
    connection.options,
    remotePosixPath
  );
}

export async function downloadRemoteFileForPreview(
  connection: RemoteConnection,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<RemotePreviewResult> {
  if (connection.kind === "sftp") {
    return downloadPreviewSftp(
      connection.poolKey,
      connection.options,
      remotePosixPath,
      destinationLocalPath
    );
  }
  return downloadRemoteFileForPreviewFtp(
    connection.poolKey,
    connection.options,
    remotePosixPath,
    destinationLocalPath
  );
}

export async function downloadRemoteToLocal(
  connection: RemoteConnection,
  remotePosixPath: string,
  destinationLocalPath: string
): Promise<void> {
  if (connection.kind === "sftp") {
    return downloadRemoteToLocalSftp(
      connection.poolKey,
      connection.options,
      remotePosixPath,
      destinationLocalPath
    );
  }
  return downloadRemoteToLocalFtp(
    connection.poolKey,
    connection.options,
    remotePosixPath,
    destinationLocalPath
  );
}
