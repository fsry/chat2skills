declare global {
  var __chat2skillsPrisma: PrismaClientLike | undefined;
}

type PrismaClientLike = {
  skillAnalysisRecord: {
    upsert: (args: unknown) => Promise<Record<string, unknown>>;
    update: (args: unknown) => Promise<Record<string, unknown>>;
    findUnique: (args: unknown) => Promise<{ generatedSkill?: string | null } | null>;
  };
};

type PrismaClientConstructor = new (options?: { log?: string[] }) => PrismaClientLike;

function resolvePrismaClientConstructor(): PrismaClientConstructor | null {
  try {
    const runtimeRequire = eval("require") as (id: string) => {
      PrismaClient: PrismaClientConstructor;
    };

    return runtimeRequire("@prisma/client").PrismaClient;
  } catch {
    return null;
  }
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getPrismaClient() {
  if (!hasDatabaseUrl()) {
    return null;
  }

  const PrismaClient = resolvePrismaClientConstructor();

  if (!PrismaClient) {
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