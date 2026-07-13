import { prisma } from '../database/prisma';

async function main() {
    const defaultCategory = 'Painel de LED Outdoor';

    await prisma.category.upsert({
        where: { name: defaultCategory },
        update: {},
        create: {
            name: defaultCategory,
            description: 'Painéis de LED instalados em vias públicas e rodovias de alto fluxo.',
        },
    });

    console.log('Categoria padrão verificada.');
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
