-- Migration: 20261004172000_production_schema_alignment
-- Purely additive alignment for LeadPilot authentication, sender pool, and outreach automation.

-- =========================================================================
-- 1. ADD MISSING COLUMNS TO EXISTING TABLES
-- =========================================================================

-- User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "image" TEXT;
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'USER';

-- Campaign
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "senderAccountId" TEXT;
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "scheduleType" TEXT NOT NULL DEFAULT 'IMMEDIATE';
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "dailyLimit" INTEGER NOT NULL DEFAULT 50;

-- Outreach
ALTER TABLE "Outreach" ADD COLUMN IF NOT EXISTS "gmailMessageId" TEXT;
ALTER TABLE "Outreach" ADD COLUMN IF NOT EXISTS "gmailThreadId" TEXT;
ALTER TABLE "Outreach" ADD COLUMN IF NOT EXISTS "senderAccountId" TEXT;

-- =========================================================================
-- 2. CREATE NEW TABLES (DEPENDENCY-ORDERED)
-- =========================================================================

-- SenderAccount (Depends on User)
CREATE TABLE IF NOT EXISTS "SenderAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gmail',
    "email" TEXT NOT NULL,
    "displayName" TEXT,
    "providerAccountId" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "scopes" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderAccount_pkey" PRIMARY KEY ("id")
);

-- Account (Depends on User)
CREATE TABLE IF NOT EXISTS "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'oauth',
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refreshToken" TEXT,
    "accessToken" TEXT,
    "tokenExpiry" TIMESTAMP(3),
    "scope" TEXT,
    "idToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- Session (Depends on User)
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CampaignLead (Depends on Campaign, Business)
CREATE TABLE IF NOT EXISTS "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "stopReason" TEXT,
    "customSubject" TEXT,
    "customBody" TEXT,
    "aiPersonalization" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextFollowupAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CampaignStep (Depends on Campaign)
CREATE TABLE IF NOT EXISTS "CampaignStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepNumber" INTEGER NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 0,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "templateSubject" TEXT,
    "templateBody" TEXT NOT NULL,
    "useAiPersonalization" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignStep_pkey" PRIMARY KEY ("id")
);

-- InboundReply (Depends on Campaign, Business, Outreach)
CREATE TABLE IF NOT EXISTS "InboundReply" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "leadId" TEXT,
    "outreachId" TEXT,
    "provider" TEXT NOT NULL,
    "providerEventId" TEXT,
    "messageId" TEXT,
    "threadId" TEXT,
    "inReplyTo" TEXT,
    "fromEmail" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "classificationReason" TEXT,
    "actionTaken" TEXT,
    "aiDraftResponse" TEXT,
    "isApproved" BOOLEAN NOT NULL DEFAULT false,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InboundReply_pkey" PRIMARY KEY ("id")
);

-- EmailEvent (Depends on Campaign, Business, Outreach)
CREATE TABLE IF NOT EXISTS "EmailEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "leadId" TEXT,
    "outreachId" TEXT,
    "eventType" TEXT NOT NULL,
    "provider" TEXT,
    "providerEventId" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailEvent_pkey" PRIMARY KEY ("id")
);

-- Meeting (Depends on Business, Campaign, InboundReply)
CREATE TABLE IF NOT EXISTS "Meeting" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "replyId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'REQUESTED',
    "startTime" TIMESTAMP(3),
    "endTime" TIMESTAMP(3),
    "timeZone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "meetingUrl" TEXT,
    "calendarProvider" TEXT,
    "calendarEventId" TEXT,
    "attendeeEmail" TEXT NOT NULL,
    "attendeeName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- WebsiteDemo (Depends on Business)
CREATE TABLE IF NOT EXISTS "WebsiteDemo" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "previewSlug" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "originalUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "htmlContent" TEXT,
    "cssContent" TEXT,
    "previewUrl" TEXT,
    "improvementsApplied" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteDemo_pkey" PRIMARY KEY ("id")
);

-- =========================================================================
-- 3. CREATE INDEXES AND UNIQUE CONSTRAINTS
-- =========================================================================

-- CampaignLead
CREATE INDEX IF NOT EXISTS "CampaignLead_campaignId_idx" ON "CampaignLead"("campaignId");
CREATE INDEX IF NOT EXISTS "CampaignLead_leadId_idx" ON "CampaignLead"("leadId");
CREATE INDEX IF NOT EXISTS "CampaignLead_status_idx" ON "CampaignLead"("status");
CREATE INDEX IF NOT EXISTS "CampaignLead_nextFollowupAt_idx" ON "CampaignLead"("nextFollowupAt");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignLead_campaignId_leadId_key" ON "CampaignLead"("campaignId", "leadId");

-- CampaignStep
CREATE INDEX IF NOT EXISTS "CampaignStep_campaignId_idx" ON "CampaignStep"("campaignId");
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignStep_campaignId_stepNumber_key" ON "CampaignStep"("campaignId", "stepNumber");

