const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: "postgres://postgres:postgres@localhost:51214/template1",
});

const prisma = new PrismaClient({ adapter });

module.exports = prisma;