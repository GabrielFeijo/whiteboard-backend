import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { PresignAssetDto } from '../../src/modules/assets/dto/presign-asset.dto';
import { LoginDto } from '../../src/modules/auth/dto/login.dto';
import { RegisterDto } from '../../src/modules/auth/dto/register.dto';
import { AddMemberDto } from '../../src/modules/boards/dto/add-member.dto';
import { CreateLinkDto } from '../../src/modules/boards/dto/create-link.dto';

describe('DTO Validation Rules (class-validator)', () => {
  describe('AddMemberDto', () => {
    it('accepts valid email with VIEWER or EDITOR role', async () => {
      const dto = plainToInstance(AddMemberDto, {
        email: 'collaborator@example.com',
        role: 'EDITOR',
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects invalid email address', async () => {
      const dto = plainToInstance(AddMemberDto, {
        email: 'not-an-email',
        role: 'VIEWER',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'email')).toBe(true);
    });

    it('rejects OWNER role elevation in member invitations', async () => {
      const dto = plainToInstance(AddMemberDto, {
        email: 'collab@example.com',
        role: 'OWNER',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'role')).toBe(true);
    });
  });

  describe('CreateLinkDto', () => {
    it('accepts valid share link options with default VIEWER role', async () => {
      const dto = plainToInstance(CreateLinkDto, {
        expiresInHours: 48,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
      expect(dto.role).toBe('VIEWER');
    });

    it('rejects OWNER role in public share links', async () => {
      const dto = plainToInstance(CreateLinkDto, {
        role: 'OWNER',
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'role')).toBe(true);
    });

    it('enforces expiration hours bounds between 1 and 720 hours (30 days)', async () => {
      const tooSmall = plainToInstance(CreateLinkDto, { expiresInHours: 0 });
      expect((await validate(tooSmall)).some((e) => e.property === 'expiresInHours')).toBe(true);

      const tooLarge = plainToInstance(CreateLinkDto, { expiresInHours: 1000 });
      expect((await validate(tooLarge)).some((e) => e.property === 'expiresInHours')).toBe(true);
    });
  });

  describe('PresignAssetDto', () => {
    it('accepts allowed raster image types up to 10MB', async () => {
      const dto = plainToInstance(PresignAssetDto, {
        filename: 'architecture.png',
        contentType: 'image/png',
        size: 5 * 1024 * 1024,
      });
      const errors = await validate(dto);
      expect(errors).toHaveLength(0);
    });

    it('rejects dangerous MIME types (SVG, HTML, JS) to prevent stored XSS', async () => {
      const svgDto = plainToInstance(PresignAssetDto, {
        filename: 'vector.svg',
        contentType: 'image/svg+xml',
        size: 1024,
      });
      expect((await validate(svgDto)).some((e) => e.property === 'contentType')).toBe(true);

      const htmlDto = plainToInstance(PresignAssetDto, {
        filename: 'exploit.html',
        contentType: 'text/html',
        size: 1024,
      });
      expect((await validate(htmlDto)).some((e) => e.property === 'contentType')).toBe(true);
    });

    it('rejects file sizes exceeding 10MB', async () => {
      const dto = plainToInstance(PresignAssetDto, {
        filename: 'huge.jpg',
        contentType: 'image/jpeg',
        size: 11 * 1024 * 1024,
      });
      const errors = await validate(dto);
      expect(errors.some((e) => e.property === 'size')).toBe(true);
    });
  });

  describe('RegisterDto & LoginDto', () => {
    it('enforces minimum 8 characters password for registration', async () => {
      const weak = plainToInstance(RegisterDto, {
        email: 'user@example.com',
        name: 'User',
        password: '123',
      });
      const errors = await validate(weak);
      expect(errors.some((e) => e.property === 'password')).toBe(true);
    });

    it('accepts valid credentials for login', async () => {
      const login = plainToInstance(LoginDto, {
        email: 'user@example.com',
        password: 'Password123!',
      });
      const errors = await validate(login);
      expect(errors).toHaveLength(0);
    });
  });
});
