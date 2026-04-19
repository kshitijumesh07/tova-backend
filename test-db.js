require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({
  connectionString: "postgres://postgres:postgres@localhost:51214/template1",
});

const prisma = new PrismaClient({ adapter });

async function test() {
  const result = await prisma.booking.findMany();
  console.log(result);
}

test().finally(() => prisma.$disconnect());
