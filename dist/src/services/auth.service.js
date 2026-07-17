"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("../config/env");
const user_repository_1 = require("../repositories/user.repository");
class AuthService {
    repository = new user_repository_1.UserRepository();
    async register(data) {
        const userExists = await this.repository.findByEmail(data.email);
        if (userExists)
            throw new Error('E-mail já está em uso.');
        const password = await bcryptjs_1.default.hash(data.password, 12);
        const user = await this.repository.create({ ...data, password });
        const { password: _password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
    async login(email, password) {
        const user = await this.repository.findByEmail(email);
        if (!user || !(await bcryptjs_1.default.compare(password, user.password))) {
            throw new Error('Credenciais inválidas.');
        }
        const token = jsonwebtoken_1.default.sign({ role: user.role }, env_1.env.JWT_SECRET, {
            algorithm: 'HS256',
            subject: user.id,
            expiresIn: '1h',
        });
        const { password: _password, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, token };
    }
}
exports.AuthService = AuthService;
