import { verifyAccessToken } from './jwt';

export type MessageHandler = (
  message: any, 
  replyCallback?: (response: any) => Promise<void>
) => Promise<void>;

export async function handleVerifyToken(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (!message.data?.token) {
    if (replyCallback) {
      await replyCallback({ 
        valid: false, 
        error: "Token not provided" 
      });
    }
    return;
  }
  
  const decoded = verifyAccessToken(message.data.token);
  if (!decoded) {
    if (replyCallback) {
      await replyCallback({ valid: false });
    }
  } else if (replyCallback) {
    await replyCallback({ 
      valid: true, 
      user: decoded 
    });
  }
}

export async function handleVerifyUser(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (!message.data?.userId) {
    if (replyCallback) {
      await replyCallback({ 
        verified: false, 
        error: "User ID not provided" 
      });
    }
    return;
  }
  
  if (replyCallback) {
    await replyCallback({ verified: true });
  }
}

export async function handleUnknownAction(
  message: any, 
  replyCallback?: (response: any) => Promise<void>
): Promise<void> {
  if (replyCallback) {
    await replyCallback({
      error: "Unknown action",
      action: message.action
    });
  }
}

export const messageHandlers: Record<string, MessageHandler> = {
  "verify-token": handleVerifyToken,
  "verify-user": handleVerifyUser
};