import { Router, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { tenantServiceCircuitBreaker } from '../utils/circuitBreaker';

const router = Router();

router.get('/verify-token', async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader) {
      res.status(401).send('Authorization header missing');
      return;
    }
    
    const token = authHeader.split(' ')[1];
    
    if (!token) {
      res.status(401).send('Token missing');
      return;
    }
    
    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      res.status(401).send('Invalid token');
      return;
    }
    
    if (decoded.tenantId && !decoded.isAdmin) {
      try {
        const userVerification = await tenantServiceCircuitBreaker.executeRequest(
          'tenant.requests', 
          {
            data: {
              action: 'verify-user',
              data: {
                userId: decoded.userId,
                tenantId: decoded.tenantId
              },
              replyTo: 'auth.responses'
            },
            method: 'POST'
          }
        );
        
        if (!userVerification.data.verified) {
          res.status(403).send('User not active or not found in tenant');
          return;
        }
        
        if (userVerification.data.permissions) {
          decoded.permissions = userVerification.data.permissions;
        }
        
      } catch (error) {
        console.error('Error verifying with tenant service:', error);
      }
    }
    
    res.setHeader('X-User-ID', decoded.userId);
    res.setHeader('X-User-Email', decoded.email);
    res.setHeader('X-User-Roles', decoded.roles.join(','));
    res.setHeader('X-User-Permissions', decoded.permissions.join(','));
    
    if (decoded.tenantId) {
      res.setHeader('X-Tenant-ID', decoded.tenantId);
    }
    
    if (decoded.isAdmin) {
      res.setHeader('X-User-Is-Admin', 'true');
    }
    
    res.status(200).send('Token is valid');
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(401).send('Invalid token');
  }
});

export default router;