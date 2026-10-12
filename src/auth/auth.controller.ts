import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { Env } from '../config/env';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private setRefreshCookie(res: Response, token: string) {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/v1/auth',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response) {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const isProd = this.config.get('NODE_ENV', { infer: true }) === 'production';
    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      path: '/v1/auth',
    });
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ip = req.ip || req.socket.remoteAddress;
    const result = await this.authService.login(dto, ip);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate refresh token and get a new access token' })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const refreshToken = req.cookies?.[cookieName] || req.body?.refreshToken;
    const result = await this.authService.refresh(refreshToken);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      user: result.user,
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout and invalidate refresh token' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookieName = this.config.get('REFRESH_COOKIE_NAME', { infer: true });
    const refreshToken = req.cookies?.[cookieName];
    await this.authService.logout(refreshToken);
    this.clearRefreshCookie(res);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async getMe(@CurrentUser('id') userId: string) {
    return this.authService.getMe(userId);
  }

  @Delete('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete and anonymize account (LGPD)' })
  async deleteMe(@CurrentUser('id') userId: string, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.deleteMe(userId);
    this.clearRefreshCookie(res);
    return result;
  }
}
