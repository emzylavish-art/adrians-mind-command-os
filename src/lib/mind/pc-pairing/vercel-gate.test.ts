import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  PcApprovalStorageUnavailableError,
  createPcApproval,
  listPendingApprovals,
  consumePcApproval,
  denyPcApproval,
  setPcApprovalDirectory,
} from './approvals.ts';

// This gate does not provide durable storage. Local filesystem consumption
// remains concurrency-unsafe on multi-process persistent hosts.
test('Vercel callers cannot create, list, consume, or deny approvals', async () => {
  const previousVercel = process.env.VERCEL;
  const root = mkdtempSync(join(tmpdir(), 'pc-approval-vercel-'));
  const directory = join(root, 'approvals');
  const ownerId = 'test-owner';
  const approvalId = 'A'.repeat(24);
  const token = 'test-token';

  try {
    setPcApprovalDirectory(directory);
    process.env.VERCEL = '1';

    const callers = [
      {
        name: 'create',
        call: () => createPcApproval({
          ownerId,
          command: 'echo approval-storage-gate-test',
          agentId: 'test-agent',
          agentLabel: 'Test agent',
        }),
      },
      { name: 'list', call: () => listPendingApprovals(ownerId) },
      {
        name: 'consume',
        call: () => consumePcApproval({ ownerId, approvalId, token }),
      },
      {
        name: 'deny (through readRecord)',
        call: () => denyPcApproval({ ownerId, approvalId, token }),
      },
    ];

    for (const { name, call } of callers) {
      await assert.rejects(
        async () => { await call(); },
        PcApprovalStorageUnavailableError,
        `${name} must fail closed on Vercel`,
      );
      assert.equal(existsSync(directory), false, `${name} created storage`);
      assert.deepEqual(readdirSync(root), [], `${name} touched the fake directory`);
    }
  } finally {
    if (previousVercel === undefined) {
      delete process.env.VERCEL;
    } else {
      process.env.VERCEL = previousVercel;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
