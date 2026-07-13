import { Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRepository } from '../repositories/user.repository';

export class AuthService {
    private readonly repository = new UserRepository();

    async register(data: Prisma.UserUncheckedCreateInput) {
        const userExists = await this.repository.findByEmail(data.email);
        if (userExists) throw new Error('E-mail já está em uso.');

        const password = await bcrypt.hash(data.password, 12);
        const user = await this.repository.create({ ...data, password });
        const { password: _password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }

    async login(email: string, password: string) {
        const user = await this.repository.findByEmail(email);
        if (!user || !(await bcrypt.compare(password, user.password))) {
            throw new Error('Credenciais inválidas.');
        }

        const token = jwt.sign({ role: user.role }, env.JWT_SECRET, {
            algorithm: 'HS256',
            subject: user.id,
            expiresIn: '1h',
        });

        const { password: _password, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, token };
    }
}
