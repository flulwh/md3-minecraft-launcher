-- AlterTable
ALTER TABLE "Instance" ADD COLUMN "tags" TEXT;
ALTER TABLE "Instance" ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;