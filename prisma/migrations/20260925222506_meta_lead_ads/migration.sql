-- CreateTable
CREATE TABLE `MetaLeadEvent` (
    `id` VARCHAR(191) NOT NULL,
    `leadgenId` VARCHAR(191) NOT NULL,
    `pageId` VARCHAR(191) NOT NULL DEFAULT '',
    `formId` VARCHAR(191) NOT NULL DEFAULT '',
    `customerId` VARCHAR(191) NULL,
    `rawPayload` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'RECEIVED',
    `error` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MetaLeadEvent_leadgenId_key`(`leadgenId`),
    INDEX `MetaLeadEvent_formId_createdAt_idx`(`formId`, `createdAt`),
    INDEX `MetaLeadEvent_customerId_idx`(`customerId`),
    INDEX `MetaLeadEvent_status_createdAt_idx`(`status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MetaLeadEvent` ADD CONSTRAINT `MetaLeadEvent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

