-- AlterTable
ALTER TABLE `Customer` ADD COLUMN `contactKeysAt` DATETIME(3) NULL,
    ADD COLUMN `pendingAssignment` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `Setting` ADD COLUMN `leadAssignMode` VARCHAR(16) NOT NULL DEFAULT 'POOL';

-- AlterTable
ALTER TABLE `Task` ADD COLUMN `assigneeId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `Customer_pendingAssignment_idx` ON `Customer`(`pendingAssignment`);

-- CreateIndex
CREATE INDEX `Customer_contactKeysAt_idx` ON `Customer`(`contactKeysAt`);

-- CreateIndex
CREATE INDEX `Task_assigneeId_status_dueDate_idx` ON `Task`(`assigneeId`, `status`, `dueDate`);

-- One-time backfill: the team page already reported admin-owned, never-contacted NEW customers as
-- "still owned by an administrator" (unassigned). They now enter the explicit assignment pool.
-- The first-contact deadline starts when a customer is assigned to an owner, so the intake
-- administrator's first-contact deadline, open first-contact tasks and their reminders are closed.
UPDATE `Customer` c JOIN `User` u ON u.`id` = c.`ownerId`
SET c.`pendingAssignment` = true, c.`firstContactDueAt` = NULL
WHERE u.`role` = 'ADMIN' AND c.`stage` = 'NEW' AND c.`deletedAt` IS NULL
  AND c.`firstContactAt` IS NULL AND c.`contactedAt` IS NULL
  AND c.`lastOutboundAt` IS NULL AND c.`lastFollowUpAt` IS NULL;

UPDATE `Reminder` r JOIN `Task` t ON t.`id` = r.`taskId` JOIN `Customer` c ON c.`id` = t.`customerId`
SET r.`status` = 'DISMISSED'
WHERE c.`pendingAssignment` = true AND t.`automationKey` LIKE 'first-contact:%' AND t.`status` <> 'DONE';

UPDATE `Task` t JOIN `Customer` c ON c.`id` = t.`customerId`
SET t.`status` = 'DONE', t.`completedAt` = CURRENT_TIMESTAMP(3), t.`updatedAt` = CURRENT_TIMESTAMP(3)
WHERE c.`pendingAssignment` = true AND t.`automationKey` LIKE 'first-contact:%' AND t.`status` <> 'DONE';
