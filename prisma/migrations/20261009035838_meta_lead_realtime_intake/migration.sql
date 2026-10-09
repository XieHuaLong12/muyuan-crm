-- AlterTable
ALTER TABLE `MetaLeadEvent` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `metaCreatedAt` DATETIME(3) NULL,
    ADD COLUMN `nextAttemptAt` DATETIME(3) NULL,
    ADD COLUMN `receivedVia` VARCHAR(16) NOT NULL DEFAULT 'WEBHOOK';

-- AlterTable
ALTER TABLE `MetaLeadForm` ADD COLUMN `pollWatermark` DATETIME(3) NULL,
    ADD COLUMN `polledAt` DATETIME(3) NULL;

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `adLeadFirstContactMinutes` INTEGER NOT NULL DEFAULT 5;

-- CreateIndex
CREATE INDEX `MetaLeadEvent_status_nextAttemptAt_idx` ON `MetaLeadEvent`(`status`, `nextAttemptAt`);

-- CreateIndex
CREATE INDEX `MetaLeadEvent_receivedVia_createdAt_idx` ON `MetaLeadEvent`(`receivedVia`, `createdAt`);
