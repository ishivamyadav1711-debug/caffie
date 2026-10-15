import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OwnershipGuard } from '../lib/auth/ownershipGuard';
import { GmailEmailProvider } from '../lib/outreach/providers/gmailProvider';
import { SenderPoolService } from '../lib/senders/senderPoolService';
import { prisma } from '../lib/prisma';
import { encrypt } from '../lib/auth/crypto';

// Setup environment for testing
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 1).toString('base64');
process.env.JWT_SECRET = 'test-secret-at-least-32-chars-long-here-1234';
process.env.GOOGLE_CLIENT_ID = 'mock-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'mock-google-client-secret';

vi.mock('../lib/prisma', () => ({
  prisma: {
    senderAccount: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    campaign: {
      findUnique: vi.fn(),
    },
    outreach: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

describe('GATE 5: Multi-Sender Isolation Matrix (User A vs User B)', () => {
  const userA = 'user-uuid-aaa';
  const userB = 'user-uuid-bbb';

  const senderA = {
    id: 'sender-acc-aaa',
    userId: userA,
    email: 'userA@company.com',
    displayName: 'User A Mailbox',
    provider: 'gmail',
    accessToken: encrypt('token-user-a'),
    refreshToken: encrypt('refresh-user-a'),
    tokenExpiry: new Date(Date.now() + 3600000),
    status: 'CONNECTED',
    scopes: 'https://www.googleapis.com/auth/gmail.send',
    createdAt: new Date(),
  };

  const senderB = {
    id: 'sender-acc-bbb',
    userId: userB,
    email: 'userB@company.com',
    displayName: 'User B Mailbox',
    provider: 'gmail',
    accessToken: encrypt('token-user-b'),
    refreshToken: encrypt('refresh-user-b'),
    tokenExpiry: new Date(Date.now() + 3600000),
    status: 'CONNECTED',
    scopes: 'https://www.googleapis.com/auth/gmail.send',
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('1. User A can validate and use Sender A', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderA);
    const check = await OwnershipGuard.validateSenderOwnership(userA, senderA.id);
    expect(check.valid).toBe(true);
    expect(check.senderAccount?.id).toBe(senderA.id);
  });

  it('2. User B can validate and use Sender B', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderB);
    const check = await OwnershipGuard.validateSenderOwnership(userB, senderB.id);
    expect(check.valid).toBe(true);
    expect(check.senderAccount?.id).toBe(senderB.id);
  });

  it('3. User A cannot use Sender B (SENDER_OWNERSHIP_VIOLATION)', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderB);
    const check = await OwnershipGuard.validateSenderOwnership(userA, senderB.id);
    expect(check.valid).toBe(false);
    expect(check.errorCode).toBe('SENDER_OWNERSHIP_VIOLATION');
  });

  it('4. User B cannot use Sender A (SENDER_OWNERSHIP_VIOLATION)', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderA);
    const check = await OwnershipGuard.validateSenderOwnership(userB, senderA.id);
    expect(check.valid).toBe(false);
    expect(check.errorCode).toBe('SENDER_OWNERSHIP_VIOLATION');
  });

  it('5. Changing senderAccountId in send payload cannot bypass ownership', async () => {
    // User A attempts to send using Sender B's ID
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderB);

    const provider = new GmailEmailProvider();
    const result = await provider.sendEmail({
      to: 'target@example.com',
      subject: 'Hello',
      bodyText: 'Message',
      senderAccountId: senderB.id,
      userId: userA, // Authenticated as User A
    } as any);

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('SENDER_OWNERSHIP_VIOLATION');
  });

  it('6. Campaign sender ownership is enforced server-side', async () => {
    // Campaign belongs to User A, but references Sender B
    (prisma.campaign.findUnique as any).mockResolvedValue({
      id: 'camp-1',
      userId: userA,
      senderAccountId: senderB.id,
      senderAccount: senderB,
    });

    const check = await OwnershipGuard.validateCampaignSender(userA, 'camp-1');
    expect(check.valid).toBe(false);
    expect(check.errorCode).toBe('SENDER_OWNERSHIP_VIOLATION');
  });

  it('7. Sender tokens cannot cross users and are never exposed in sender pool', async () => {
    (prisma.senderAccount.findMany as any).mockResolvedValue([senderA]);
    (prisma.outreach.groupBy as any).mockResolvedValue([]);

    const poolA = await SenderPoolService.getSenderPool(userA);
    expect(prisma.senderAccount.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: userA },
      })
    );
    expect(poolA.senders.length).toBe(1);
    expect(poolA.senders[0].email).toBe('userA@company.com');
    // Ensure tokens are NEVER returned
    expect((poolA.senders[0] as any).accessToken).toBeUndefined();
    expect((poolA.senders[0] as any).refreshToken).toBeUndefined();
  });

  it('8. Disconnecting Sender A does not affect Sender B', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderA);
    (prisma.senderAccount.update as any).mockResolvedValue({
      ...senderA,
      status: 'DISCONNECTED',
    });

    await SenderPoolService.disconnectSender(userA, senderA.id);

    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: senderA.id },
      data: { status: 'DISCONNECTED' },
    });
    // Sender B was never touched
    expect(prisma.senderAccount.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: senderB.id },
      })
    );

    // Also verify User A attempting to disconnect Sender B throws error
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderB);
    await expect(SenderPoolService.disconnectSender(userA, senderB.id)).rejects.toThrow(
      'Sender account not found or not owned by user.'
    );
  });

  it('9. Gmail sending uses the authenticated user owned sender account', async () => {
    (prisma.senderAccount.findUnique as any).mockResolvedValue(senderA);
    (prisma.senderAccount.update as any).mockResolvedValue(senderA);

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'gmail-msg-isolated-1', threadId: 'gmail-th-isolated-1' }),
    } as any);

    const provider = new GmailEmailProvider();
    const result = await provider.sendEmail({
      to: 'target@example.com',
      subject: 'Isolated Send',
      bodyText: 'Isolated Text',
      senderAccountId: senderA.id,
      userId: userA,
    } as any);

    expect(result.success).toBe(true);
    expect(result.gmailMessageId).toBe('gmail-msg-isolated-1');

    global.fetch = originalFetch;
  });

  it('10. No cross-user data appears in sender lists', async () => {
    (prisma.senderAccount.findMany as any).mockImplementation(({ where }: any) => {
      if (where.userId === userA) return Promise.resolve([senderA]);
      if (where.userId === userB) return Promise.resolve([senderB]);
      return Promise.resolve([]);
    });
    (prisma.outreach.groupBy as any).mockResolvedValue([]);

    const poolA = await SenderPoolService.getSenderPool(userA);
    const poolB = await SenderPoolService.getSenderPool(userB);

    expect(poolA.senders.map((s) => s.email)).toEqual(['userA@company.com']);
    expect(poolB.senders.map((s) => s.email)).toEqual(['userB@company.com']);
    expect(poolA.senders.find((s) => s.email === 'userB@company.com')).toBeUndefined();
    expect(poolB.senders.find((s) => s.email === 'userA@company.com')).toBeUndefined();
  });
});
