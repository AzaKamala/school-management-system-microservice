export default class AuditLogDTO {
  id: string;
  tenantId?: string;
  userId?: string;
  email: string;
  action: string;
  status: string;
  ip?: string;
  userAgent?: string;
  metadata?: any;
  createdAt: Date;

  constructor(
    id: string,
    email: string,
    action: string,
    status: string,
    createdAt: Date,
    tenantId?: string,
    userId?: string,
    ip?: string,
    userAgent?: string,
    metadata?: any
  ) {
    this.id = id;
    this.email = email;
    this.action = action;
    this.status = status;
    this.createdAt = createdAt;
    this.tenantId = tenantId;
    this.userId = userId;
    this.ip = ip;
    this.userAgent = userAgent;
    this.metadata = metadata;
  }

  static fromObject(obj: any): AuditLogDTO {
    return new AuditLogDTO(
      obj.id,
      obj.email,
      obj.action,
      obj.status,
      obj.createdAt,
      obj.tenantId,
      obj.userId,
      obj.ip,
      obj.userAgent,
      obj.metadata
    );
  }
}
