const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
prisma.$executeRawUnsafe('ALTER TABLE users ADD COLUMN source text;')
  .then(() => console.log('Done'))
  .catch(console.error)
  .finally(() => prisma.$disconnect());
