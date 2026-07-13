"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const prisma_1 = require("../database/prisma");
const bcrypt = __importStar(require("bcryptjs"));
const jwt = __importStar(require("jsonwebtoken"));
const auth_validator_1 = require("../validators/auth.validator");
exports.authController = {
    async login(req, res) {
        try {
            const { email, password } = auth_validator_1.loginSchema.parse(req.body);
            const user = await prisma_1.prisma.user.findUnique({ where: { email } });
            if (!user) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }
            const isValidPassword = await bcrypt.compare(password, user.password);
            if (!isValidPassword) {
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }
            // ❌ A Trava do Limbo (403) foi removida daqui! 
            const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'fallback_secret', { expiresIn: '1d' });
            return res.json({
                user: { id: user.id, name: user.name, email: user.email, role: user.role },
                token
            });
        }
        catch (error) {
            console.error('Erro no login:', error);
            return res.status(400).json({ error: 'Erro ao realizar login' });
        }
    },
    // Rota temporária para criar o seu primeiro usuário Administrador
    async setup(req, res) {
        try {
            const existingAdmin = await prisma_1.prisma.user.findFirst();
            if (existingAdmin) {
                return res.status(400).json({ error: 'Admin já existe no banco de dados.' });
            }
            const hashedPassword = await bcrypt.hash('admin123', 10);
            const newAdmin = await prisma_1.prisma.user.create({
                data: {
                    name: 'Felipe',
                    email: 'admin@t3ooh.com.br',
                    password: hashedPassword,
                    role: 'ADMIN'
                }
            });
            return res.status(201).json({
                message: 'Admin criado com sucesso!',
                email: newAdmin.email,
                password: 'admin123'
            });
        }
        catch (error) {
            console.error(error);
            return res.status(500).json({ error: 'Erro ao criar admin' });
        }
    },
    async register(req, res) {
        try {
            const { name, email, password } = req.body;
            // Verifica se o e-mail já existe
            const userExists = await prisma_1.prisma.user.findUnique({ where: { email } });
            if (userExists) {
                return res.status(400).json({ error: 'Este e-mail já está em uso.' });
            }
            // 👈 Agora usamos bcrypt.hash para criptografar
            const hashedPassword = await bcrypt.hash(password, 10);
            // Cria o usuário no banco
            await prisma_1.prisma.user.create({
                data: {
                    name,
                    email,
                    password: hashedPassword,
                    // O Prisma já coloca a role "USER" automaticamente pelo seu schema!
                }
            });
            return res.status(201).json({ message: 'Conta criada com sucesso!' });
        }
        catch (error) {
            console.error('Erro no cadastro:', error);
            return res.status(500).json({ error: 'Erro interno ao criar conta.' });
        }
    }
};
