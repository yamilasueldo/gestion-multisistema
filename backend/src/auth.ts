import { Body, Controller, Injectable, Post, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { IsEmail, IsString, MinLength } from 'class-validator';
import * as bcrypt from 'bcrypt';
import { PrismaService } from './prisma.service';

class LoginDto { @IsEmail() email: string; @IsString() @MinLength(8) password: string; }

@Injectable()
export class AuthService {
  private readonly jwt: JwtService;
  constructor(private readonly prisma: PrismaService, config: ConfigService) {
    this.jwt = new JwtService({ secret: config.get<string>('JWT_SECRET') ?? 'development-only-change-me', signOptions: { expiresIn: '8h' } });
  }
  async login(dto: LoginDto) {
    const user = await this.prisma.usuarioSoporte.findUnique({ where: { email: dto.email.trim().toLowerCase() } });
    if (!user?.activo || !(await bcrypt.compare(dto.password, user.claveHash))) throw new UnauthorizedException('Credenciales inválidas');
    return { accessToken: await this.jwt.signAsync({ sub: user.id, email: user.email }), user: { id: user.id, name: user.nombre, email: user.email } };
  }
  async verify(token: string) { return this.jwt.verifyAsync<{ sub: string; email: string }>(token); }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
}
