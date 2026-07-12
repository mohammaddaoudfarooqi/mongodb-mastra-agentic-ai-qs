import type { Db } from 'mongodb';
import {
  buildAuditRecord, verifyChain, GENESIS_HASH, type AuditEvent, type AuditRecord, type ChainVerification,
} from './audit-chain';

export const AUDIT_COLLECTION = 'audit_trail';

/**
 * Append-only, HMAC hash-chained audit store on MongoDB. Each append reads the latest record's
 * hash, chains the new event to it, and inserts. `verify` recomputes the whole chain. The HMAC
 * secret lives host-side (config), never in the stored records.
 */
export class AuditStore {
  constructor(private db: Db, private secret: string, private keyVersion = 1) {}

  private col() { return this.db.collection<AuditRecord>(AUDIT_COLLECTION); }

  async append(event: AuditEvent): Promise<AuditRecord> {
    const last = await this.col().find({}).sort({ _id: -1 }).limit(1).next();
    const previousHash = last?.current_hash ?? GENESIS_HASH;
    const record = buildAuditRecord(this.secret, previousHash, event, this.keyVersion);
    await this.col().insertOne(record as any);
    return record;
  }

  async verify(): Promise<ChainVerification> {
    const records = await this.col().find({}).sort({ _id: 1 }).toArray();
    return verifyChain(this.secret, records as AuditRecord[]);
  }
}
