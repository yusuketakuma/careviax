import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { importMhlwPriceList } from '@/server/services/drug-master-import/mhlw';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to import the MHLW price master');
}

function parseArgs(argv: string[]) {
  const workbookUrls: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--workbook-url') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--workbook-url requires a URL value');
      }
      workbookUrls.push(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { workbookUrls };
}

async function main() {
  const { workbookUrls } = parseArgs(process.argv.slice(2));
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const result = await importMhlwPriceList(prisma, {
      ...(workbookUrls.length > 0 ? { workbookUrls } : {}),
    });

    console.log(
      JSON.stringify(
        {
          status: result.log.status,
          importedCount: result.importedCount,
          workbookUrls: result.workbookUrls,
          logId: result.log.id,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
