-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `leadGrade` VARCHAR(1) NOT NULL DEFAULT '',
    ADD COLUMN `leadGradeReason` VARCHAR(500) NOT NULL DEFAULT '',
    ADD COLUMN `leadGradeSource` VARCHAR(8) NOT NULL DEFAULT '',
    ADD COLUMN `leadGradedAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `pushPrivateKey` VARCHAR(255) NOT NULL DEFAULT '',
    ADD COLUMN `pushPublicKey` VARCHAR(255) NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE `PushSubscription` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(768) NOT NULL,
    `p256dh` VARCHAR(255) NOT NULL,
    `auth` VARCHAR(255) NOT NULL,
    `userAgent` VARCHAR(255) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSuccessAt` DATETIME(3) NULL,
    `failures` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `PushSubscription_endpoint_key`(`endpoint`),
    INDEX `PushSubscription_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeadAlert` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(16) NOT NULL,
    `recipientId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `sentAt` DATETIME(3) NULL,

    INDEX `LeadAlert_sentAt_createdAt_idx`(`sentAt`, `createdAt`),
    INDEX `LeadAlert_customerId_idx`(`customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_leadGrade_idx` ON `Customer`(`leadGrade`);

-- AddForeignKey
ALTER TABLE `PushSubscription` ADD CONSTRAINT `PushSubscription_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeadAlert` ADD CONSTRAINT `LeadAlert_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
