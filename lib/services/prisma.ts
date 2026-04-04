import { PrismaClient } from "@prisma/client";

declare global {
  var __chat2skillsPrisma: PrismaClient | undefined;
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrismaClient() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const prismaClient =
    globalThis.__chat2skillsPrisma ??
    new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
    });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__chat2skillsPrisma = prismaClient;
  }

  return prismaClient;
}