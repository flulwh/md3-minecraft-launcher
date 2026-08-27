-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "accessToken" TEXT,
    "clientToken" TEXT,
    "accessTokenExpiresAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MinecraftProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "skins" TEXT,
    "capes" TEXT,
    CONSTRAINT "MinecraftProfile_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Instance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "minecraftVersion" TEXT NOT NULL,
    "loader" TEXT NOT NULL DEFAULT 'vanilla',
    "loaderVersion" TEXT,
    "javaPath" TEXT,
    "memoryMinMb" INTEGER,
    "memoryMaxMb" INTEGER NOT NULL DEFAULT 2048,
    "jvmArgs" TEXT,
    "gameArgs" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "fullscreen" BOOLEAN NOT NULL DEFAULT false,
    "serverIp" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "JavaRuntimeRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "path" TEXT NOT NULL,
    "majorVersion" INTEGER NOT NULL,
    "architecture" TEXT NOT NULL,
    "vendor" TEXT,
    "versionString" TEXT,
    "source" TEXT NOT NULL DEFAULT 'system',
    "lastVerifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ContentOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "worldName" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "ContentOverride_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DownloadTaskRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "targetPath" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "bytesTotal" INTEGER,
    "bytesDone" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "hashAlgorithm" TEXT,
    "hashValue" TEXT,
    "provider" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "urlsJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "MarketItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "author" TEXT,
    "iconUrl" TEXT,
    "website" TEXT,
    "downloads" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MarketVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "itemId" TEXT NOT NULL,
    "versionName" TEXT NOT NULL,
    "minecraftVersions" TEXT NOT NULL,
    "loader" TEXT,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "hashAlgorithm" TEXT,
    "hashValue" TEXT,
    "dependencies" JSONB,
    "releaseDate" DATETIME,
    CONSTRAINT "MarketVersion_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "MarketItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentDependency" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentVersionId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "ContentDependency_parentVersionId_fkey" FOREIGN KEY ("parentVersionId") REFERENCES "MarketVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InstalledContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT,
    "marketItemId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "installedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "InstalledContent_marketItemId_fkey" FOREIGN KEY ("marketItemId") REFERENCES "MarketItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InstalledContent_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LaunchSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "accountId" TEXT,
    "pid" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'starting',
    "commandJson" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "exitCode" INTEGER,
    "crashReason" TEXT,
    CONSTRAINT "LaunchSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LaunchSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "MinecraftProfile_accountId_name_key" ON "MinecraftProfile"("accountId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "JavaRuntimeRecord_path_key" ON "JavaRuntimeRecord"("path");

-- CreateIndex
CREATE UNIQUE INDEX "ContentOverride_instanceId_kind_fileName_worldName_key" ON "ContentOverride"("instanceId", "kind", "fileName", "worldName");

-- CreateIndex
CREATE INDEX "DownloadTaskRecord_status_updatedAt_idx" ON "DownloadTaskRecord"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketItem_provider_externalId_key" ON "MarketItem"("provider", "externalId");

-- CreateIndex
CREATE INDEX "ContentDependency_parentVersionId_idx" ON "ContentDependency"("parentVersionId");

-- CreateIndex
CREATE INDEX "InstalledContent_instanceId_idx" ON "InstalledContent"("instanceId");
