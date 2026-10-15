import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AdaptiveCapacityEngine } from '@/lib/senders/adaptiveCapacityEngine';
import { prisma } from '@/lib/prisma';
import { SenderHealthService } from '@/lib/senders/senderHealthService';
import { CapacityConfigService } from '@/lib/senders/capacityConfig';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    domainHealth: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    senderAccount: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    capacityHistory: {
      create: vi.fn(),
    }
  }
}));

vi.mock('@/lib/senders/senderHealthService', () => ({
  SenderHealthService: {
    evaluateSenderHealth: vi.fn(),
  }
}));

vi.mock('@/lib/senders/capacityConfig', () => ({
  CapacityConfigService: {
    getConfig: vi.fn(),
  }
}));

describe('AdaptiveCapacityEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (CapacityConfigService.getConfig as any).mockReturnValue({
      targetDailyCapacity: 500,
      maxPerSenderPerDay: 50,
      maxPerDomainPerDay: 100,
      maxTotalDailyOutreach: 500,
    });
  });

  it('1. starting capacity is respected and preserved if minimum time has not passed', async () => {
    const mockSender = {
      id: 'sender-1',
      currentCapacity: 25,
      startingCapacity: 25,
      configuredMaximum: 100,
      incrementStep: 5,
      lastCapacityChange: new Date(),
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'HEALTHY'
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'HEALTHY'
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    // Shouldn't update capacity because lastCapacityChange was just now
    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 25 })
    });
  });

  it('2. +5 ramp when HEALTHY and time passed', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const mockSender = {
      id: 'sender-1',
      currentCapacity: 25,
      startingCapacity: 25,
      configuredMaximum: 100,
      incrementStep: 5,
      lastCapacityChange: twoDaysAgo,
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'HEALTHY'
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'HEALTHY'
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 30 })
    });
  });

  it('3. maximum capacity is respected', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const mockSender = {
      id: 'sender-1',
      currentCapacity: 48,
      startingCapacity: 25,
      configuredMaximum: 50, // max is 50
      incrementStep: 5,
      lastCapacityChange: twoDaysAgo,
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'HEALTHY'
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'HEALTHY'
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 50 })
    });
  });

  it('5. warning sender holds capacity', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const mockSender = {
      id: 'sender-1',
      currentCapacity: 35,
      startingCapacity: 25,
      configuredMaximum: 50,
      incrementStep: 5,
      lastCapacityChange: twoDaysAgo,
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'WARNING'
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'HEALTHY'
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    // Capacity held at 35
    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 35 })
    });
  });

  it('6. critical/restricted sender reduces capacity by half', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const mockSender = {
      id: 'sender-1',
      currentCapacity: 40,
      startingCapacity: 10,
      configuredMaximum: 50,
      incrementStep: 5,
      lastCapacityChange: twoDaysAgo,
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'RESTRICTED'
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'HEALTHY'
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    // 40 / 2 = 20
    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 20 })
    });
  });

  it('7. pause sender', async () => {
    const mockSender = {
      id: 'sender-1',
      currentCapacity: 40,
      healthState: 'HEALTHY'
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    
    await AdaptiveCapacityEngine.pauseSender('sender-1', 'Manual Pause');

    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 0, healthState: 'PAUSED' })
    });
    
    expect(prisma.capacityHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ newCapacity: 0, reason: 'Manual Pause', healthState: 'PAUSED' })
    });
  });

  it('8. recovery sender resets to starting capacity', async () => {
    const mockSender = {
      id: 'sender-1',
      currentCapacity: 0,
      startingCapacity: 25,
      healthState: 'PAUSED'
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    
    await AdaptiveCapacityEngine.recoverSender('sender-1');

    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 25, healthState: 'HEALTHY', status: 'CONNECTED' })
    });
  });

  it('9 & 10. global capacity calculation matches target', async () => {
    (prisma.senderAccount.findMany as any).mockResolvedValue([
      { currentCapacity: 100 },
      { currentCapacity: 200 },
      { currentCapacity: 300 }
    ]);
    
    const result = await AdaptiveCapacityEngine.calculateGlobalCapacity();
    expect(result.totalAvailable).toBe(600);
    expect(result.targetDaily).toBe(500); // 600 > 500, can meet target easily
  });
  
  it('11. insufficient global capacity reports correct amount', async () => {
    (prisma.senderAccount.findMany as any).mockResolvedValue([
      { currentCapacity: 50 },
      { currentCapacity: 75 }
    ]);
    
    const result = await AdaptiveCapacityEngine.calculateGlobalCapacity();
    expect(result.totalAvailable).toBe(125);
    expect(result.targetDaily).toBe(500); // 125 < 500
  });
  
  it('13. domain-level freeze impacts sender', async () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

    const mockSender = {
      id: 'sender-1',
      currentCapacity: 40,
      startingCapacity: 25,
      configuredMaximum: 50,
      incrementStep: 5,
      lastCapacityChange: twoDaysAgo,
    };
    (prisma.senderAccount.findUnique as any).mockResolvedValue(mockSender);
    (SenderHealthService.evaluateSenderHealth as any).mockResolvedValue({
      domain: 'test.com',
      healthState: 'HEALTHY' // Sender is healthy
    });
    (prisma.domainHealth.findUnique as any).mockResolvedValue({
      healthState: 'CRITICAL' // Domain is critical
    });

    await AdaptiveCapacityEngine.calculateSenderCapacity('sender-1');

    // 40 / 2 = 20, but not lower than startingCapacity (25)
    expect(prisma.senderAccount.update).toHaveBeenCalledWith({
      where: { id: 'sender-1' },
      data: expect.objectContaining({ currentCapacity: 25 })
    });
  });
});
