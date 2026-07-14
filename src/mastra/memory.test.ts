import { describe, it, expect, vi } from 'vitest';
import {
  buildCaseMemoText, recordDecidedCase, recallSimilarVerdicts,
  FRAUD_DESK_RESOURCE, INSTITUTIONAL_THREAD, type InstitutionalMemory,
} from './memory';

describe('buildCaseMemoText', () => {
  it('is shape-only: ids, disposition, lane, amount, risk factors — never party names', () => {
    const text = buildCaseMemoText({
      transaction_id: 'txn-9', disposition: 'reject', lane: 'sanctions',
      risk_factors: ['sanctions_hit'], amount: 12000,
    });
    expect(text).toContain('txn-9');
    expect(text).toContain('reject');
    expect(text).toContain('sanctions');
    expect(text).toContain('$12,000');
    expect(text).toContain('sanctions_hit');
  });

  it('renders "none" when there are no risk factors', () => {
    expect(buildCaseMemoText({ transaction_id: 't', disposition: 'approve', lane: 'clean_approve', risk_factors: [], amount: 5 }))
      .toContain('Risk factors: none.');
  });
});

describe('recordDecidedCase', () => {
  it('indexes a shape-only observation keyed by transaction_id under the fraud-desk resource', async () => {
    const indexObservation = vi.fn<InstitutionalMemory['indexObservation']>(async () => {});
    const mem: InstitutionalMemory = { indexObservation, searchMessages: vi.fn() as any };
    const when = new Date('2026-07-14T00:00:00Z');
    await recordDecidedCase(mem, {
      transaction_id: 'txn-1', disposition: 'escalate', lane: 'structuring',
      risk_factors: ['structuring_pattern'], amount: 9500,
    }, when);

    expect(indexObservation).toHaveBeenCalledTimes(1);
    const arg = indexObservation.mock.calls[0]![0];
    expect(arg.groupId).toBe('txn-1');
    expect(arg.resourceId).toBe(FRAUD_DESK_RESOURCE);
    expect(arg.threadId).toBe(INSTITUTIONAL_THREAD);
    expect(arg.observedAt).toBe(when);
    expect(arg.text).toContain('txn-1');
    expect(arg.text).toContain('escalate');
  });
});

describe('recallSimilarVerdicts', () => {
  it('queries the fraud-desk resource and maps groupId->transaction_id, dropping groupless hits', async () => {
    const searchMessages = vi.fn(async () => ({
      results: [
        { threadId: 'institutional-memory', score: 0.9, groupId: 'txn-a', text: 'Case txn-a decided reject.' },
        { threadId: 'institutional-memory', score: 0.7, text: 'no group id — dropped' },
      ],
    }));
    const mem: InstitutionalMemory = { indexObservation: vi.fn() as any, searchMessages };
    const out = await recallSimilarVerdicts(mem, 'suspicious wire', 2);

    expect(searchMessages).toHaveBeenCalledWith({ query: 'suspicious wire', resourceId: FRAUD_DESK_RESOURCE, topK: 2 });
    expect(out).toEqual([{ transaction_id: 'txn-a', score: 0.9, summary: 'Case txn-a decided reject.' }]);
  });

  it('defaults topK to 3', async () => {
    const searchMessages = vi.fn(async () => ({ results: [] }));
    const mem: InstitutionalMemory = { indexObservation: vi.fn() as any, searchMessages };
    await recallSimilarVerdicts(mem, 'q');
    expect(searchMessages).toHaveBeenCalledWith({ query: 'q', resourceId: FRAUD_DESK_RESOURCE, topK: 3 });
  });
});
