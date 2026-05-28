const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user.findMany({ select: { email: true, subscriptionTier: true }, take: 10 })
  .then(u => console.log(JSON.stringify(u, null, 2)))
  .catch(console.error)
  .finally(() => p.$disconnect());
