-- AlterTable
ALTER TABLE `User` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `sessionVersion` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `assignedAt` DATETIME(3) NULL,
    ADD COLUMN `firstContactAt` DATETIME(3) NULL,
    ADD COLUMN `firstContactBy` VARCHAR(191) NULL,
    ADD COLUMN `firstContactDueAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Deal` ADD COLUMN `salespersonId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `firstContactHours` INTEGER NOT NULL DEFAULT 24;

-- CreateTable
CREATE TABLE `UserSalesTarget` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `month` VARCHAR(7) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `targetRevenue` DECIMAL(14, 2) NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `UserSalesTarget_month_idx`(`month`),
    UNIQUE INDEX `UserSalesTarget_userId_month_currency_key`(`userId`, `month`, `currency`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CustomerAssignment` (
    `id` VARCHAR(191) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `fromOwnerId` VARCHAR(191) NULL,
    `toOwnerId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CustomerAssignment_customerId_assignedAt_idx`(`customerId`, `assignedAt`),
    INDEX `CustomerAssignment_toOwnerId_assignedAt_idx`(`toOwnerId`, `assignedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AccountAudit` (
    `id` VARCHAR(191) NOT NULL,
    `subjectId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(32) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AccountAudit_subjectId_createdAt_idx`(`subjectId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Customer_firstContactDueAt_idx` ON `Customer`(`firstContactDueAt`);

-- CreateIndex
CREATE INDEX `Deal_salespersonId_dealDate_idx` ON `Deal`(`salespersonId`, `dealDate`);

-- AddForeignKey
ALTER TABLE `UserSalesTarget` ADD CONSTRAINT `UserSalesTarget_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CustomerAssignment` ADD CONSTRAINT `CustomerAssignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

