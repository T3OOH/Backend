"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const prisma_1 = require("../database/prisma");
const env_1 = require("../config/env");
const auth_validator_1 = require("../validators/auth.validator");
function toPublicUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
    };
}
exports.authController = {
    async login(req, res) {
        const { email, password } = auth_validator_1.loginSchema.parse(req.body);
        const user = await prisma_1.prisma.user.findUnique({ where: { email } });
        if (!user || !(await bcryptjs_1.default.compare(password, user.password))) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
        const token = jsonwebtoken_1.default.sign({ role: user.role }, env_1.env.JWT_SECRET, {
            algorithm: 'HS256',
            subject: user.id,
            expiresIn: '1h',
        });
        return res.json({
            user: toPublicUser(user),
            token,
        });
    },
    async register(req, res) {
        const { name, email, password } = auth_validator_1.registerSchema.parse(req.body);
        try {
            const user = await prisma_1.prisma.user.create({
                data: {
                    name,
                    email,
                    password: await bcryptjs_1.default.hash(password, 12),
                    role: client_1.Role.USER,
                },
            });
            return res.status(201).json({
                message: 'Conta criada com sucesso.',
                user: toPublicUser(user),
            });
        }
        catch (error) {
            if (error instanceof client_1.Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002') {
                return res.status(409).json({ error: 'Este e-mail já está em uso.' });
            }
            throw error;
        }
    },
};
