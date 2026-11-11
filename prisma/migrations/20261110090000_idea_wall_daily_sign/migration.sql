-- CreateTable
CREATE TABLE `WallNote` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(8) NOT NULL,
    `text` TEXT NOT NULL,
    `source` VARCHAR(200) NOT NULL DEFAULT '',
    `linkUrl` VARCHAR(1000) NOT NULL DEFAULT '',
    `imageKey` VARCHAR(64) NULL,
    `imageType` VARCHAR(40) NULL,
    `color` VARCHAR(12) NOT NULL DEFAULT 'yellow',
    `status` VARCHAR(8) NOT NULL DEFAULT '',
    `tags` JSON NULL,
    `pinned` BOOLEAN NOT NULL DEFAULT false,
    `capturedOn` VARCHAR(200) NOT NULL DEFAULT '',
    `taskId` VARCHAR(191) NULL,
    `remindOn` DATETIME(3) NULL,
    `savedTo` VARCHAR(16) NOT NULL DEFAULT '',
    `savedId` VARCHAR(191) NULL,
    `archivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `WallNote_userId_archivedAt_createdAt_idx`(`userId`, `archivedAt`, `createdAt`),
    INDEX `WallNote_taskId_idx`(`taskId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailySign` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(10) NOT NULL,
    `topic` VARCHAR(8) NOT NULL,
    `signNo` INTEGER NOT NULL,
    `grade` VARCHAR(4) NOT NULL,
    `content` JSON NOT NULL,
    `collectedAt` DATETIME(3) NULL,
    `verdict` VARCHAR(4) NOT NULL DEFAULT '',
    `verdictAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DailySign_day_idx`(`day`),
    UNIQUE INDEX `DailySign_userId_day_key`(`userId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

