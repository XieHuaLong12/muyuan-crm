-- AlterTable
ALTER TABLE `FocusGoal` ADD COLUMN `currentValue` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `targetValue` INTEGER NULL,
    ADD COLUMN `unit` VARCHAR(8) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `WorkItem` ADD COLUMN `topOrder` INTEGER NULL;

-- CreateTable
CREATE TABLE `DailyReview` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `status` VARCHAR(10) NOT NULL DEFAULT 'DRAFT',
    `items` JSON NOT NULL,
    `done` INTEGER NOT NULL DEFAULT 0,
    `planned` INTEGER NOT NULL DEFAULT 0,
    `carried` INTEGER NOT NULL DEFAULT 0,
    `dropped` INTEGER NOT NULL DEFAULT 0,
    `wins` VARCHAR(1000) NOT NULL DEFAULT '',
    `problems` VARCHAR(1000) NOT NULL DEFAULT '',
    `improvement` VARCHAR(200) NOT NULL DEFAULT '',
    `lastImprovement` VARCHAR(8) NULL,
    `energy` INTEGER NULL,
    `focusLevel` INTEGER NULL,
    `plan` JSON NOT NULL,
    `metrics` JSON NULL,
    `submittedAt` DATETIME(3) NULL,
    `remindedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `DailyReview_userId_status_date_idx`(`userId`, `status`, `date`),
    UNIQUE INDEX `DailyReview_userId_date_key`(`userId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyReviewRevision` (
    `id` VARCHAR(191) NOT NULL,
    `reviewId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `changes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DailyReviewRevision_reviewId_createdAt_idx`(`reviewId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FocusProgressLog` (
    `id` VARCHAR(191) NOT NULL,
    `focusId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `date` VARCHAR(10) NOT NULL,
    `fromValue` INTEGER NOT NULL,
    `toValue` INTEGER NOT NULL,
    `target` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FocusProgressLog_focusId_createdAt_idx`(`focusId`, `createdAt`),
    INDEX `FocusProgressLog_date_idx`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `DailyReviewRevision` ADD CONSTRAINT `DailyReviewRevision_reviewId_fkey` FOREIGN KEY (`reviewId`) REFERENCES `DailyReview`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FocusProgressLog` ADD CONSTRAINT `FocusProgressLog_focusId_fkey` FOREIGN KEY (`focusId`) REFERENCES `FocusGoal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

