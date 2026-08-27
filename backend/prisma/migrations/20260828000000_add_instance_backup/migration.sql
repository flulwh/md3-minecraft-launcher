-- CreateTable
CREATE TABLE "InstanceBackup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "label" TEXT,
    "fileName" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL DEFAULT 0,
    "fileCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "InstanceBackup_instanceId_idx" ON "InstanceBackup"("instanceId");