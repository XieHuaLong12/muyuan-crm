-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `orderNo` VARCHAR(40) NOT NULL,
    `customerId` VARCHAR(191) NOT NULL,
    `dealId` VARCHAR(191) NULL,
    `amountRMB` DECIMAL(14, 2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'CNY',
    `sourceAmount` DECIMAL(14, 2) NULL,
    `status` VARCHAR(24) NOT NULL DEFAULT 'PENDING_PAYMENT',
    `paymentStatus` VARCHAR(24) NOT NULL DEFAULT 'UNPAID',
    `productionStatus` VARCHAR(24) NOT NULL DEFAULT 'NOT_STARTED',
    `shippingStatus` VARCHAR(24) NOT NULL DEFAULT 'NOT_SHIPPED',
    `orderDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `estimatedDelivery` DATETIME(3) NULL,
    `notes` TEXT NOT NULL,
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_orderNo_key`(`orderNo`),
    UNIQUE INDEX `Order_dealId_key`(`dealId`),
    INDEX `Order_customerId_status_idx`(`customerId`, `status`),
    INDEX `Order_status_orderDate_idx`(`status`, `orderDate`),
    INDEX `Order_estimatedDelivery_idx`(`estimatedDelivery`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_dealId_fkey` FOREIGN KEY (`dealId`) REFERENCES `Deal`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

