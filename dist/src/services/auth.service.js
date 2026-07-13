"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const user_repository_1 = require("../repositories/user.repository");
const bcrypt_1 = __importDefault(require("bcrypt"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
class AuthService {
    repository;
    constructor() {
        this.repository = new user_repository_1.UserRepository();
    }
    async register(data) {
        const userExists = await this.repository.findByEmail(data.email);
        if (userExists)
            throw new Error('E-mail já está em uso');
        const hashedPassword = await bcrypt_1.default.hash(data.password, 10);
        const user = await this.repository.create({ ...data, password: hashedPassword });
        // Removemos a senha do retorno por segurança
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async login(email, passwordString) {
        const user = await this.repository.findByEmail(email);
        if (!user)
            throw new Error('Credenciais inválidas');
        const isPasswordValid = await bcrypt_1.default.compare(passwordString, user.password);
        if (!isPasswordValid)
            throw new Error('Credenciais inválidas');
        const token = jsonwebtoken_1.default.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1d' } // Sessão dura 1 dia
        );
        const { password, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, token };
    }
}
exports.AuthService = AuthService;
