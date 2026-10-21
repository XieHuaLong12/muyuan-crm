-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `bestReplyQuality` VARCHAR(12) NOT NULL DEFAULT '',
    ADD COLUMN `outreachDueAt` DATETIME(3) NULL,
    ADD COLUMN `outreachNext` VARCHAR(4) NOT NULL DEFAULT '',
    ADD COLUMN `outreachState` VARCHAR(12) NOT NULL DEFAULT '',
    ADD COLUMN `replyScriptCode` VARCHAR(32) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `outreachConfig` JSON NULL,
    ADD COLUMN `outreachStartedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `WhatsAppMessage` ADD COLUMN `sentById` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `OutreachScript` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `position` VARCHAR(4) NOT NULL,
    `grades` VARCHAR(8) NOT NULL,
    `language` VARCHAR(4) NOT NULL,
    `content` TEXT NOT NULL,
    `versionNote` VARCHAR(300) NOT NULL DEFAULT '',
    `status` VARCHAR(16) NOT NULL DEFAULT 'TESTING',
    `templateName` VARCHAR(200) NULL,
    `buttonQualities` JSON NULL,
    `firstSentAt` DATETIME(3) NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OutreachScript_code_key`(`code`),
    INDEX `OutreachScript_position_status_idx`(`position`, `status`),
    INDEX `OutreachScript_templateName_idx`(`templateName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `position` VARCHAR(4) NOT NULL,
    `cycle` INTEGER NOT NULL DEFAULT 0,
    `scriptId` VARCHAR(191) NOT NULL,
    `grade` VARCHAR(1) NOT NULL DEFAULT '',
    `language` VARCHAR(4) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `touchId` VARCHAR(191) NULL,

    UNIQUE INDEX `OutreachAssignment_touchId_key`(`touchId`),
    INDEX `OutreachAssignment_scriptId_idx`(`scriptId`),
    INDEX `OutreachAssignment_position_grade_language_idx`(`position`, `grade`, `language`),
    UNIQUE INDEX `OutreachAssignment_customerId_position_cycle_key`(`customerId`, `position`, `cycle`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachTouch` (
    `id` VARCHAR(191) NOT NULL,
    `groupKey` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `code` VARCHAR(4) NOT NULL,
    `cycle` INTEGER NOT NULL DEFAULT 0,
    `scriptId` VARCHAR(191) NULL,
    `matchType` VARCHAR(8) NOT NULL DEFAULT '',
    `confidence` DECIMAL(4, 3) NULL,
    `intent` VARCHAR(12) NOT NULL DEFAULT '',
    `judgeStatus` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `judgedBy` VARCHAR(8) NOT NULL DEFAULT '',
    `judgeReason` VARCHAR(500) NOT NULL DEFAULT '',
    `judgedAt` DATETIME(3) NULL,
    `senderId` VARCHAR(191) NULL,
    `sentAt` DATETIME(3) NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `windowOpen` BOOLEAN NOT NULL DEFAULT false,
    `grade` VARCHAR(1) NOT NULL DEFAULT '',
    `language` VARCHAR(4) NOT NULL DEFAULT '',
    `tooSoon` BOOLEAN NOT NULL DEFAULT false,
    `replyId` VARCHAR(191) NULL,
    `repliedAt` DATETIME(3) NULL,
    `replied24h` BOOLEAN NULL,
    `lateReply` BOOLEAN NOT NULL DEFAULT false,
    `replyQuality` VARCHAR(12) NOT NULL DEFAULT '',
    `replySignals` JSON NULL,
    `text` TEXT NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 1,
    `humanEdited` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OutreachTouch_groupKey_key`(`groupKey`),
    UNIQUE INDEX `OutreachTouch_replyId_key`(`replyId`),
    INDEX `OutreachTouch_customerId_sentAt_idx`(`customerId`, `sentAt`),
    INDEX `OutreachTouch_code_sentAt_idx`(`code`, `sentAt`),
    INDEX `OutreachTouch_scriptId_sentAt_idx`(`scriptId`, `sentAt`),
    INDEX `OutreachTouch_judgeStatus_idx`(`judgeStatus`),
    INDEX `OutreachTouch_senderId_sentAt_idx`(`senderId`, `sentAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachReply` (
    `id` VARCHAR(191) NOT NULL,
    `groupKey` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `touchId` VARCHAR(191) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `quality` VARCHAR(12) NOT NULL DEFAULT '',
    `signals` JSON NULL,
    `needsHuman` BOOLEAN NOT NULL DEFAULT false,
    `gradeSuggestion` VARCHAR(1) NOT NULL DEFAULT '',
    `gradeSuggestionStatus` VARCHAR(12) NOT NULL DEFAULT '',
    `nextStep` VARCHAR(300) NOT NULL DEFAULT '',
    `reason` VARCHAR(500) NOT NULL DEFAULT '',
    `judgeStatus` VARCHAR(12) NOT NULL DEFAULT 'PENDING',
    `judgedBy` VARCHAR(8) NOT NULL DEFAULT '',
    `judgedAt` DATETIME(3) NULL,
    `text` TEXT NOT NULL,
    `contentHash` CHAR(64) NOT NULL,
    `messageCount` INTEGER NOT NULL DEFAULT 1,
    `humanEdited` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `OutreachReply_groupKey_key`(`groupKey`),
    INDEX `OutreachReply_customerId_receivedAt_idx`(`customerId`, `receivedAt`),
    INDEX `OutreachReply_touchId_idx`(`touchId`),
    INDEX `OutreachReply_judgeStatus_idx`(`judgeStatus`),
    INDEX `OutreachReply_quality_receivedAt_idx`(`quality`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachOverride` (
    `id` VARCHAR(191) NOT NULL,
    `touchId` VARCHAR(191) NULL,
    `replyId` VARCHAR(191) NULL,
    `field` VARCHAR(16) NOT NULL,
    `oldValue` TEXT NOT NULL,
    `newValue` TEXT NOT NULL,
    `reason` VARCHAR(16) NOT NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `aiOriginal` BOOLEAN NOT NULL DEFAULT false,
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `OutreachOverride_touchId_idx`(`touchId`),
    INDEX `OutreachOverride_replyId_idx`(`replyId`),
    INDEX `OutreachOverride_createdAt_idx`(`createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OutreachReport` (
    `id` VARCHAR(191) NOT NULL,
    `weekStart` VARCHAR(10) NOT NULL,
    `lines` JSON NOT NULL,
    `generatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `OutreachReport_weekStart_key`(`weekStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FocusGoal` (
    `id` VARCHAR(191) NOT NULL,
    `level` VARCHAR(8) NOT NULL,
    `periodKey` VARCHAR(10) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `target` VARCHAR(200) NOT NULL DEFAULT '',
    `progress` INTEGER NOT NULL DEFAULT 0,
    `parentId` VARCHAR(191) NULL,
    `status` VARCHAR(8) NOT NULL DEFAULT 'TODO',
    `category` VARCHAR(12) NOT NULL DEFAULT 'CONVERT',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `FocusGoal_level_periodKey_idx`(`level`, `periodKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `WorkItem` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `endDate` VARCHAR(10) NULL,
    `title` VARCHAR(200) NOT NULL,
    `detail` VARCHAR(1000) NOT NULL DEFAULT '',
    `kind` VARCHAR(12) NOT NULL DEFAULT 'MANUAL',
    `category` VARCHAR(12) NOT NULL DEFAULT 'CONVERT',
    `focusId` VARCHAR(191) NULL,
    `startTime` VARCHAR(5) NULL,
    `endTime` VARCHAR(5) NULL,
    `pin` INTEGER NOT NULL DEFAULT 0,
    `status` VARCHAR(8) NOT NULL DEFAULT 'TODO',
    `doneAt` DATETIME(3) NULL,
    `carryCount` INTEGER NOT NULL DEFAULT 0,
    `originalDate` VARCHAR(10) NULL,
    `sourceKey` VARCHAR(120) NULL,
    `href` VARCHAR(300) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WorkItem_userId_date_idx`(`userId`, `date`),
    INDEX `WorkItem_userId_status_date_idx`(`userId`, `status`, `date`),
    INDEX `WorkItem_kind_date_idx`(`kind`, `date`),
    UNIQUE INDEX `WorkItem_userId_date_sourceKey_key`(`userId`, `date`, `sourceKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TimeBlock` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `startTime` VARCHAR(5) NOT NULL,
    `endTime` VARCHAR(5) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `category` VARCHAR(12) NOT NULL DEFAULT 'CONVERT',
    `weekdays` VARCHAR(16) NOT NULL DEFAULT '1,2,3,4,5',
    `sort` INTEGER NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `TimeBlock_userId_active_idx`(`userId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_outreachState_idx` ON `Customer`(`outreachState`);

-- CreateIndex
CREATE INDEX `Customer_outreachDueAt_idx` ON `Customer`(`outreachDueAt`);

-- AddForeignKey
ALTER TABLE `OutreachAssignment` ADD CONSTRAINT `OutreachAssignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachAssignment` ADD CONSTRAINT `OutreachAssignment_scriptId_fkey` FOREIGN KEY (`scriptId`) REFERENCES `OutreachScript`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachTouch` ADD CONSTRAINT `OutreachTouch_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachTouch` ADD CONSTRAINT `OutreachTouch_scriptId_fkey` FOREIGN KEY (`scriptId`) REFERENCES `OutreachScript`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachReply` ADD CONSTRAINT `OutreachReply_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachOverride` ADD CONSTRAINT `OutreachOverride_touchId_fkey` FOREIGN KEY (`touchId`) REFERENCES `OutreachTouch`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OutreachOverride` ADD CONSTRAINT `OutreachOverride_replyId_fkey` FOREIGN KEY (`replyId`) REFERENCES `OutreachReply`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FocusGoal` ADD CONSTRAINT `FocusGoal_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `FocusGoal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `WorkItem` ADD CONSTRAINT `WorkItem_focusId_fkey` FOREIGN KEY (`focusId`) REFERENCES `FocusGoal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

