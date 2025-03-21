import { v4 as uuidv4 } from 'uuid';
import { publishMessage } from './rabbitmq';

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

const pendingRequests: Map<string, PendingRequest> = new Map();

export function handleServiceResponse(message: any) {
  const { correlationId, error, data } = message;
  
  if (!correlationId || !pendingRequests.has(correlationId)) {
    console.warn('Received response with unknown correlationId', { correlationId });
    return;
  }
  
  const request = pendingRequests.get(correlationId)!;
  clearTimeout(request.timer);
  pendingRequests.delete(correlationId);
  
  if (error) {
    request.reject(new Error(error));
  } else {
    request.resolve(data);
  }
}

export async function sendServiceRequest(
  service: string,
  action: string,
  data: any,
  timeout: number = 5000
): Promise<any> {
  const correlationId = uuidv4();
  
  const responsePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingRequests.has(correlationId)) {
        pendingRequests.delete(correlationId);
        reject(new Error(`Request to ${service} timed out after ${timeout}ms`));
      }
    }, timeout);
    
    pendingRequests.set(correlationId, { resolve, reject, timer });
  });
  
  await publishMessage(`${service}.requests`, {
    action,
    data,
    correlationId,
    replyTo: 'auth.responses',
    timestamp: new Date()
  });
  
  return responsePromise;
}

export async function verifyTenantUser(userId: string, tenantId: string): Promise<boolean> {
  try {
    const result = await sendServiceRequest('tenant', 'verify-user', { userId, tenantId });
    return result.verified === true;
  } catch (error) {
    console.error('Failed to verify user with Tenant Service', { userId, tenantId, error });
    return false;
  }
}