"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const prisma = new client_1.PrismaClient();
async function main() {
    console.log('🌱 Iniciando seed do banco de dados...');
    // 1. Criar Usuário Admin Padrão
    const adminEmail = 'admin@t3ooh.com.br';
    const existingUser = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (!existingUser) {
        const hashedPassword = await bcrypt_1.default.hash('SenhaPremium123!', 10);
        await prisma.user.create({
            data: {
                name: 'Administrador T3',
                email: adminEmail,
                password: hashedPassword,
                role: 'ADMIN',
            },
        });
        console.log('✅ Usuário Admin criado com sucesso! (admin@t3ooh.com.br / SenhaPremium123!)');
    }
    else {
        console.log('⚠️ Usuário Admin já existe. Pulando...');
    }
    // 2. Criar Categoria Padrão de Painel
    const defaultCategory = 'Painel de LED Outdoor';
    const existingCategory = await prisma.category.findUnique({ where: { name: defaultCategory } });
    if (!existingCategory) {
        await prisma.category.create({
            data: {
                name: defaultCategory,
                description: 'Painéis de LED instalados em vias públicas e rodovias de alto fluxo.',
            },
        });
        console.log(`✅ Categoria "${defaultCategory}" criada com sucesso!`);
    }
    else {
        console.log('⚠️ Categoria já existe. Pulando...');
    }
    console.log('🎉 Seed concluído!');
}
main()
    .catch((e) => {
    console.error('❌ Erro ao rodar seed:', e);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
