export interface FirebasePreview {
  url: string;
  commitSha: string;
  expiresAt: Date | null;
  isExpired: boolean;
  deployedAt: Date;
}

export function parseFirebasePreviewComment(
  commentBody: string,
  commentUpdatedAt: string,
): FirebasePreview | null {
  // Check if this is a Firebase Hosting comment
  if (!commentBody.includes("Firebase Hosting GitHub Action")) {
    return null;
  }

  // Extract preview URL (matches .web.app or .firebaseapp.com)
  const urlMatch = commentBody.match(
    /https:\/\/[a-zA-Z0-9\-]+\.(web\.app|firebaseapp\.com)/,
  );
  if (!urlMatch) {
    return null;
  }
  const url = urlMatch[0];

  // Extract commit SHA from "updated for commit XXXXX"
  const commitMatch = commentBody.match(/updated for commit ([a-f0-9]+)/);
  if (!commitMatch) {
    return null;
  }
  const commitSha = commitMatch[1];

  // Extract expiry date from "expires ..."
  let expiresAt: Date | null = null;
  const expiryMatch = commentBody.match(/\(expires (.+?)\)/);
  if (expiryMatch) {
    const expiryDateStr = expiryMatch[1];
    const parsedDate = new Date(expiryDateStr);
    // Only set if it's a valid date
    if (!isNaN(parsedDate.getTime())) {
      expiresAt = parsedDate;
    }
  }

  const deployedAt = new Date(commentUpdatedAt);
  const isExpired = expiresAt !== null && expiresAt < new Date();

  return {
    url,
    commitSha,
    expiresAt,
    isExpired,
    deployedAt,
  };
}
