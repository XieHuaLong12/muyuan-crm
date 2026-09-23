-- AlterTable
ALTER TABLE `ProductCategory` ADD COLUMN `codePrefix` VARCHAR(4) NOT NULL DEFAULT '',
    ADD COLUMN `level` INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN `parentId` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `ProductCategory_parentId_idx` ON `ProductCategory`(`parentId`);

-- CreateIndex
CREATE INDEX `ProductCategory_level_sort_idx` ON `ProductCategory`(`level`, `sort`);

-- AddForeignKey
ALTER TABLE `ProductCategory` ADD CONSTRAINT `ProductCategory_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `ProductCategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

