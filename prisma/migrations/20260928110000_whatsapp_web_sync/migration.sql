ALTER TABLE `WhatsAppMessage`
  ADD COLUMN `source` VARCHAR(24) NOT NULL DEFAULT 'legacy',
  ADD COLUMN `sourceMessageId` TEXT NULL,
  ADD COLUMN `sourceKey` CHAR(64) NULL,
  ADD COLUMN `attachmentMetadata` TEXT NULL;

CREATE UNIQUE INDEX `WhatsAppMessage_sourceKey_key` ON `WhatsAppMessage`(`sourceKey`);

CREATE TABLE `WhatsAppSyncToken` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `label` VARCHAR(80) NOT NULL,
  `accountPhone` VARCHAR(16) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  `revokedAt` DATETIME(3) NULL,
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `WhatsAppSyncToken_tokenHash_key`(`tokenHash`),
  INDEX `WhatsAppSyncToken_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppSyncRun` (
  `id` VARCHAR(191) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `accountPhone` VARCHAR(16) NOT NULL,
  `success` INTEGER NOT NULL DEFAULT 0,
  `skipped` INTEGER NOT NULL DEFAULT 0,
  `failed` INTEGER NOT NULL DEFAULT 0,
  `unmatched` INTEGER NOT NULL DEFAULT 0,
  `errors` TEXT NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `WhatsAppSyncRun_userId_createdAt_idx`(`userId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `WhatsAppUnmatchedMessage` (
  `id` VARCHAR(191) NOT NULL,
  `sourceKey` CHAR(64) NOT NULL,
  `userId` VARCHAR(191) NOT NULL,
  `accountPhone` VARCHAR(16) NOT NULL,
  `conversationId` VARCHAR(191) NOT NULL,
  `sourceMessageId` TEXT NOT NULL,
  `peerPhone` VARCHAR(16) NULL,
  `peerName` VARCHAR(191) NOT NULL DEFAULT '',
  `direction` VARCHAR(8) NOT NULL,
  `sentAt` DATETIME(3) NOT NULL,
  `text` TEXT NOT NULL,
  `attachments` TEXT NOT NULL,
  `reason` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  `customerId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `WhatsAppUnmatchedMessage_sourceKey_key`(`sourceKey`),
  INDEX `WhatsAppUnmatchedMessage_userId_status_createdAt_idx`(`userId`, `status`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
