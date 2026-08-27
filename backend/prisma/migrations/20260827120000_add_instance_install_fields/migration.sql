-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Instance" (
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
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "installedAt" DATETIME,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Instance" ("createdAt", "fullscreen", "gameArgs", "height", "id", "javaPath", "jvmArgs", "loader", "loaderVersion", "memoryMaxMb", "memoryMinMb", "minecraftVersion", "name", "serverIp", "updatedAt", "width") SELECT "createdAt", "fullscreen", "gameArgs", "height", "id", "javaPath", "jvmArgs", "loader", "loaderVersion", "memoryMaxMb", "memoryMinMb", "minecraftVersion", "name", "serverIp", "updatedAt", "width" FROM "Instance";
DROP TABLE "Instance";
ALTER TABLE "new_Instance" RENAME TO "Instance";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;