-- InboundReply
CREATE INDEX IF NOT EXISTS "InboundReply_campaignId_idx" ON "InboundReply"("campaignId");
CREATE INDEX IF NOT EXISTS "InboundReply_leadId_idx" ON "InboundReply"("leadId");
CREATE INDEX IF NOT EXISTS "InboundReply_outreachId_idx" ON "InboundReply"("outreachId");
CREATE INDEX IF NOT EXISTS "InboundReply_classification_idx" ON "InboundReply"("classification");
CREATE INDEX IF NOT EXISTS "InboundReply_fromEmail_idx" ON "InboundReply"("fromEmail");

-- EmailEvent
CREATE INDEX IF NOT EXISTS "EmailEvent_campaignId_idx" ON "EmailEvent"("campaignId");
CREATE INDEX IF NOT EXISTS "EmailEvent_leadId_idx" ON "EmailEvent"("leadId");
CREATE INDEX IF NOT EXISTS "EmailEvent_eventType_idx" ON "EmailEvent"("eventType");
CREATE INDEX IF NOT EXISTS "EmailEvent_createdAt_idx" ON "EmailEvent"("createdAt");

-- Meeting
CREATE INDEX IF NOT EXISTS "Meeting_leadId_idx" ON "Meeting"("leadId");
CREATE INDEX IF NOT EXISTS "Meeting_campaignId_idx" ON "Meeting"("campaignId");
CREATE INDEX IF NOT EXISTS "Meeting_status_idx" ON "Meeting"("status");

-- WebsiteDemo
CREATE UNIQUE INDEX IF NOT EXISTS "WebsiteDemo_previewSlug_key" ON "WebsiteDemo"("previewSlug");
CREATE INDEX IF NOT EXISTS "WebsiteDemo_leadId_idx" ON "WebsiteDemo"("leadId");
CREATE INDEX IF NOT EXISTS "WebsiteDemo_previewSlug_idx" ON "WebsiteDemo"("previewSlug");
CREATE INDEX IF NOT EXISTS "WebsiteDemo_status_idx" ON "WebsiteDemo"("status");

-- Account
CREATE INDEX IF NOT EXISTS "Account_userId_idx" ON "Account"("userId");
CREATE UNIQUE INDEX IF NOT EXISTS "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- Session
CREATE UNIQUE INDEX IF NOT EXISTS "Session_sessionToken_key" ON "Session"("sessionToken");
CREATE INDEX IF NOT EXISTS "Session_userId_idx" ON "Session"("userId");

-- SenderAccount
CREATE INDEX IF NOT EXISTS "SenderAccount_userId_idx" ON "SenderAccount"("userId");
CREATE INDEX IF NOT EXISTS "SenderAccount_email_idx" ON "SenderAccount"("email");
CREATE INDEX IF NOT EXISTS "SenderAccount_status_idx" ON "SenderAccount"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "SenderAccount_userId_email_provider_key" ON "SenderAccount"("userId", "email", "provider");

-- Existing tables newly added column indexes
CREATE INDEX IF NOT EXISTS "Campaign_userId_idx" ON "Campaign"("userId");
CREATE INDEX IF NOT EXISTS "Campaign_senderAccountId_idx" ON "Campaign"("senderAccountId");
CREATE INDEX IF NOT EXISTS "Outreach_senderAccountId_idx" ON "Outreach"("senderAccountId");
CREATE INDEX IF NOT EXISTS "Outreach_gmailThreadId_idx" ON "Outreach"("gmailThreadId");

-- =========================================================================
-- 4. ADD FOREIGN KEY CONSTRAINTS (IDEMPOTENT VIA DO BLOCKS)
-- =========================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Outreach_senderAccountId_fkey') THEN
    ALTER TABLE "Outreach" ADD CONSTRAINT "Outreach_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "SenderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_userId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Campaign_senderAccountId_fkey') THEN
    ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderAccountId_fkey" FOREIGN KEY ("senderAccountId") REFERENCES "SenderAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignLead_campaignId_fkey') THEN
    ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignLead_leadId_fkey') THEN
    ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignStep_campaignId_fkey') THEN
    ALTER TABLE "CampaignStep" ADD CONSTRAINT "CampaignStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InboundReply_campaignId_fkey') THEN
    ALTER TABLE "InboundReply" ADD CONSTRAINT "InboundReply_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InboundReply_leadId_fkey') THEN
    ALTER TABLE "InboundReply" ADD CONSTRAINT "InboundReply_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'InboundReply_outreachId_fkey') THEN
    ALTER TABLE "InboundReply" ADD CONSTRAINT "InboundReply_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailEvent_campaignId_fkey') THEN
    ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailEvent_leadId_fkey') THEN
    ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'EmailEvent_outreachId_fkey') THEN
    ALTER TABLE "EmailEvent" ADD CONSTRAINT "EmailEvent_outreachId_fkey" FOREIGN KEY ("outreachId") REFERENCES "Outreach"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_leadId_fkey') THEN
    ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_campaignId_fkey') THEN
    ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Meeting_replyId_fkey') THEN
    ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "InboundReply"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WebsiteDemo_leadId_fkey') THEN
    ALTER TABLE "WebsiteDemo" ADD CONSTRAINT "WebsiteDemo_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Account_userId_fkey') THEN
    ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Session_userId_fkey') THEN
    ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SenderAccount_userId_fkey') THEN
    ALTER TABLE "SenderAccount" ADD CONSTRAINT "SenderAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
